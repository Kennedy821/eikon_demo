import { AppShell } from "@/components/layout/AppShell";
import { ObjectDetectionTab } from "@/features/object-detection/ObjectDetectionTab";

export default function Page() {
  return (
    <AppShell>
      <ObjectDetectionTab />
    </AppShell>
  );
}
