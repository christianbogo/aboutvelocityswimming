import { parseTicketDelete, parseTicketUpdate, parseWorkshareId } from "@/features/workshare/lib/tickets-validation";
import { readWorkshareBody, withWorkshareStaff, workshareDatabaseError, workshareResponse } from "@/features/workshare/lib/server-api";

type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  return withWorkshareStaff(request, true, async (client) => {
    const ticket_id = parseWorkshareId((await context.params).id, "Ticket");
    const input = parseTicketUpdate(await readWorkshareBody(request));
    const { data, error } = await client.rpc("update_workshare_ticket", { ticket_id, input });
    return error ? workshareDatabaseError(error) : workshareResponse({ data });
  });
}
export async function DELETE(request: Request, context: Context) {
  return withWorkshareStaff(request, true, async (client) => {
    const ticket_id = parseWorkshareId((await context.params).id, "Ticket");
    const input = parseTicketDelete(await readWorkshareBody(request));
    const { data, error } = await client.rpc("delete_workshare_ticket", { ticket_id, expected_version: input.updatedAt });
    return error ? workshareDatabaseError(error) : workshareResponse({ data });
  });
}
