/**
 * Converts a JSON Schema object into a Zod source code string.
 * Handles the subset of JSON Schema used by the Are.na OpenAPI spec.
 */

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  description?: string;
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | JsonSchema;
}

interface ConvertOptions {
  rootSpec?: Record<string, unknown>;
}

function resolveRef(
  ref: string,
  rootSpec?: Record<string, unknown>,
): JsonSchema {
  if (!rootSpec || !ref.startsWith("#/")) return {};
  const parts = ref.slice(2).split("/");
  let current: unknown = rootSpec;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return {};
    }
  }
  return current as JsonSchema;
}

export function jsonSchemaToZodString(
  schema: JsonSchema,
  options: ConvertOptions = {},
): string {
  if (schema.$ref) {
    return jsonSchemaToZodString(
      resolveRef(schema.$ref, options.rootSpec),
      options,
    );
  }

  if (schema.oneOf) {
    const variants = schema.oneOf.map((s) => jsonSchemaToZodString(s, options));
    if (variants.length === 1) return variants[0];
    return `z.union([${variants.join(", ")}])`;
  }

  if (schema.allOf) {
    const parts = schema.allOf.map((s) => jsonSchemaToZodString(s, options));
    if (parts.length === 1) return parts[0];
    return parts.reduce((acc, part) => `${acc}.and(${part})`);
  }

  if (schema.enum) {
    const values = schema.enum as string[];
    if (values.length === 1) {
      return `z.literal(${JSON.stringify(values[0])})`;
    }
    return `z.enum([${values.map((v) => JSON.stringify(v)).join(", ")}])`;
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nonNullTypes = types.filter((t) => t !== "null");
  const isNullable = types.includes("null");
  const primaryType = nonNullTypes[0];

  let base: string;

  switch (primaryType) {
    case "string":
      base = "z.string()";
      break;
    case "integer":
      base = "z.number().int()";
      break;
    case "number":
      base = "z.number()";
      break;
    case "boolean":
      base = "z.boolean()";
      break;
    case "array": {
      const itemSchema = schema.items
        ? jsonSchemaToZodString(schema.items, options)
        : "z.unknown()";
      base = `z.array(${itemSchema})`;
      if (schema.minItems !== undefined) base += `.min(${schema.minItems})`;
      if (schema.maxItems !== undefined) base += `.max(${schema.maxItems})`;
      break;
    }
    case "object": {
      if (schema.properties) {
        const requiredSet = new Set(schema.required ?? []);
        const props = Object.entries(schema.properties).map(
          ([key, propSchema]) => {
            let propZod = jsonSchemaToZodString(propSchema, options);
            if (!requiredSet.has(key)) {
              propZod += ".optional()";
            }
            if (propSchema.description) {
              propZod += `.describe(${JSON.stringify(propSchema.description)})`;
            }
            return `${JSON.stringify(key)}: ${propZod}`;
          },
        );
        base = `z.object({ ${props.join(", ")} })`;
      } else {
        base = "z.record(z.unknown())";
      }
      break;
    }
    default:
      base = "z.unknown()";
  }

  if (isNullable) {
    base += ".nullable()";
  }

  return base;
}
