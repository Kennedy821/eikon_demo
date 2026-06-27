import { AppShell } from "@/components/layout/AppShell";
import { DroneCorridorTab } from "@/features/drone/DroneCorridorTab";

export default function Page() {
  return (
    <AppShell>
      <DroneCorridorTab />
    </AppShell>
  );
}
