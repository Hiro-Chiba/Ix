import { describe, expect, it } from "vitest";

import { shouldRenderIngestProgress } from "../commands/ingest.js";

describe("shouldRenderIngestProgress", () => {
  it("renders text progress only when stderr is an interactive terminal", () => {
    expect(shouldRenderIngestProgress("text", true)).toBe(true);
    expect(shouldRenderIngestProgress("text", false)).toBe(false);
    expect(shouldRenderIngestProgress("text", undefined)).toBe(false);
  });

  it("does not render progress for machine-readable formats", () => {
    expect(shouldRenderIngestProgress("json", true)).toBe(false);
    expect(shouldRenderIngestProgress("llm", true)).toBe(false);
  });
});
