import * as fs from "node:fs";
import * as path from "node:path";
import { ingestMtimeCachePath } from "./config.js";

interface SerializedIngestBaseline {
  root: string;
  files: Record<string, number>;
  currentRev?: number;
  lastIngestAt?: string;
}

export interface IngestBaseline {
  files: Map<string, number>;
  currentRev: number;
  lastIngestAt: string;
}

export function loadIngestBaseline(projectRoot: string): IngestBaseline | null {
  const cachePath = ingestMtimeCachePath(projectRoot);
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as SerializedIngestBaseline;
    if (data.root !== projectRoot || !data.files || typeof data.files !== "object") return null;

    const files = new Map<string, number>();
    for (const [filePath, mtime] of Object.entries(data.files)) {
      if (Number.isFinite(mtime)) files.set(filePath, mtime);
    }

    const parsedTimestamp = data.lastIngestAt ? Date.parse(data.lastIngestAt) : Number.NaN;
    const lastIngestAt = Number.isFinite(parsedTimestamp)
      ? new Date(parsedTimestamp).toISOString()
      : fs.statSync(cachePath).mtime.toISOString();
    const currentRev =
      typeof data.currentRev === "number" &&
      Number.isInteger(data.currentRev) &&
      data.currentRev >= 0
        ? data.currentRev
        : 0;

    return { files, currentRev, lastIngestAt };
  } catch {
    return null;
  }
}

export function saveIngestBaseline(
  projectRoot: string,
  mtimes: Map<string, number>,
  currentRev: number,
  now: Date = new Date(),
): void {
  try {
    const previousRev = loadIngestBaseline(projectRoot)?.currentRev ?? 0;
    const data: SerializedIngestBaseline = {
      root: projectRoot,
      files: Object.fromEntries(mtimes),
      currentRev: currentRev > 0 ? currentRev : previousRev,
      lastIngestAt: now.toISOString(),
    };
    fs.mkdirSync(path.dirname(ingestMtimeCachePath(projectRoot)), { recursive: true });
    fs.writeFileSync(ingestMtimeCachePath(projectRoot), JSON.stringify(data));
  } catch {
    // The cache is an optimization and freshness hint. Ingestion itself succeeded.
  }
}
