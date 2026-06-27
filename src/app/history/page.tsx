import { AppShell } from "@/components/layout/AppShell";
import { HistoryTab } from "@/features/history/HistoryTab";

export default function Page() {
  return (
    <AppShell>
      <HistoryTab />
    </AppShell>
  );
}
