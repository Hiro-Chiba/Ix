import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hostname } from 'node:os';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyRequestedMapCoalesceExitCode,
  describeEmptyCompletedMap,
  invalidateBaselineForEmptyCompletedMap,
  mapModeForIngest,
  registerMapCommand,
  requestedMapCoalesceExitCode,
  shouldSkipAutoMap,
} from '../commands/map.js';
import { lockPathForTest } from '../single-flight.js';

describe('shouldSkipAutoMap', () => {
  afterEach(() => { delete process.env.IX_AUTO_MAP_CLOUD; });

  it('skips an automatic map against a remote backend', () => {
    expect(shouldSkipAutoMap({ auto: true, cloudReady: true })).toBe(true);
  });

  it('never skips a manual map (auto=false), even against a remote backend', () => {
    expect(shouldSkipAutoMap({ auto: false, cloudReady: true })).toBe(false);
  });

  it('never skips an automatic map against a local backend', () => {
    expect(shouldSkipAutoMap({ auto: true, cloudReady: false })).toBe(false);
  });

  it('honors the IX_AUTO_MAP_CLOUD opt-in to allow remote auto-refresh', () => {
    process.env.IX_AUTO_MAP_CLOUD = '1';
    expect(shouldSkipAutoMap({ auto: true, cloudReady: true })).toBe(false);
  });
});

describe('requestedMapCoalesceExitCode', () => {
  it('accepts a private non-zero process exit code', () => {
    expect(requestedMapCoalesceExitCode('75')).toBe(75);
  });

  it.each([undefined, '', '0', '256', '1.5', 'nope'])('ignores invalid value %s', value => {
    expect(requestedMapCoalesceExitCode(value)).toBeUndefined();
  });

  it('applies the requested exit code on the map-lock coalesce path', () => {
    let applied: number | undefined;

    expect(applyRequestedMapCoalesceExitCode('75', code => { applied = code; })).toBe(true);
    expect(applied).toBe(75);
  });

  it('preserves normal exit behavior when the private option is absent', () => {
    const apply = vi.fn();

    expect(applyRequestedMapCoalesceExitCode(undefined, apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('makes the real map action exit before ingest when its lock is contended', async () => {
    const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ix-map-coalesce-'));
    const root = path.join(lockDir, 'workspace');
    fs.mkdirSync(root);
    process.env.IX_LOCK_DIR = lockDir;
    process.env.IX_MAP_COALESCE_EXIT_CODE = '75';
    fs.writeFileSync(lockPathForTest(root), JSON.stringify({
      pid: process.pid,
      host: hostname(),
      startedAt: Date.now(),
      label: 'held by test',
    }));

    try {
      const program = new Command();
      registerMapCommand(program);
      await program.parseAsync(['node', 'ix', 'map', root, '--silent']);
      expect(process.exitCode).toBe(75);
    } finally {
      process.exitCode = undefined;
      delete process.env.IX_LOCK_DIR;
      delete process.env.IX_MAP_COALESCE_EXIT_CODE;
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  });
});

describe('mapModeForIngest', () => {
  it('keeps ordinary map ingestion topology-only', () => {
    expect(mapModeForIngest(undefined)).toBe(true);
  });

  it('lets watch request full canonical patches after the map lock is acquired', () => {
    expect(mapModeForIngest('1')).toBe(false);
  });
});

describe('describeEmptyCompletedMap', () => {
  const emptyResult = {
    file_count: 0,
    region_count: 0,
    regions: [],
    outcome: 'full_local_completed',
  };

  it('rejects a completed empty map after a clean ingest committed source patches', () => {
    const message = describeEmptyCompletedMap(emptyResult, {
      filesDiscovered: 260,
      patchesApplied: 260,
      parseErrors: 0,
      commitErrors: 0,
    });

    expect(message).toContain('mapped 0 files after local ingest found 260 supported source files');
    expect(message).toContain('(260 patches committed)');
    expect(message).toContain('no architecture hierarchy was created');
    expect(message).toContain("the next 'ix map' re-parses every file");
  });

  it('does not reject an actually empty workspace', () => {
    expect(describeEmptyCompletedMap(emptyResult, {
      filesDiscovered: 0,
      patchesApplied: 0,
      parseErrors: 0,
      commitErrors: 0,
    })).toBeUndefined();
  });

  it('does not mask an ingest failure with a map-language diagnosis', () => {
    expect(describeEmptyCompletedMap(emptyResult, {
      filesDiscovered: 12,
      patchesApplied: 12,
      parseErrors: 1,
      commitErrors: 0,
    })).toBeUndefined();
    expect(describeEmptyCompletedMap(emptyResult, {
      filesDiscovered: 12,
      patchesApplied: 12,
      parseErrors: 0,
      commitErrors: 1,
    })).toBeUndefined();
  });

  it('ignores an outcome the backend does not actually send', () => {
    // 'ok' was in the completed set but is not one of the six MapOutcome
    // labels, so it only ever looked like coverage.
    expect(describeEmptyCompletedMap({ ...emptyResult, outcome: 'ok' }, {
      filesDiscovered: 260,
      patchesApplied: 260,
      parseErrors: 0,
      commitErrors: 0,
    })).toBeUndefined();
  });

  it('leaves guardrail refusals alone, which carry no regions by design', () => {
    for (const outcome of ['local_map_too_large', 'local_map_not_recommended']) {
      expect(describeEmptyCompletedMap({ ...emptyResult, outcome }, {
        filesDiscovered: 260,
        patchesApplied: 260,
        parseErrors: 0,
        commitErrors: 0,
      })).toBeUndefined();
    }
  });

  it('requires both an explicitly completed outcome and an entirely empty response', () => {
    expect(describeEmptyCompletedMap({ ...emptyResult, outcome: 'local_map_not_recommended' }, {
      filesDiscovered: 12,
      patchesApplied: 12,
      parseErrors: 0,
      commitErrors: 0,
    })).toBeUndefined();
    expect(describeEmptyCompletedMap({ ...emptyResult, file_count: 12 }, {
      filesDiscovered: 12,
      patchesApplied: 12,
      parseErrors: 0,
      commitErrors: 0,
    })).toBeUndefined();
    expect(describeEmptyCompletedMap({ ...emptyResult, region_count: 1 }, {
      filesDiscovered: 12,
      patchesApplied: 12,
      parseErrors: 0,
      commitErrors: 0,
    })).toBeUndefined();
  });

  it('invalidates the current workspace baseline, including on an unchanged retry', () => {
    const invalidate = vi.fn();
    const message = invalidateBaselineForEmptyCompletedMap(emptyResult, {
      filesDiscovered: 260,
      patchesApplied: 0,
      parseErrors: 0,
      commitErrors: 0,
    }, '/workspace/account', invalidate);

    expect(message).toContain('(0 patches committed)');
    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith('/workspace/account');
  });

  it('rejects an empty cached map when coupling is reported unchanged', () => {
    expect(describeEmptyCompletedMap({ ...emptyResult, outcome: 'coupling_unchanged' }, {
      filesDiscovered: 260,
      patchesApplied: 0,
      parseErrors: 0,
      commitErrors: 0,
    })).toBeDefined();
  });
});
