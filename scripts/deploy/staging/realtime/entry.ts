/**
 * Sephiroth realtime bundle entry — everything the production server needs.
 *
 * Build layout (assembled by scripts/deploy/build.sh):
 *   rt/sim.ts      ← mini-services/core-sim/sim.ts (verbatim)
 *   rt/types.ts    ← mini-services/core-sim/types.ts (verbatim)
 *   rt/db.ts       ← staging/realtime/sim-db.ts (Prisma mirror replaces bun:sqlite)
 *   rt/entry.ts    ← this file
 *
 * `bun build --target=node --format=cjs --external:@prisma/client` inlines
 * sim.ts + the Prisma db shim into a single sim.js. server.js requires
 * ./realtime/sim.js (CoreSim) and ./realtime/sim-db.js (poll API — emitted
 * because db.ts re-exports it under the same names).
 */
export { CoreSim } from './sim'
export {
  pollInbounds,
  pollTickMs,
  getTickMs,
  readInbounds,
  refreshTickMs,
} from './db'
