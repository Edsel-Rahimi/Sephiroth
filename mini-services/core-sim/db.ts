/**
 * Sephiroth core-sim — direct in-memory/persistent DB mirror reader.
 * Bridges the panel's `Inbound` and `ServerSetting` tables directly into CoreSim
 * with zero SQLite file-locking or Bun-only native dependency issues.
 */
import { db } from "../../src/lib/db";

export interface DbInboundRow {
  tag: string;
  protocol: string;
  port: number;
  transport: string;
  security: string;
  status: string;
}

export function readInbounds(): DbInboundRow[] | null {
  try {
    const rows = db._syncReadInbounds();
    return rows.length > 0 ? rows : null;
  } catch (err) {
    console.error("[core-sim/db] readInbounds error:", err);
    return null;
  }
}

const TICK_DEFAULT_MS = 1000;
let tickMs = TICK_DEFAULT_MS;
let lastTickRead = 0;

export function getTickMs(): number {
  return tickMs;
}

export function refreshTickMs(): void {
  const now = Date.now();
  if (now - lastTickRead < 3000) return;
  lastTickRead = now;
  try {
    const val = db._syncReadSetting("set_core_tick_seconds");
    const sec = Number(val);
    if (Number.isInteger(sec) && sec >= 1 && sec <= 5) {
      tickMs = sec * 1000;
    } else {
      tickMs = TICK_DEFAULT_MS;
    }
  } catch {
    tickMs = TICK_DEFAULT_MS;
  }
}
