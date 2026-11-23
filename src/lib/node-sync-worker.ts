import { db } from "@/lib/db";
import { pullNodeTraffic, type NodeRow, type NodeTrafficSnapshot } from "@/lib/nodes-sync";

/* ============================================================
   Sephiroth · Multi-node — periodic sync worker
   Hooked into the 60 s maintenance interval (server.ts): keeps
   every enabled node's status/latency fresh without a manual
   refresh and caches the latest traffic snapshot so the stats
   view survives short agent outages.
   ============================================================ */

const CACHE_TTL_MS = 90_000;

const latestTraffic = new Map<string, { snapshot: NodeTrafficSnapshot; at: number }>();

/** Latest cached traffic snapshot for a node, if it is fresh enough. */
export function getCachedNodeTraffic(nodeId: string): NodeTrafficSnapshot | null {
  const hit = latestTraffic.get(nodeId);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.snapshot;
}

/**
 * One sync pass over all enabled nodes. Runs in the maintenance loop;
 * every failure is contained per node so one offline agent cannot
 * starve the others.
 */
export async function runNodeSyncTick(): Promise<void> {
  let nodes: unknown[];
  try {
    nodes = await db.node.findMany();
  } catch (err) {
    console.error("[node-sync] failed to list nodes:", err);
    return;
  }
  await Promise.allSettled(
    (nodes as NodeRow[])
      .filter((n) => n.enable)
      .map(async (node) => {
        try {
          const result = await pullNodeTraffic(node);
          if (result.ok) {
            latestTraffic.set(node.id, { snapshot: result.traffic, at: Date.now() });
          }
        } catch (err) {
          console.error(`[node-sync] tick failed for node "${node.name}":`, err);
        }
      }),
  );
}
