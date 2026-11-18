import { redirect } from "next/navigation";
import { getTimesView, timesViewPaths } from "@/lib/tool-directory";

// Preserve shared selections from the former query-based tools page.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const view = getTimesView(
    Array.isArray(search.view) ? search.view[0] : search.view ?? null,
  );
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (key === "view" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }
  const query = params.toString();
  redirect(`${timesViewPaths[view]}${query ? `?${query}` : ""}`);
}
