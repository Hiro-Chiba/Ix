import * as fs from "node:fs";
import * as path from "node:path";
import type { IxClient } from "../client/api.js";
import { resolveWorkspaceRoot } from "./config.js";
import { loadIngestBaseline } from "./ingest-baseline.js";
import { SUPPORTED_EXTENSIONS } from "./supported-extensions.js";

export interface StaleInfo {
  lastIngestAt: string | null;
  currentRev: number;
  staleFiles: number;
  sampleChangedFiles: string[];
}

const SUPPORTED_NAMES = new Set([
  ".gitignore", ".gitattributes", ".editorconfig", ".env",
  ".eslintrc", ".prettierrc", ".babelrc",
  "Makefile", "Dockerfile", "Procfile", "Gemfile", "Rakefile",
  "BUILD", "WORKSPACE",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target", ".next",
  ".cache", "__pycache__", ".ix", ".claude",
]);

/**
 * Walk a directory and collect file paths with supported extensions.
 * Bounded to prevent runaway on huge repos.
 */
function collectFiles(dir: string, limit: number = 5000): string[] {
  const results: string[] = [];
  const stack = [dir];

  while (stack.length > 0 && results.length < limit) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= limit) break;
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext) || SUPPORTED_NAMES.has(entry.name)) {
          results.push(fullPath);
        }
      }
    }
  }
  return results;
}

function differsFromIngestBaseline(
  filePath: string,
  mtimeMs: number,
  ingestedMtimes: Map<string, number>,
  lastIngestAt: string,
): boolean {
  const ingestedMtime = ingestedMtimes.get(filePath);
  return ingestedMtime === undefined
    ? mtimeMs > Date.parse(lastIngestAt)
    : ingestedMtime !== mtimeMs;
}

/**
 * Detect files that have been modified since the last ingest.
 * Uses the workspace-local ingest baseline so another workspace cannot advance it.
 */
export async function detectStaleFiles(
  _client: IxClient,
  root: string,
  maxSamples: number = 5
): Promise<StaleInfo> {
  const workspaceRoot = path.resolve(root);
  const baseline = loadIngestBaseline(workspaceRoot);
  if (!baseline) {
    return { lastIngestAt: null, currentRev: 0, staleFiles: 0, sampleChangedFiles: [] };
  }

  const files = collectFiles(workspaceRoot);
  const changedFiles: string[] = [];

  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      if (
        differsFromIngestBaseline(filePath, stat.mtimeMs, baseline.files, baseline.lastIngestAt)
      ) {
        // Make path relative to root for display
        const relative = path.relative(workspaceRoot, filePath);
        changedFiles.push(relative);
      }
    } catch {
      // skip inaccessible files
    }
  }

  return {
    lastIngestAt: baseline.lastIngestAt,
    currentRev: baseline.currentRev,
    staleFiles: changedFiles.length,
    sampleChangedFiles: changedFiles.slice(0, maxSamples),
  };
}

/**
 * Check if a specific file path differs from the active workspace's ingest baseline.
 */
export async function isFileStale(
  _client: IxClient,
  filePath: string
): Promise<boolean> {
  if (!fs.existsSync(filePath)) return false;

  const workspaceRoot = path.resolve(resolveWorkspaceRoot());
  const baseline = loadIngestBaseline(workspaceRoot);
  if (!baseline) return false;

  try {
    const absolutePath = path.resolve(filePath);
    return differsFromIngestBaseline(
      absolutePath,
      fs.statSync(absolutePath).mtimeMs,
      baseline.files,
      baseline.lastIngestAt,
    );
  } catch {
    return false;
  }
}
