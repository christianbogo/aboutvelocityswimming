import { parseAccountPathId, parseRequirements } from "@/features/workshare/lib/tickets-validation";
import { readWorkshareBody, withWorkshareStaff, workshareDatabaseError, workshareResponse } from "@/features/workshare/lib/server-api";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return withWorkshareStaff(request, true, async (client) => {
    const account_id = parseAccountPathId((await context.params).id);
    const input = parseRequirements(await readWorkshareBody(request));
    const { data, error } = await client.rpc("save_workshare_requirements", { account_id, input });
    return error ? workshareDatabaseError(error) : workshareResponse({ data });
  });
}
