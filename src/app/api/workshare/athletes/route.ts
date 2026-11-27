import {
  readWorkshareBody,
  withWorkshareStaff,
  workshareDatabaseError,
  workshareResponse,
} from "@/features/workshare/lib/server-api";
import type { Json } from "@/lib/supabase/database.types";

export async function GET(request: Request) {
  return withWorkshareStaff(request, false, async (client) => {
    const groups = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await client
        .from("workshare_groups")
        .select("id, name, coach, updated_at, sort_order")
        .neq("id", "unassigned")
        .order("sort_order")
        .order("id")
        .range(from, from + 499);
      if (error) return workshareDatabaseError(error);
      groups.push(...(data ?? []));
      if (!data || data.length < 500) break;
    }
    if (new URL(request.url).searchParams.get("groupsOnly") === "1")
      return workshareResponse({ data: groups });
    const { data: accounts, error } = await client.rpc(
      "list_workshare_accounts",
    );
    if (error) return workshareDatabaseError(error);
    return workshareResponse({ data: { groups, accounts } });
  });
}
export async function POST(request: Request) {
  return withWorkshareStaff(request, true, async (client) => {
    const input = await readWorkshareBody(request);
    const reorder =
      input !== null &&
      typeof input === "object" &&
      "action" in input &&
      input.action === "reorderGroups";
    const { data, error } = await client.rpc(
      reorder ? "reorder_workshare_groups" : "manage_workshare_athletes",
      {
        input: input as Json,
      },
    );
    if (error) return workshareDatabaseError(error);
    return workshareResponse({ data });
  });
}
