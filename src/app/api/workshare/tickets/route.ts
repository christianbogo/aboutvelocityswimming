import { parseTicketCreate, parseTicketFilters } from "@/features/workshare/lib/tickets-validation";
import { readWorkshareBody, withWorkshareStaff, workshareDatabaseError, workshareResponse } from "@/features/workshare/lib/server-api";

export async function GET(request: Request) {
  return withWorkshareStaff(request, false, async (client) => {
    const input = parseTicketFilters(new URL(request.url).searchParams);
    const { data, error } = await client.rpc("list_workshare_tickets", { input });
    return error ? workshareDatabaseError(error) : workshareResponse({ data });
  });
}
export async function POST(request: Request) {
  return withWorkshareStaff(request, true, async (client) => {
    const input = parseTicketCreate(await readWorkshareBody(request));
    const { data, error } = await client.rpc("create_workshare_ticket", { input });
    return error ? workshareDatabaseError(error) : workshareResponse({ data }, 201);
  });
}
