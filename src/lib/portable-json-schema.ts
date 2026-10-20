import type { ZodTypeAny } from "zod";
import { zodToJsonSchema, type JsonSchema7Type } from "zod-to-json-schema";

// Equivalent to array-form type, but consumable by clients expecting one type
// per schema node. Other constraints continue to apply to every union branch.
export function expandTypeArray(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(schema.type)) return schema;
  const { type, ...result } = schema;
  const union = { anyOf: type.map((type) => ({ type })) };
  if (result.anyOf) {
    result.allOf = [...((result.allOf as unknown[]) ?? []), union];
  } else {
    result.anyOf = union.anyOf;
  }
  return result;
}

export function zodToToolJsonSchema(schema: ZodTypeAny) {
  return zodToJsonSchema(schema, {
    target: "jsonSchema7",
    postProcess: (result) =>
      result ? (expandTypeArray(result) as JsonSchema7Type) : result,
  });
}
