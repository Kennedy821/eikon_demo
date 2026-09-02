import { AppShell } from "@/components/layout/AppShell";
import { RemoteAssessmentTab } from "@/features/remote-assessment/RemoteAssessmentTab";

export default function Page() {
  return (
    <AppShell>
      <RemoteAssessmentTab />
    </AppShell>
  );
}
