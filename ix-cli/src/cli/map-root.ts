import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { findWorkspaceForCwd } from "./config.js";

export function selectMapRootCandidate(
  pathArg: string | undefined,
  cwd: string,
  registeredRoot?: string,
  gitRoot?: string,
): string {
  if (pathArg) return resolve(cwd, pathArg);
  return registeredRoot ?? gitRoot ?? cwd;
}

function findGitRoot(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function canonicalMapRoot(candidate: string): string {
  const resolved = resolve(candidate);
  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    throw new Error(`Map path does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Map path is not a directory: ${resolved}`);
  }
  return realpathSync.native(resolved);
}

export function resolveMapRoot(pathArg?: string, cwd = process.cwd()): string {
  const registeredRoot = pathArg ? undefined : findWorkspaceForCwd(cwd)?.root_path;
  const gitRoot = pathArg || registeredRoot ? undefined : findGitRoot(cwd);
  return canonicalMapRoot(selectMapRootCandidate(pathArg, cwd, registeredRoot, gitRoot));
}
