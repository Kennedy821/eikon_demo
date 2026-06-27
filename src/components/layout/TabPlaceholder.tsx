import { AppShell } from "./AppShell";

/** Temporary placeholder for tabs not yet migrated. Remove as each ships. */
export function TabPlaceholder({
  title,
  phase,
  notes,
}: {
  title: string;
  phase: string;
  notes?: string;
}) {
  return (
    <AppShell>
      <h1 className="text-2xl font-bold text-eikon-midnight">{title}</h1>
      <p className="mt-2 text-eikon-muted">
        Not yet migrated — scheduled for {phase}. See
        <code className="mx-1">EIKON_FRONTEND_MIGRATION_PLAN.md</code>.
      </p>
      {notes && <p className="mt-2 text-sm text-eikon-muted">{notes}</p>}
    </AppShell>
  );
}
