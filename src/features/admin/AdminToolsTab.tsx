"use client";

import { CostCalculator } from "./CostCalculator";

export function AdminToolsTab() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-eikon-midnight">Admin Tools</h1>
        <p className="text-sm text-eikon-muted">
          Estimate the cost of a remote visual inspection.
        </p>
      </div>
      <CostCalculator />
    </div>
  );
}
