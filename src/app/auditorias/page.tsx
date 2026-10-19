import { redirect } from "next/navigation";

// Preserve old bookmarks without keeping the audit interface.
export default function LegacyAuditsPage() {
  redirect("/ferramentas");
}
