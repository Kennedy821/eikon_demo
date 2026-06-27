import fs from "node:fs";
import path from "node:path";
import { AppShell } from "@/components/layout/AppShell";
import { DocsView } from "@/features/docs/DocsView";

export default function Page() {
  let content = "Documentation file not found.";
  try {
    content = fs.readFileSync(
      path.join(process.cwd(), "src/content/EIKON_SDK_DOCUMENTATION.md"),
      "utf-8",
    );
  } catch {
    /* fall back to the message above */
  }
  return (
    <AppShell>
      <DocsView content={content} />
    </AppShell>
  );
}
