import { describe, expect, it, vi } from "vitest";

import type { GraphPatchPayload } from "../../client/types.js";
import {
  patchRequiresPerFileCommit,
  planDeletedFileRecovery,
  reconcileRemovedEntities,
} from "../commands/ingest.js";

function patchWith(ops: GraphPatchPayload["ops"]): GraphPatchPayload {
  return {
    patchId: "next-patch",
    actor: "ix/ingestion",
    timestamp: "2026-08-10T00:00:00.000Z",
    source: {
      uri: "src/example.ts",
      sourceHash: "next-hash",
      extractor: "tree-sitter/1.24",
      sourceType: "code",
      workspaceId: "deadbeef",
    },
    baseRev: 0,
    ops,
    replaces: [],
  };
}

describe("reconcileRemovedEntities", () => {
  it("routes patches with deletion ops away from the bulk endpoint", () => {
    expect(patchRequiresPerFileCommit(patchWith([{ type: "DeleteNode", id: "old-node" }]))).toBe(true);
    expect(patchRequiresPerFileCommit(patchWith([{ type: "DeleteEdge", id: "old-edge" }]))).toBe(true);
    expect(patchRequiresPerFileCommit(patchWith([{ type: "UpsertNode", id: "node" }]))).toBe(false);
  });

  it("reingests surviving dependents when a deleted file returns", () => {
    const deletedFiles = new Map([
      ["src/returned.ts", ["src/caller.ts", "src/missing.ts"]],
      ["src/still-deleted.ts", ["src/other.ts"]],
    ]);

    const plan = planDeletedFileRecovery(
      "/workspace",
      ["/workspace/src/returned.ts", "/workspace/src/caller.ts"],
      deletedFiles,
    );

    expect(plan.recreatedPaths).toEqual(["/workspace/src/returned.ts"]);
    expect(plan.previousDeletedFiles).toEqual(
      new Map([
        ["/workspace/src/returned.ts", ["src/caller.ts", "src/missing.ts"]],
        ["/workspace/src/still-deleted.ts", ["src/other.ts"]],
      ]),
    );
    expect(plan.forceReingestPaths).toEqual(new Set(["/workspace/src/caller.ts"]));
    expect(plan.nextDeletedFiles).toEqual(
      new Map([["/workspace/src/still-deleted.ts", ["src/other.ts"]]]),
    );
  });

  it("deletes removed nodes and their incident edges while preserving current entities", async () => {
    const getPatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("404: not found"))
      .mockResolvedValueOnce({
        data: {
          entityIds: ["kept-node", "removed-node", "kept-edge", "removed-edge"],
          nodeOpCount: 2,
          edgeOpCount: 2,
        },
      });
    const entity = vi.fn().mockResolvedValue({
      node: {},
      claims: [],
      edges: [
        { id: "removed-edge", provenance: { sourceUri: "src/example.ts" } },
        { id: "incoming-edge", provenance: { sourceUri: "src/caller.ts" } },
        { id: "kept-edge", provenance: { sourceUri: "src/example.ts" } },
      ],
    });
    const patch = patchWith([
      { type: "UpsertNode", id: "kept-node", kind: "file", name: "example.ts", attrs: {} },
      {
        type: "UpsertEdge",
        id: "kept-edge",
        src: "kept-node",
        dst: "kept-node",
        predicate: "CONTAINS",
        attrs: {},
      },
      { type: "AssertClaim", entityId: "kept-node", field: "calls:x", value: "x" },
    ]);

    const dependents = new Set<string>();
    const reconciled = await reconcileRemovedEntities(
      { getPatch, entity },
      patch,
      ["missing-patch", "previous-patch"],
      dependents,
    );

    expect(getPatch).toHaveBeenCalledTimes(2);
    expect(entity).toHaveBeenCalledWith("removed-node");
    expect(dependents).toEqual(new Set(["src/caller.ts"]));
    expect(reconciled.ops).toEqual([
      { type: "DeleteNode", id: "removed-node" },
      patch.ops[0],
      { type: "DeleteEdge", id: "removed-edge" },
      { type: "DeleteEdge", id: "incoming-edge" },
      patch.ops[1],
      patch.ops[2],
    ]);
  });

  it("does not repeat edge deletions from a prior tombstone when a file returns", async () => {
    const getPatch = vi.fn().mockResolvedValue({
      data: {
        ops: [
          { type: "DeleteNode", id: "returned-node" },
          { type: "DeleteEdge", id: "incoming-edge" },
        ],
      },
    });
    const entity = vi.fn();
    const patch = patchWith([
      { type: "UpsertNode", id: "returned-node", kind: "file", name: "example.ts" },
    ]);

    const reconciled = await reconcileRemovedEntities(
      { getPatch, entity },
      patch,
      ["tombstone-patch"],
    );

    expect(reconciled.ops).toEqual(patch.ops);
    expect(entity).not.toHaveBeenCalled();
  });

  it("fails closed when the previous patch has no entity manifest", async () => {
    const getPatch = vi.fn().mockResolvedValue({ data: {} });
    const entity = vi.fn();

    await expect(
      reconcileRemovedEntities({ getPatch, entity }, patchWith([]), ["previous-patch"]),
    ).rejects.toThrow("has no entity manifest");
    expect(entity).not.toHaveBeenCalled();
  });
});
