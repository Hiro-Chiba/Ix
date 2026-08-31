import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { resolveWorkspaceRoot } from "./config.js";

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
  const candidate = pathArg ? resolve(cwd, pathArg) : resolveWorkspaceRoot(undefined, cwd);
  return canonicalMapRoot(candidate);
}
