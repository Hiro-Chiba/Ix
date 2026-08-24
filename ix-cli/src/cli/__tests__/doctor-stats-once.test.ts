import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const statsCalls: Array<{ workspaceId?: string; systemId?: string } | undefined> = [];
const scope = {
  workspaceId: "workspace-current" as string | undefined,
  systemId: undefined as string | undefined,
};

vi.mock("../../client/api.js", () => ({
  IxClient: class {
    async stats(opts?: { workspaceId?: string; systemId?: string }) {
      statsCalls.push(opts);
      // Both ids undefined is the unscoped call, not a match on a scope that
      // happens to be unset — compare only ids that are actually present, or
      // `undefined === undefined` silently answers with the workspace figure.
      const scoped =
        (opts?.workspaceId !== undefined && opts.workspaceId === scope.workspaceId) ||
        (opts?.systemId !== undefined && opts.systemId === scope.systemId);
      if (scoped) return { nodes: { total: 3457 }, edges: { total: 10365 } };
      return { nodes: { total: 22969 }, edges: { total: 10365 } };
    }
    async conflicts() { return []; }
    async health() { return { status: "ok" }; }
  },
}));

vi.mock("../bootstrap.js", async (orig) => ({
  ...(await orig<typeof import("../bootstrap.js")>()),
  resolveWorkspaceId: () => scope.workspaceId,
}));

vi.mock("../resolve.js", async (orig) => ({
  ...(await orig<typeof import("../resolve.js")>()),
  resolveReadSystemId: async () => scope.systemId,
}));

// Doctor also inspects the live container and probes the schema. Both are
// mocked, not merely pointed somewhere harmless: an unmocked `docker inspect`
// or socket connect is slow-and-variable rather than fast-and-failing, which is
// how this test timed out at 5s on the Windows runner while passing on Linux.
vi.mock("../backend-status.js", async (orig) => ({
  ...(await orig<typeof import("../backend-status.js")>()),
  checkBackendImage: () => ({ kind: "docker-unavailable" as const }),
  checkBackendSchema: async () => ({ ok: true as const }),
  isNonStandardBackend: () => false,
}));

vi.mock("../commands/upgrade.js", async (orig) => ({
  ...(await orig<typeof import("../commands/upgrade.js")>()),
  readBackendHealth: async () => ({ status: "ok", schema_version: 3 }),
}));

let savedEndpoint: string | undefined;

beforeEach(() => {
  vi.resetModules();
  statsCalls.length = 0;
  scope.workspaceId = "workspace-current";
  scope.systemId = undefined;
  // Belt and braces with the mocks above: nothing in this test may depend on a
  // backend being reachable, or on how quickly a given OS refuses a connection.
  savedEndpoint = process.env.IX_ENDPOINT;
  process.env.IX_ENDPOINT = "http://127.0.0.1:9";
});

afterEach(() => {
  if (savedEndpoint === undefined) delete process.env.IX_ENDPOINT;
  else process.env.IX_ENDPOINT = savedEndpoint;
});

async function runDoctor(): Promise<string[]> {
  const { registerDoctorCommand } = await import("../commands/doctor.js");
  const program = new Command();
  program.name("ix").exitOverride();
  registerDoctorCommand(program);
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args) => lines.push(args.join(" ")));
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await program.parseAsync(["doctor", "--format", "llm"], { from: "user" });
  } catch { /* exitOverride / process.exit path */ } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return lines;
}

describe("ix doctor", () => {
  /**
   * "Graph has nodes" and "Graph has edges" are two questions about one
   * response, and they were two `client.stats()` calls run back to back by the
   * sequential check loop. `/v1/stats` is 3-4s on a large graph, so the second
   * one was roughly half of what `ix doctor` spent.
   */
  it("asks the backend for stats once, not once per check that reads it", async () => {
    await runDoctor();
    expect(statsCalls).toHaveLength(1);
  });

  it("reports active workspace counts rather than unscoped tombstones", async () => {
    const lines = await runDoctor();

    expect(statsCalls).toEqual([{ workspaceId: "workspace-current", systemId: undefined }]);
    expect(lines).toContain('check name="Graph has nodes" status=ok detail="3457 nodes in this workspace"');
  });

  it("uses the active system scope for a co-ingested workspace", async () => {
    scope.systemId = "system-current";

    const lines = await runDoctor();

    expect(statsCalls).toEqual([{ workspaceId: undefined, systemId: "system-current" }]);
    expect(lines).toContain('check name="Graph has nodes" status=ok detail="3457 nodes in this system"');
  });

  it("says the count is unscoped when no workspace is registered", async () => {
    // A count of everything is not wrong here, but it is the one case where
    // naming a scope would be — there is no active workspace to name.
    scope.workspaceId = undefined;

    const lines = await runDoctor();

    expect(lines).toContain('check name="Graph has nodes" status=ok detail="22969 nodes in all workspaces"');
  });
});
