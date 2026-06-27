import { AppShell } from "@/components/layout/AppShell";
import { MemoryTab } from "@/features/memory/MemoryTab";

export default function Page() {
  return (
    <AppShell>
      <MemoryTab />
    </AppShell>
  );
}
