import { describe, it, expect } from "vitest";
import {
  textResult,
  errorResult,
  requireAuth,
  AuthRequiredError,
} from "../lib/tool-helpers";

describe("textResult", () => {
  it("wraps data as pretty-printed JSON text content", () => {
    const result = textResult({ id: 1, title: "test" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ id: 1, title: "test" }, null, 2),
    });
    expect(result.isError).toBeUndefined();
  });
});

describe("errorResult", () => {
  it("wraps error data with isError flag", () => {
    const result = errorResult({ code: 401, message: "Unauthorized" });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify({ code: 401, message: "Unauthorized" }),
    });
  });

  it("handles string errors", () => {
    const result = errorResult("something broke");
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: '"something broke"',
    });
  });
});

describe("requireAuth", () => {
  it("returns the token when present", () => {
    const token = requireAuth({ authInfo: { token: "abc123" } });
    expect(token).toBe("abc123");
  });

  it("throws AuthRequiredError when authInfo is missing", () => {
    expect(() => requireAuth({})).toThrow(AuthRequiredError);
  });

  it("throws AuthRequiredError when token is missing", () => {
    expect(() => requireAuth({ authInfo: {} })).toThrow(AuthRequiredError);
  });

  it("throws AuthRequiredError when token is empty", () => {
    expect(() => requireAuth({ authInfo: { token: "" } })).toThrow(
      AuthRequiredError,
    );
  });
});
