import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalMapRoot, resolveMapRoot, selectMapRootCandidate } from "../map-root.js";
import { lockPathForTest } from "../single-flight.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "ix-map-root-"));
  fixtures.push(dir);
  return dir;
}

describe("map root resolution", () => {
  it("uses the registered workspace root when invoked from a subdirectory without a path", () => {
    const root = fixture();
    const nested = join(root, "src", "commands");
    mkdirSync(nested, { recursive: true });

    expect(selectMapRootCandidate(undefined, nested, root, undefined)).toBe(root);
  });

  it("uses the git root when no workspace is registered", () => {
    const root = fixture();
    const nested = join(root, "src");
    mkdirSync(nested, { recursive: true });

    expect(selectMapRootCandidate(undefined, nested, undefined, root)).toBe(root);
  });

  it("resolves an unregistered nested cwd to its git root", () => {
    const root = fixture();
    const nested = join(root, "src", "commands");
    mkdirSync(nested, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });

    expect(resolveMapRoot(undefined, nested)).toBe(realpathSync.native(root));
  });

  it.skipIf(process.platform === "win32")("canonicalizes a symlink before deriving workspace identity", () => {
    const root = fixture();
    const real = join(root, "real");
    const linked = join(root, "linked");
    mkdirSync(real);
    symlinkSync(real, linked, "dir");

    expect(canonicalMapRoot(linked)).toBe(realpathSync.native(real));
    expect(lockPathForTest(linked)).toBe(lockPathForTest(real));
  });

  it("rejects a missing path before bootstrap can register it", () => {
    const root = fixture();
    const missing = join(root, "missing");

    expect(() => resolveMapRoot(missing, root)).toThrow(`Map path does not exist: ${missing}`);
  });

  it("rejects a file path before bootstrap can register it", () => {
    const root = fixture();
    const file = join(root, "file.ts");
    writeFileSync(file, "export {};\n");

    expect(() => canonicalMapRoot(file)).toThrow(`Map path is not a directory: ${file}`);
  });
});
