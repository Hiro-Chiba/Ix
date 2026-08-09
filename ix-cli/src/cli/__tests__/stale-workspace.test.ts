import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { IxClient } from "../../client/api.js";
import { ingestMtimeCachePath } from "../config.js";
import { loadIngestBaseline } from "../ingest-baseline.js";
import { persistIngestBaselineIfClean } from "../commands/ingest.js";
import { detectStaleFiles } from "../stale.js";

let home: string;
let savedHome: string | undefined;
let savedProfile: string | undefined;

const noPatchReads = {
  listPatches: async () => {
    throw new Error("global patches must not be read");
  },
  stats: async () => {
    throw new Error("global stats must not be read");
  },
} as unknown as IxClient;

function writeSource(root: string, name: string, source: string): string {
  fs.mkdirSync(root, { recursive: true });
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, source);
  return filePath;
}

function moveMtimeForward(filePath: string): number {
  const next = fs.statSync(filePath).mtimeMs + 2_000;
  fs.utimesSync(filePath, next / 1_000, next / 1_000);
  return fs.statSync(filePath).mtimeMs;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "ix-stale-workspace-"));
  savedHome = process.env.HOME;
  savedProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(() => {
  process.env.HOME = savedHome;
  process.env.USERPROFILE = savedProfile;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("workspace-scoped staleness", () => {
  it("keeps workspace A stale after workspace B records a newer ingest", async () => {
    const rootA = path.join(home, "a");
    const rootB = path.join(home, "b");
    const fileA = writeSource(rootA, "a.js", "export const value = 'a';\n");
    const fileB = writeSource(rootB, "b.js", "export const value = 'b';\n");
    const ingestedA = new Date("2026-08-09T18:00:00.000Z");

    expect(
      persistIngestBaselineIfClean(
        rootA,
        new Map([[fileA, fs.statSync(fileA).mtimeMs]]),
        11,
        0,
        0,
        ingestedA,
      ),
    ).toBe(true);

    moveMtimeForward(fileA);
    const beforeB = await detectStaleFiles(noPatchReads, rootA);
    expect(beforeB).toEqual({
      lastIngestAt: ingestedA.toISOString(),
      currentRev: 11,
      staleFiles: 1,
      sampleChangedFiles: ["a.js"],
    });

    expect(
      persistIngestBaselineIfClean(
        rootB,
        new Map([[fileB, fs.statSync(fileB).mtimeMs]]),
        12,
        0,
        0,
        new Date("2026-08-09T18:01:00.000Z"),
      ),
    ).toBe(true);

    expect(await detectStaleFiles(noPatchReads, rootA)).toEqual(beforeB);
  });

  it("loads the legacy mtime-only cache and uses its own file timestamp", async () => {
    const root = path.join(home, "legacy");
    const filePath = writeSource(root, "legacy.js", "export const value = 1;\n");
    const originalMtime = fs.statSync(filePath).mtimeMs;
    const cachePath = ingestMtimeCachePath(root);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        root,
        files: { [filePath]: originalMtime },
      }),
    );
    const legacyTimestamp = new Date("2026-08-09T17:00:00.000Z");
    fs.utimesSync(cachePath, legacyTimestamp, legacyTimestamp);
    moveMtimeForward(filePath);

    const result = await detectStaleFiles(noPatchReads, root);
    expect(result.currentRev).toBe(0);
    expect(result.lastIngestAt).toBe(fs.statSync(cachePath).mtime.toISOString());
    expect(result.staleFiles).toBe(1);
    expect(result.sampleChangedFiles).toEqual(["legacy.js"]);
  });

  it("returns the unmapped state when the workspace has no baseline", async () => {
    const root = path.join(home, "unmapped");
    writeSource(root, "new.js", "export const value = 1;\n");

    expect(await detectStaleFiles(noPatchReads, root)).toEqual({
      lastIngestAt: null,
      currentRev: 0,
      staleFiles: 0,
      sampleChangedFiles: [],
    });
  });

  it("uses ingest time for files absent from the mtime cache", async () => {
    const root = path.join(home, "partial-cache");
    const mappedFile = writeSource(root, "mapped.js", "export const mapped = true;\n");
    const uncachedFile = writeSource(root, "uncached.js", "");
    const ingestedAt = new Date("2026-08-09T18:00:00.000Z");
    fs.utimesSync(
      uncachedFile,
      new Date(ingestedAt.getTime() - 1_000),
      new Date(ingestedAt.getTime() - 1_000),
    );
    persistIngestBaselineIfClean(
      root,
      new Map([[mappedFile, fs.statSync(mappedFile).mtimeMs]]),
      13,
      0,
      0,
      ingestedAt,
    );

    expect((await detectStaleFiles(noPatchReads, root)).staleFiles).toBe(0);

    fs.utimesSync(
      uncachedFile,
      new Date(ingestedAt.getTime() + 1_000),
      new Date(ingestedAt.getTime() + 1_000),
    );
    expect(await detectStaleFiles(noPatchReads, root)).toMatchObject({
      staleFiles: 1,
      sampleChangedFiles: ["uncached.js"],
    });
  });

  it.each([
    { parseErrors: 1, commitErrors: 0 },
    { parseErrors: 0, commitErrors: 1 },
  ])("does not advance the baseline when a map fails", async ({ parseErrors, commitErrors }) => {
    const root = path.join(home, "failed-map");
    const filePath = writeSource(root, "index.js", "export const value = 1;\n");
    const oldMtime = fs.statSync(filePath).mtimeMs;
    const oldTimestamp = new Date("2026-08-09T16:00:00.000Z");
    persistIngestBaselineIfClean(root, new Map([[filePath, oldMtime]]), 7, 0, 0, oldTimestamp);

    const changedMtime = moveMtimeForward(filePath);
    expect(
      persistIngestBaselineIfClean(
        root,
        new Map([[filePath, changedMtime]]),
        8,
        parseErrors,
        commitErrors,
        new Date("2026-08-09T16:01:00.000Z"),
      ),
    ).toBe(false);

    const baseline = loadIngestBaseline(root);
    expect(baseline?.currentRev).toBe(7);
    expect(baseline?.lastIngestAt).toBe(oldTimestamp.toISOString());
    expect(baseline?.files.get(filePath)).toBe(oldMtime);
    expect((await detectStaleFiles(noPatchReads, root)).staleFiles).toBe(1);
  });
});
