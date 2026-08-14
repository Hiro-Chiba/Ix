import { Command, type CommanderError } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveFileOrEntity = vi.hoisted(() => vi.fn());

vi.mock("../resolve.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../resolve.js")>()),
  resolveFileOrEntity,
}));

import { registerContextCommand } from "../commands/context.js";

async function runContext(args: string[]): Promise<{ error?: CommanderError; stderr: string }> {
  const stderr: string[] = [];
  const program = new Command()
    .name("ix")
    .exitOverride()
    .configureOutput({ writeErr: (chunk) => stderr.push(chunk) });
  registerContextCommand(program);

  try {
    await program.parseAsync(["context", "Widget", ...args], { from: "user" });
    return { stderr: stderr.join("") };
  } catch (error) {
    return { error: error as CommanderError, stderr: stderr.join("") };
  }
}

describe("ix context --pick validation", () => {
  beforeEach(() => {
    resolveFileOrEntity.mockReset().mockResolvedValue(undefined);
  });

  it.each(["nope", "1nope"])("rejects the complete value %j before resolving", async (pick) => {
    const result = await runContext(["--pick", pick]);

    expect(result.error?.exitCode).toBe(1);
    expect(result.stderr).toContain("argument '" + pick + "' is invalid");
    expect(result.stderr).toContain("must be a positive integer");
    expect(result.stderr).not.toContain("TypeError");
    expect(resolveFileOrEntity).not.toHaveBeenCalled();
  });

  it.each([
    ["1", 1],
    ["2", 2],
  ])("passes valid pick %s to resolution as an integer", async (rawPick, expectedPick) => {
    const result = await runContext([
      "--pick",
      rawPick,
      "--kind",
      "function",
      "--path",
      "src/main.ts",
    ]);

    expect(result.error).toBeUndefined();
    expect(resolveFileOrEntity).toHaveBeenCalledOnce();
    expect(resolveFileOrEntity.mock.calls[0]?.[2]).toEqual({
      kind: "function",
      path: "src/main.ts",
      pick: expectedPick,
    });
  });
});
