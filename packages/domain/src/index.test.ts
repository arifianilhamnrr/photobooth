import { describe, expect, it } from "vitest";
import { createSessionId } from "./index";

describe("createSessionId", () => {
  it("creates unique UUID-backed IDs", () => {
    const first = createSessionId();
    const second = createSessionId();
    expect(first).toMatch(/^SESI-[0-9A-F-]{36}$/);
    expect(second).not.toBe(first);
  });
});
