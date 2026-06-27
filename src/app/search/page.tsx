import { AppShell } from "@/components/layout/AppShell";
import { SearchTab } from "@/features/search/SearchTab";

export default function Page() {
  return (
    <AppShell>
      <SearchTab />
    </AppShell>
  );
}
