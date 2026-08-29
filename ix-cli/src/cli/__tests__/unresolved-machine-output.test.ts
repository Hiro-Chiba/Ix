import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

vi.mock("../../client/api.js", () => ({
  IxClient: class {
    async workspaceSystem() { return { systemId: null }; }
    async search() { return []; }
  },
}));

type Register = (program: Command) => void;

async function run(register: Register, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const program = new Command();
  program.name("ix").exitOverride();
  register(program);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts) => stdout.push(parts.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...parts) => stderr.push(parts.join(" ")));
  try {
    await program.parseAsync(args, { from: "user" });
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
  return { stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

describe("unresolved targets in machine formats", () => {
  let savedExitCode: number | string | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it.each([
    ["context", async () => (await import("../commands/context.js")).registerContextCommand],
    ["explain", async () => (await import("../commands/explain.js")).registerExplainCommand],
    ["read", async () => (await import("../commands/read.js")).registerReadCommand],
  ] as const)("returns JSON and a non-zero status from ix %s", async (command, loadRegister) => {
    const result = await run(await loadRegister(), [command, "DefinitelyMissing", "--format", "json"]);

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      error: "unresolved_target",
      message: 'No entity found matching "DefinitelyMissing".',
    });
  });
});
