import { parseSeasonCreate } from "@/features/workshare/lib/tickets-validation";
import { readWorkshareBody, withWorkshareStaff, workshareDatabaseError, workshareResponse } from "@/features/workshare/lib/server-api";

export async function GET(request: Request) {
  return withWorkshareStaff(request, false, async (client) => {
    const { data, error } = await client.rpc("list_workshare_seasons");
    return error ? workshareDatabaseError(error) : workshareResponse({ data });
  });
}
export async function POST(request: Request) {
  return withWorkshareStaff(request, true, async (client) => {
    const input = parseSeasonCreate(await readWorkshareBody(request));
    const { data, error } = await client.rpc("create_workshare_season", { input });
    return error ? workshareDatabaseError(error) : workshareResponse({ data }, 201);
  });
}
