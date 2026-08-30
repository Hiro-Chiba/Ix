import { Command } from "commander";
import { describe, expect, it } from "vitest";

import { registerOssCommands } from "../register/oss.js";
import { validateCliOptions } from "../options.js";

async function parseInvalid(args: string[]): Promise<unknown> {
  const program = new Command();
  program.name("ix").exitOverride();
  registerOssCommands(program);
  try {
    await program.parseAsync(args, { from: "user" });
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("common CLI option validation", () => {
  it.each([
    [["doctor", "--format", "yaml"], "--format"],
    [["inventory", "--kind", "file", "--limit", "1e3"], "--limit"],
    [["rank", "--by", "dependents", "--kind", "class", "--top", "10abc"], "--top"],
    [["patches", "--limit", "0"], "--limit"],
    [["search", "term", "--as-of", "abc"], "--as-of"],
    [["search", "term", "--as-of", "1e3"], "--as-of"],
    [["map", "--level", "nope"], "--level"],
    [["map", "--min-confidence", "1.1"], "--min-confidence"],
    [["map", "--sort", "newest"], "--sort"],
    [["savings", "--model", "unknown"], "--model"],
  ] as const)("rejects %j before running the command", async (args, option) => {
    const error = await parseInvalid([...args]);

    expect(error).toMatchObject({ code: "commander.invalidArgument" });
    expect(String((error as Error).message)).toContain(option);
  });

  it.each([
    ["doctor", "--format", "json"],
    ["map", "--format", "silent"],
    ["map", "--min-confidence", "0.75"],
    ["subsystems", "--offset", "0"],
  ] as const)("accepts the documented value in %j", (command, option, value) => {
    const program = new Command();
    program.name("ix");
    registerOssCommands(program);
    const action = program.commands.find((candidate) => candidate.name() === command)!;
    action.parseOptions([option, value]);

    expect(() => validateCliOptions(action)).not.toThrow();
  });
});
