import { AppShell } from "@/components/layout/AppShell";
import { ChatTab } from "@/features/chat/ChatTab";

export default function Page() {
  return (
    <AppShell>
      <ChatTab />
    </AppShell>
  );
}
