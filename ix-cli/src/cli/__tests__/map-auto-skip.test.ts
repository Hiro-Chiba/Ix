import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { hostname } from 'node:os';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyRequestedMapCoalesceExitCode,
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
