import { describe, expect, it } from "vitest";
import ts from "typescript";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import {
  generateOutputSchemas,
  type ResponseOperation,
} from "../../scripts/output-schemas";
import type { OutputSchema } from "../lib/tool-registry";

function generate(
  spec: Record<string, unknown>,
  responses: ResponseOperation["responses"],
): OutputSchema {
  const source = generateOutputSchemas(spec, [
    { operationId: "test", responses },
  ]);
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { outputSchemas?: { test: OutputSchema } } = {};
  // Execute only this test's generated module, never API-provided code.
  new Function("exports", js)(exports);
  return exports.outputSchemas!.test;
}
const jsonResponse = (schema: Record<string, unknown>) => ({
  content: { "application/json": { schema } },
});

describe("output schema generation", () => {
  it("normalizes type arrays without losing nullability, bounds, or existing unions", () => {
    const original = {
      type: ["string", "integer", "null"],
      minLength: 2,
      minimum: 1,
      anyOf: [{ enum: [null, "ok", "x", 2, 0] }],
      allOf: [{ not: { const: 3 } }],
    };
    const schema = generate({}, { "200": jsonResponse(original) });
    expect(JSON.stringify(schema)).not.toMatch(/"type":\[/);
    const provider = new CfWorkerJsonSchemaValidator();
    const before = provider.getValidator(original);
    const after = provider.getValidator(schema);
    for (const value of [
      null,
      "ok",
      "x",
      "other",
      2,
      0,
      3,
      1.5,
      true,
      {},
      [],
    ]) {
      expect(after({ result: value }).valid).toBe(before(value).valid);
    }
  });

  it("lifts description-only allOf branches without weakening validation", () => {
    const schema = generate(
      {},
      {
        "200": jsonResponse({
          allOf: [{ type: "string" }, { description: "A label" }],
        }),
      },
    );
    expect(schema.properties?.result).toEqual({
      allOf: [{ type: "string" }],
      description: "A label",
    });
    const validate = new CfWorkerJsonSchemaValidator().getValidator(schema);
    expect(validate({ result: "ok" }).valid).toBe(true);
    expect(validate({ result: 1 }).valid).toBe(false);
  });

  it("includes every success status, deduplicates identical schemas, and excludes errors", () => {
    const schema = generate(
      {},
      {
        "200": jsonResponse({ type: "string" }),
        "201": jsonResponse({ type: "number" }),
        "202": jsonResponse({ type: "number" }),
        "204": {},
        "400": jsonResponse({ type: "boolean" }),
      },
    );
    expect(schema.properties).toEqual({
      result: {
        anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
      },
    });
    const validate = new CfWorkerJsonSchemaValidator().getValidator(schema);
    for (const result of ["ok", 1, null])
      expect(validate({ result }).valid).toBe(true);
    expect(validate({ result: false }).valid).toBe(false);
  });

  it("resolves response references and preserves recursive component references locally", () => {
    const schema = generate(
      {
        components: {
          responses: {
            Success: jsonResponse({ $ref: "#/components/schemas/Node" }),
          },
          schemas: {
            Node: {
              type: "object",
              properties: {
                value: { type: "string" },
                child: { $ref: "#/components/schemas/Node" },
              },
              required: ["value"],
            },
            Unused: { type: "string" },
          },
        },
      },
      { "200": { $ref: "#/components/responses/Success" } },
    );
    expect(Object.keys(schema.$defs as object)).toEqual(["Node"]);
    const validate = new CfWorkerJsonSchemaValidator().getValidator(schema);
    expect(
      validate({ result: { value: "a", child: { value: "b" } } }).valid,
    ).toBe(true);
    expect(
      validate({ result: { value: "a", child: { value: 3 } } }).valid,
    ).toBe(false);
  });

  it("does not remove fields named example or rewrite references in default data", () => {
    const schema = generate(
      {},
      {
        "200": jsonResponse({
          type: "object",
          properties: { example: { type: "string" } },
          default: { $ref: "literal-data" },
          required: ["example"],
          example: { example: "documentation" },
        }),
      },
    );
    expect(schema.properties).toEqual({
      result: {
        type: "object",
        properties: { example: { type: "string" } },
        default: { $ref: "literal-data" },
        required: ["example"],
      },
    });
  });

  it("fails generation on undocumented successes or unresolved references", () => {
    expect(() => generate({}, { "200": {} })).toThrow(
      "no JSON response schema",
    );
    expect(() =>
      generate(
        {},
        { "200": jsonResponse({ $ref: "#/components/schemas/Missing" }) },
      ),
    ).toThrow("Unresolved schema reference");
    expect(() => generate({}, { "400": {} })).toThrow(
      "no successful response schema",
    );
  });
});
