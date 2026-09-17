import { AppShell } from "@/components/layout/AppShell";
import { AdminGate } from "@/features/admin/AdminGate";
import { AdminToolsTab } from "@/features/admin/AdminToolsTab";

export default function Page() {
  return (
    <AppShell>
      <AdminGate>
        <AdminToolsTab />
      </AdminGate>
    </AppShell>
  );
}
