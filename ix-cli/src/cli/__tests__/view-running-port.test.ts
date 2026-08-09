import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
  createConnection: vi.fn(),
}));

vi.mock("child_process", () => ({
  execSync: mocks.execSync,
  spawn: mocks.spawn,
}));

vi.mock("net", () => ({
  createConnection: mocks.createConnection,
}));

let ixHome: string;
let originalIxHome: string | undefined;

const pidFile = () => join(ixHome, "compass.pid");
const scopeFile = () => join(ixHome, "compass.scope");
const portFile = () => join(ixHome, "compass.port");
const serverScriptFile = () => join(ixHome, "tmp", "compass-server.js");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  originalIxHome = process.env.IX_HOME;
  ixHome = mkdtempSync(join(tmpdir(), "ix-view-port-test-"));
  process.env.IX_HOME = ixHome;

  const compassDir = join(ixHome, "cli", "compass");
  mkdirSync(compassDir, { recursive: true });
  writeFileSync(join(compassDir, "index.html"), "<!doctype html>");

  mocks.spawn.mockReturnValue({ pid: 4242, unref: vi.fn() });
  mocks.createConnection.mockImplementation(() => {
    const connection = new EventEmitter();
    queueMicrotask(() => connection.emit("error", new Error("not listening")));
    return connection;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ixHome, { recursive: true, force: true });
  if (originalIxHome === undefined) {
    delete process.env.IX_HOME;
  } else {
    process.env.IX_HOME = originalIxHome;
  }
});

async function runView(args: string[]): Promise<string> {
  const { registerViewCommand } = await import("../commands/view.js");
  const program = new Command();
  program.name("ix").exitOverride();
  registerViewCommand(program);

  const output: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    output.push(values.join(" "));
  });
  try {
    await program.parseAsync(["node", "ix", "view", ...args]);
  } finally {
    log.mockRestore();
  }
  return output.join("\n");
}

function seedRunningState(port?: number): void {
  writeFileSync(pidFile(), "4242");
  writeFileSync(scopeFile(), "*all*");
  if (port !== undefined) writeFileSync(portFile(), String(port));
}

describe("view running port state", () => {
  it("persists the port used to launch the visualizer", async () => {
    const output = await runView(["-p", "19123", "start", "--no-open", "--all"]);

    expect(readFileSync(portFile(), "utf-8")).toBe("19123");
    expect(output).toContain("http://localhost:19123");
  });

  it("reports the persisted port instead of a new requested port", async () => {
    seedRunningState(19123);
    vi.spyOn(process, "kill").mockReturnValue(true);

    const output = await runView(["-p", "19124", "start", "--no-open", "--all"]);

    expect(output).toContain("Visualizer is already running (PID 4242)");
    expect(output).toContain("http://localhost:19123");
    expect(output).not.toContain("http://localhost:19124");
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("recovers the running port from a pre-port-file server script", async () => {
    seedRunningState();
    mkdirSync(join(ixHome, "tmp"), { recursive: true });
    writeFileSync(serverScriptFile(), "const PORT = 19123;\n");
    vi.spyOn(process, "kill").mockReturnValue(true);

    const output = await runView(["-p", "19124", "start", "--no-open", "--all"]);

    expect(output).toContain("http://localhost:19123");
    expect(readFileSync(portFile(), "utf-8")).toBe("19123");
  });

  it("does not print a requested port when legacy state cannot reveal the real one", async () => {
    seedRunningState();
    vi.spyOn(process, "kill").mockReturnValue(true);

    const output = await runView(["-p", "19124", "start", "--no-open", "--all"]);

    expect(output).toContain("The running visualizer's port is unknown.");
    expect(output).not.toContain("http://localhost:19124");
  });

  it("removes port and scope state with a stale PID", async () => {
    seedRunningState(19123);
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });

    const output = await runView(["status"]);

    expect(output).toContain("Visualizer is not running.");
    expect(existsSync(pidFile())).toBe(false);
    expect(existsSync(scopeFile())).toBe(false);
    expect(existsSync(portFile())).toBe(false);
  });

  it("removes persisted state when the visualizer stops", async () => {
    seedRunningState(19123);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);

    const output = await runView(["stop"]);

    expect(output).toContain("Visualizer stopped (PID 4242)");
    expect(kill).toHaveBeenCalledWith(4242, "SIGTERM");
    expect(existsSync(pidFile())).toBe(false);
    expect(existsSync(scopeFile())).toBe(false);
    expect(existsSync(portFile())).toBe(false);
  });
});
