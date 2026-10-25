"use client";

import { HeaderRow } from "@/components/sephiroth/dashboard/header-row";
import { ChartsRow } from "@/components/sephiroth/dashboard/charts-row";
import { MidRow } from "@/components/sephiroth/dashboard/mid-row";
import { BottomRow } from "@/components/sephiroth/dashboard/bottom-row";
import { ActivityFeed } from "@/components/sephiroth/dashboard/activity-feed";

/**
 * Sephiroth fusion dashboard —
 * Resq.io structure × Stakent asset cards × Donezo gauge,
 * rebuilt in obsidian + cyan + platinum DNA.
 * All values stream live from the core driver (Phase 2).
 */
export function DashboardView() {
  return (
    <div className="pt-6">
      <HeaderRow />
      <div className="mt-6">
        <ChartsRow />
      </div>
      <div className="mt-4">
        <MidRow />
      </div>
      <BottomRow />
      <div className="mt-4 grid grid-cols-12 gap-4">
        <ActivityFeed />
      </div>
    </div>
  );
}
