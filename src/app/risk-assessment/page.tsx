import { AppShell } from "@/components/layout/AppShell";
import { RiskAssessmentTab } from "@/features/risk-assessment/RiskAssessmentTab";

export default function Page() {
  return (
    <AppShell>
      <RiskAssessmentTab />
    </AppShell>
  );
}
