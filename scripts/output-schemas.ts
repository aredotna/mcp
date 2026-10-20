import { expandTypeArray } from "../src/lib/portable-json-schema";

type Schema = Record<string, unknown>;
export interface ResponseOperation {
  operationId: string;
  responses?: Record<string, Schema>;
}

function resolvePointer(spec: Schema, ref: string): Schema {
  if (!ref.startsWith("#/"))
    throw new Error(`External schema reference: ${ref}`);
  let value: unknown = spec;
  for (const segment of ref.slice(2).split("/")) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !(key in value)) {
      throw new Error(`Unresolved schema reference: ${ref}`);
    }
    value = (value as Schema)[key];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a schema at ${ref}`);
  }
  return value as Schema;
}

export function generateOutputSchemas(
  spec: Schema,
  operations: ResponseOperation[],
): string {
  const definitions = new Map<string, Schema>();
  const dependencies = new Map<string, Set<string>>();

  function copySchema(value: unknown, refs: Set<string>): unknown {
    if (Array.isArray(value))
      return value.map((item) => copySchema(item, refs));
    if (!value || typeof value !== "object") return value;
    const result: Schema = {};
    for (const [key, entry] of Object.entries(value)) {
      // Examples and OpenAPI-only annotations aren't validation rules. Omitting
      // examples also avoids treating example data containing "$ref" as schemas.
      if (
        [
          "example",
          "examples",
          "discriminator",
          "xml",
          "externalDocs",
        ].includes(key)
      )
        continue;
      if (key === "$ref") {
        if (
          typeof entry !== "string" ||
          !entry.startsWith("#/components/schemas/")
        ) {
          throw new Error(`Unsupported response schema reference: ${entry}`);
        }
        const name = entry.slice("#/components/schemas/".length);
        refs.add(name);
        if (!definitions.has(name)) {
          definitions.set(name, {});
          const nested = new Set<string>();
          dependencies.set(name, nested);
          definitions.set(
            name,
            copySchema(resolvePointer(spec, entry), nested) as Schema,
          );
        }
        result[key] = `#/$defs/${name}`;
      } else if (
        [
          "properties",
          "patternProperties",
          "$defs",
          "dependentSchemas",
        ].includes(key)
      ) {
        result[key] = Object.fromEntries(
          Object.entries(entry as Schema).map(([name, child]) => [
            name,
            copySchema(child, refs),
          ]),
        );
      } else if (
        [
          "allOf",
          "anyOf",
          "oneOf",
          "prefixItems",
          "items",
          "additionalProperties",
          "not",
          "contains",
          "if",
          "then",
          "else",
          "propertyNames",
          "unevaluatedProperties",
          "unevaluatedItems",
        ].includes(key)
      ) {
        result[key] = copySchema(entry, refs);
      } else {
        result[key] = entry;
      }
    }
    // OpenAPI sometimes places documentation beside a reference in allOf.
    // Lift those annotations so clients don't mistake them for untyped schemas.
    if (Array.isArray(result.allOf)) {
      const descriptions = result.allOf.filter(
        (child) =>
          child &&
          typeof child === "object" &&
          Object.keys(child).length === 1 &&
          typeof child.description === "string",
      );
      const constraints = result.allOf.filter(
        (child) => !descriptions.includes(child),
      );
      if (descriptions.length && constraints.length) {
        result.allOf = constraints;
        result.description ??= descriptions
          .map((child) => child.description)
          .join("\n\n");
      }
    }
    return expandTypeArray(result);
  }

  const outputs = operations.map((operation) => {
    const schemas: Schema[] = [];
    const refs = new Set<string>();
    for (const [status, original] of Object.entries(
      operation.responses ?? {},
    )) {
      if (!/^2\d\d$|^2XX$/.test(status)) continue;
      let response = original;
      const seen = new Set<string>();
      while (typeof response.$ref === "string") {
        if (seen.has(response.$ref))
          throw new Error(`Cyclic response reference: ${response.$ref}`);
        seen.add(response.$ref);
        response = resolvePointer(spec, response.$ref);
      }
      const content = response.content as
        | Record<string, { schema?: Schema }>
        | undefined;
      const schema = content?.["application/json"]?.schema;
      if (!schema && status !== "204" && status !== "205") {
        throw new Error(
          `${operation.operationId} ${status} has no JSON response schema`,
        );
      }
      const copied = copySchema(schema ?? { type: "null" }, refs) as Schema;
      if (
        !schemas.some((item) => JSON.stringify(item) === JSON.stringify(copied))
      )
        schemas.push(copied);
    }
    if (!schemas.length)
      throw new Error(
        `${operation.operationId} has no successful response schema`,
      );
    const collect = (name: string) => {
      for (const child of dependencies.get(name) ?? []) {
        if (!refs.has(child)) {
          refs.add(child);
          collect(child);
        }
      }
    };
    for (const name of refs) collect(name);
    return {
      name: operation.operationId,
      schema: schemas.length === 1 ? schemas[0] : { anyOf: schemas },
      refs,
    };
  });

  return [
    "// Auto-generated by scripts/generate-tools.ts — do not edit manually",
    'import type { OutputSchema } from "../lib/tool-registry";',
    `const definitions = ${JSON.stringify(Object.fromEntries(definitions), null, 2)};`,
    "export const outputSchemas = {",
    ...outputs.map(
      ({ name, schema, refs }) => `${JSON.stringify(name)}: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { result: ${JSON.stringify(schema)} },
      required: ["result"],
      additionalProperties: false,
      $defs: { ${[...refs]
        .sort()
        .map(
          (ref) =>
            `${JSON.stringify(ref)}: definitions[${JSON.stringify(ref)}]`,
        )
        .join(",")} }
    },`,
    ),
    "} satisfies Record<string, OutputSchema>;",
    "",
  ].join("\n");
}
