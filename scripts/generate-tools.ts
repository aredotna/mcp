import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
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
      "application/x-www-form-urlencoded"?: { schema?: Record<string, unknown> };
    };
  };
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
    let zodType = jsonSchemaToZodString(paramSchema as Parameters<typeof jsonSchemaToZodString>[0], {
      rootSpec: spec,
    });

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
    const resolved = bodySchema.$ref
      ? (resolveRef(bodySchema.$ref as string, spec) as Record<string, unknown>)
      : (bodySchema as Record<string, unknown>);

    let effectiveSchema = resolved;

    if (resolved.allOf) {
      const merged: Record<string, unknown> = {};
      const mergedRequired: string[] = [];
      for (const sub of resolved.allOf as Record<string, unknown>[]) {
        const subResolved = sub.$ref
          ? (resolveRef(sub.$ref as string, spec) as Record<string, unknown>)
          : sub;
        if (subResolved.properties) {
          Object.assign(
            merged,
            subResolved.properties as Record<string, unknown>,
          );
        }
        if (subResolved.required) {
          mergedRequired.push(
            ...(subResolved.required as string[]),
          );
        }
      }
      effectiveSchema = {
        type: "object",
        properties: merged,
        required: mergedRequired,
      };
    }

    if (
      effectiveSchema.type === "object" &&
      effectiveSchema.properties
    ) {
      hasBody = true;
      const props = effectiveSchema.properties as Record<
        string,
        Record<string, unknown>
      >;
      const reqSet = new Set(
        (effectiveSchema.required as string[] | undefined) ?? [],
      );

      for (const [key, propSchema] of Object.entries(props)) {
        if (
          pathParams.includes(key) ||
          queryParams.includes(key)
        ) {
          continue;
        }

        let zodType = jsonSchemaToZodString(propSchema as Parameters<typeof jsonSchemaToZodString>[0], {
          rootSpec: spec,
        });

        if (!reqSet.has(key)) {
          zodType += ".optional()";
        }
        if (propSchema.description) {
          zodType += `.describe(${JSON.stringify(propSchema.description)})`;
        }

        zodFields.push(`    ${JSON.stringify(key)}: ${zodType}`);
        bodyProperties.push(key);
        if (reqSet.has(key)) bodyRequired.push(key);
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
  console.log("Fetching OpenAPI spec...");
  execSync(`curl -s ${SPEC_URL} -o ${SPEC_PATH}`);

  console.log("Generating TypeScript types...");
  execSync(`npx openapi-typescript ${SPEC_PATH} -o ${TYPES_PATH}`);

  console.log("Generating tool registrations...");
  const spec = JSON.parse(readFileSync(SPEC_PATH, "utf-8")) as Record<string, unknown>;
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
  lines.push(`// Auto-generated by scripts/generate-tools.ts — do not edit manually`);
  lines.push(`import { z } from "zod";`);
  lines.push(`import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";`);
  lines.push(`import { withArenaClient, textResult, errorResult } from "../lib/tool-helpers";`);
  lines.push(``);
  lines.push(`export function registerGeneratedTools(server: McpServer): void {`);

  for (const tool of tools) {
    const schemaInner =
      tool.zodFields.length > 0
        ? `{\n${tool.zodFields.join(",\n")}\n  }`
        : "{}";

    const desc = tool.summary + (tool.description ? ` — ${tool.description}` : "");

    lines.push(``);
    lines.push(`  server.tool(`);
    lines.push(`    ${JSON.stringify(tool.operationId)},`);
    lines.push(`    ${JSON.stringify(desc)},`);
    lines.push(`    ${schemaInner},`);
    lines.push(generateHandler(tool));
    lines.push(`  );`);
  }

  lines.push(`}`);
  lines.push(``);

  writeFileSync(TOOLS_PATH, lines.join("\n"));
  console.log(`Generated ${tools.length} tools → ${TOOLS_PATH}`);
}

main();
