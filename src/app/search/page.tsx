import { AppShell } from "@/components/layout/AppShell";
import { SearchExperimentalTab } from "@/features/search-experimental/SearchExperimentalTab";

// The former experimental search (map-drawn AOIs + "More like this") is now
// the production Search tab. The previous implementation remains in
// src/features/search/ (unrouted) as a rollback path.
export default function Page() {
  return (
    <AppShell>
      <SearchExperimentalTab />
    </AppShell>
  );
}
