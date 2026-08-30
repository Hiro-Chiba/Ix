import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTextCommand, resolveTextSearchPath } from "../commands/text.js";

describe("text workspace boundary", () => {
  let fixture: string;
  let workspace: string;
  let outside: string;
  let originalCwd: string;
  let originalExitCode: number | string | undefined;
  let logs: string[];

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), "ix-text-boundary-"));
    workspace = join(fixture, "workspace");
    outside = join(fixture, "outside");
    mkdirSync(join(workspace, "src"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(workspace, "src", "inside.ts"), "export const boundaryNeedle = true;\n");
    writeFileSync(join(outside, "outside.ts"), "export const boundaryNeedle = false;\n");
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    process.chdir(outside);
    process.exitCode = undefined;
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    rmSync(fixture, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<void> {
    const program = new Command();
    registerTextCommand(program);
    await program.parseAsync(["node", "ix", ...args]);
  }

  it("resolves --path relative to --root instead of the process cwd", () => {
    expect(resolveTextSearchPath(workspace, "src")).toBe(join(workspace, "src"));
  });

  it("rejects an absolute search path outside the explicit workspace", async () => {
    await run(["text", "boundaryNeedle", "--root", workspace, "--path", outside, "--format", "json"]);

    expect(JSON.parse(logs.join("\n"))).toMatchObject({ error: "path_outside_workspace" });
    expect(process.exitCode).toBe(1);
  });

  it.skipIf(process.platform === "win32")("rejects a symlink that leaves the workspace", async () => {
    symlinkSync(outside, join(workspace, "linked"), "dir");

    await run(["text", "boundaryNeedle", "--root", workspace, "--path", "linked", "--format", "json"]);

    expect(JSON.parse(logs.join("\n"))).toMatchObject({ error: "path_outside_workspace" });
    expect(process.exitCode).toBe(1);
  });
});
