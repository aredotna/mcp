import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { jsonSchemaToZodString } from "../src/lib/json-schema-to-zod";

const SPEC_URL = "https://api.are.na/v3/openapi.json";
const SPEC_PATH = "src/generated/openapi.json";
const TYPES_PATH = "src/generated/schema.d.ts";
const TOOLS_PATH = "src/generated/tools.ts";

const SKIP_OPERATIONS = new Set([
  "createOAuthToken",
  "getOpenapiSpec",
  "getOpenapiSpecJson",
  "getPing",
]);

interface Param {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
}

interface Operation {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: Array<Param | { $ref: string }>;
  requestBody?: {
    required?: boolean;
    content?: {
      "application/json"?: { schema?: Record<string, unknown> };
      "application/x-www-form-urlencoded"?: {
        schema?: Record<string, unknown>;
      };
    };
  };
}

interface FlattenedObjectSchema {
  properties: Record<string, Record<string, unknown>>;
  required: Set<string>;
}

type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "delete", "patch"];

function firstSentence(text?: string): string {
  if (!text) return "";
  const collapsed = text.replace(/\s+/g, " ").trim();
  const match = collapsed.match(/^(.+?\.)\s/);
  return match ? match[1] : collapsed;
}

function resolveRef(ref: string, spec: Record<string, unknown>): unknown {
  const parts = ref.replace("#/", "").split("/");
  let current: unknown = spec;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return {};
    }
  }
  return current;
}

function resolveParam(
  param: Param | { $ref: string },
  spec: Record<string, unknown>,
): Param {
  if ("$ref" in param) {
    return resolveRef(param.$ref, spec) as Param;
  }
  return param;
}

function resolveSchema(
  schema: Record<string, unknown>,
  spec: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof schema.$ref === "string") {
    return resolveRef(schema.$ref, spec) as Record<string, unknown>;
  }
  return schema;
}

function mergeFlattenedSchema(
  target: FlattenedObjectSchema,
  source: FlattenedObjectSchema,
): void {
  Object.assign(target.properties, source.properties);
  for (const key of source.required) {
    target.required.add(key);
  }
}

function flattenObjectSchema(
  schema: Record<string, unknown>,
  spec: Record<string, unknown>,
  includeRequired = true,
): FlattenedObjectSchema {
  const resolved = resolveSchema(schema, spec);
  const flattened: FlattenedObjectSchema = {
    properties: {},
    required: new Set(),
  };

  if (Array.isArray(resolved.allOf)) {
    for (const subSchema of resolved.allOf as Record<string, unknown>[]) {
      mergeFlattenedSchema(
        flattened,
        flattenObjectSchema(subSchema, spec, includeRequired),
      );
    }
  }

  if (resolved.type === "object" && resolved.properties) {
    Object.assign(
      flattened.properties,
      resolved.properties as Record<string, Record<string, unknown>>,
    );

    if (includeRequired) {
      for (const key of (resolved.required as string[] | undefined) ?? []) {
        flattened.required.add(key);
      }
    }
  }

  for (const compositionKey of ["oneOf", "anyOf"] as const) {
    if (!Array.isArray(resolved[compositionKey])) continue;

    for (const variant of resolved[compositionKey] as Record<
      string,
      unknown
    >[]) {
      mergeFlattenedSchema(
        flattened,
        flattenObjectSchema(variant, spec, false),
      );
    }
  }

  return flattened;
}

interface ToolDef {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  zodFields: string[];
  pathParams: string[];
  queryParams: string[];
  hasBody: boolean;
  bodyProperties: string[];
  bodyRequired: string[];
}

function buildToolDef(
  path: string,
  method: HttpMethod,
  op: Operation,
  spec: Record<string, unknown>,
): ToolDef | null {
  if (!op.operationId || SKIP_OPERATIONS.has(op.operationId)) return null;

  const resolvedParams = (op.parameters ?? []).map((p) =>
    resolveParam(p, spec),
  );
  const pathParams: string[] = [];
  const queryParams: string[] = [];
  const zodFields: string[] = [];

  for (const param of resolvedParams) {
    const paramSchema = param.schema ?? { type: "string" };
    let zodType = jsonSchemaToZodString(
      paramSchema as Parameters<typeof jsonSchemaToZodString>[0],
      {
        rootSpec: spec,
      },
    );

    if (!param.required) {
      zodType += ".optional()";
    }
    if (param.description) {
      zodType += `.describe(${JSON.stringify(param.description)})`;
    }

    zodFields.push(`    ${JSON.stringify(param.name)}: ${zodType}`);

    if (param.in === "path") pathParams.push(param.name);
    if (param.in === "query") queryParams.push(param.name);
  }

  const bodySchema =
    op.requestBody?.content?.["application/json"]?.schema ??
    op.requestBody?.content?.["application/x-www-form-urlencoded"]?.schema;

  let hasBody = false;
  const bodyProperties: string[] = [];
  const bodyRequired: string[] = [];

  if (bodySchema) {
    const flattenedSchema = flattenObjectSchema(
      bodySchema as Record<string, unknown>,
      spec,
    );

    if (Object.keys(flattenedSchema.properties).length > 0) {
      hasBody = true;

      for (const [key, propSchema] of Object.entries(
        flattenedSchema.properties,
      )) {
        if (pathParams.includes(key) || queryParams.includes(key)) {
          continue;
        }

        let zodType = jsonSchemaToZodString(
          propSchema as Parameters<typeof jsonSchemaToZodString>[0],
          {
            rootSpec: spec,
          },
        );

        if (!flattenedSchema.required.has(key)) {
          zodType += ".optional()";
        }
        if (propSchema.description) {
          zodType += `.describe(${JSON.stringify(propSchema.description)})`;
        }

        zodFields.push(`    ${JSON.stringify(key)}: ${zodType}`);
        bodyProperties.push(key);
        if (flattenedSchema.required.has(key)) bodyRequired.push(key);
      }
    }
  }

  return {
    operationId: op.operationId,
    method: method.toUpperCase(),
    path,
    summary: op.summary ?? op.operationId,
    description: firstSentence(op.description),
    zodFields,
    pathParams,
    queryParams,
    hasBody,
    bodyProperties,
    bodyRequired,
  };
}

function generateHandler(tool: ToolDef): string {
  const pathParamEntries = tool.pathParams
    .map((p) => `${p}: args[${JSON.stringify(p)}]`)
    .join(", ");

  const queryParamEntries = tool.queryParams
    .map((p) => `${p}: args[${JSON.stringify(p)}]`)
    .join(", ");

  const bodyEntries = tool.bodyProperties
    .map((p) => `${JSON.stringify(p)}: args[${JSON.stringify(p)}]`)
    .join(", ");

  const pathType = JSON.stringify(tool.path) as string;

  const paramsBlock: string[] = [];
  if (tool.pathParams.length > 0) {
    paramsBlock.push(`        path: { ${pathParamEntries} }`);
  }
  if (tool.queryParams.length > 0) {
    paramsBlock.push(`        query: { ${queryParamEntries} }`);
  }

  const fetchOptions: string[] = [];
  if (paramsBlock.length > 0) {
    fetchOptions.push(`      params: {\n${paramsBlock.join(",\n")}\n      }`);
  }
  if (tool.hasBody && tool.bodyProperties.length > 0) {
    fetchOptions.push(`      body: { ${bodyEntries} }`);
  }

  const optionsStr =
    fetchOptions.length > 0
      ? `, {\n${fetchOptions.join(",\n")}\n    } as any`
      : "";

  return `    async (args: Record<string, unknown>, extra) => {
      return withArenaClient(extra, async (client) => {
        const { data, error } = await client.${tool.method}(${pathType}${optionsStr});
        if (error) return errorResult(error);
        return textResult(data);
      }).catch((err) => errorResult(err.message));
    }`;
}

function main() {
  const offline = process.argv.includes("--offline");
  console.log(
    offline ? "Using checked-in OpenAPI spec..." : "Fetching OpenAPI spec...",
  );
  const spec = JSON.parse(
    offline
      ? readFileSync(SPEC_PATH, "utf-8")
      : execFileSync(
          "curl",
          ["--fail", "--silent", "--show-error", "--location", SPEC_URL],
          {
            encoding: "utf-8",
          },
        ),
  ) as Record<string, unknown>;
  if (!spec.openapi || !spec.paths || !spec.components) {
    throw new Error(
      "Expected an OpenAPI specification with paths and components",
    );
  }
  writeFileSync(SPEC_PATH, `${JSON.stringify(spec, null, 2)}\n`);

  console.log("Generating TypeScript types...");
  execSync(`npx openapi-typescript ${SPEC_PATH} -o ${TYPES_PATH}`);

  console.log("Generating tool registrations...");
  const paths = spec.paths as Record<string, Record<string, Operation>>;

  const tools: ToolDef[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    for (const httpMethod of HTTP_METHODS) {
      const op = methods[httpMethod];
      if (!op) continue;
      const tool = buildToolDef(path, httpMethod, op, spec);
      if (tool) tools.push(tool);
    }
  }

  const lines: string[] = [];
  lines.push(
    `// Auto-generated by scripts/generate-tools.ts — do not edit manually`,
  );
  lines.push(`import { z } from "zod";`);
  lines.push(
    `import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";`,
  );
  lines.push(
    `import { withArenaClient, textResult, errorResult } from "../lib/tool-helpers";`,
  );
  lines.push(``);
  lines.push(
    `export function registerGeneratedTools(server: McpServer): void {`,
  );

  for (const tool of tools) {
    const schemaInner =
      tool.zodFields.length > 0
        ? `{\n${tool.zodFields.join(",\n")}\n  }`
        : "{}";

    const desc =
      tool.summary + (tool.description ? ` — ${tool.description}` : "");

    lines.push(``);
    lines.push(`  server.registerTool(`);
    lines.push(`    ${JSON.stringify(tool.operationId)},`);
    lines.push(`    {`);
    lines.push(`      description: ${JSON.stringify(desc)},`);
    lines.push(`      inputSchema: ${schemaInner},`);
    lines.push(`    },`);
    lines.push(generateHandler(tool));
    lines.push(`  );`);
  }

  lines.push(`}`);
  lines.push(``);

  writeFileSync(TOOLS_PATH, lines.join("\n"));
  writeFileSync(SPEC_PATH, `${JSON.stringify(spec, null, 2)}\n`);
  execSync(`npx prettier --write ${TOOLS_PATH} ${SPEC_PATH} ${TYPES_PATH}`, {
    stdio: "inherit",
  });
  console.log(`Generated ${tools.length} tools → ${TOOLS_PATH}`);
}

main();
