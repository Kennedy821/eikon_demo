import { AppShell } from "@/components/layout/AppShell";
import { SiteSelectionTab } from "@/features/site-selection/SiteSelectionTab";

export default function Page() {
  return (
    <AppShell>
      <SiteSelectionTab />
    </AppShell>
  );
}
