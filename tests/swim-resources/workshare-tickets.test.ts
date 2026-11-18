import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serverClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
import { GET as seasonsGET, POST as seasonsPOST } from "@/app/api/workshare/seasons/route";
import { GET as ticketsGET, POST as ticketsPOST } from "@/app/api/workshare/tickets/route";
import { PUT as ticketPUT, DELETE as ticketDELETE } from "@/app/api/workshare/tickets/[id]/route";
import { PUT as requirementsPUT } from "@/app/api/workshare/accounts/[id]/requirements/route";
import { GET as accountsGET, PUT as accountsPUT } from "@/app/api/workshare/accounts/route";
import { parseRequirements, parseSeasonCreate, parseTicketCreate, parseTicketFilters, parseTicketUpdate, parseWorkshareDate } from "@/features/workshare/lib/tickets-validation";

const seasonId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ticketId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const updatedAt = "2026-11-18T20:00:00.123456+00:00";
const season = { id: seasonId, name: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31", copyFromSeasonId: null };
const fields = { completedOn: "2026-06-01", description: "Meet setup", category: "general", hours: 1.25 };
const ticket = { id: ticketId, accountId: "account-a", seasonId, ...fields };
const requirement = { seasonId, updatedAt: null, generalHoursRequired: null, starlightHoursRequired: 0, appleCapitalHoursRequired: 16 };
const context = { params: Promise.resolve({ id: ticketId }) };
function request(path: string, method = "GET", body?: unknown, origin = "https://velocity.example") {
  return new Request(`https://velocity.example/api/workshare/${path}`, { method,
    headers: { host: "velocity.example", origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("season and ticket validation", () => {
  it("requires explicit first-season details and validates inclusive date ranges", () => {
    expect(parseSeasonCreate({ ...season, name: "  2026 Season  " }).name).toBe("2026 Season");
    expect(() => parseSeasonCreate({ ...season, startsOn: "2026-02-30" })).toThrow("valid date");
    expect(() => parseSeasonCreate({ ...season, startsOn: "2027-01-01" })).toThrow("on or after");
    expect(() => parseSeasonCreate({ ...season, copyFromSeasonId: undefined })).toThrow("Source season");
    expect(() => parseSeasonCreate({ ...season, completed: 0 })).toThrow("Unsupported field");
    expect(() => parseWorkshareDate("0000-01-01")).toThrow();
  });
  it.each([0, -1, 10000.01, 1.001, "2", null, undefined, Infinity])("rejects invalid ticket hours %s", (hours) => {
    expect(() => parseTicketCreate({ ...ticket, hours })).toThrow("Ticket hours");
  });
  it("requires one known category, a description and immutable ticket ownership", () => {
    expect(parseTicketCreate({ ...ticket, description: " Setup " })).toMatchObject({ description: "Setup", hours: 1.25 });
    expect(() => parseTicketCreate({ ...ticket, category: ["general", "starlight"] })).toThrow("Select General");
    expect(() => parseTicketCreate({ ...ticket, description: "a".repeat(501) })).toThrow("500");
    expect(() => parseTicketUpdate({ ...fields, updatedAt, accountId: "other" })).toThrow("Unsupported field");
    expect(() => parseTicketUpdate({ ...fields, updatedAt: "yesterday" })).toThrow("exact version");
  });
  it("preserves null versus zero requirements without accepting totals", () => {
    expect(parseRequirements(requirement)).toEqual(requirement);
    expect(() => parseRequirements({ ...requirement, generalHoursRequired: -1 })).toThrow("Required hours");
    expect(() => parseRequirements({ ...requirement, completed: { general: 10 } })).toThrow("Unsupported field");
    expect(() => parseRequirements({ ...requirement, updatedAt: undefined })).toThrow("Version");
  });
  it("validates ticket filters and pagination before querying", () => {
    expect(parseTicketFilters(new URLSearchParams({ seasonId, accountId: "account-a", category: "general", from: "2026-01-01", to: "2026-12-31", q: " setup ", page: "2" })))
      .toMatchObject({ seasonId, accountId: "account-a", page: 2, q: "setup" });
    for (const query of [`seasonId=${seasonId}&page=0`, `seasonId=${seasonId}&page=1.5`, `seasonId=${seasonId}&category=other`,
      `seasonId=${seasonId}&from=2026-04-01&to=2026-01-01`, `seasonId=${seasonId}&page=1&page=2`, `seasonId=${seasonId}&completed=1`])
      expect(() => parseTicketFilters(new URLSearchParams(query))).toThrow();
  });
});

describe("staff seasons, requirements and tickets API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "synthetic-staff", email_confirmed_at: "2026-11-18T00:00:00Z" } }, error: null });
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "is_workshare_staff" ? true : [], error: null }));
  });
  it("keeps legacy account GET and explicitly scopes selected-season account summaries", async () => {
    expect((await accountsGET(request("accounts"))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_workshare_accounts");
    expect((await accountsGET(request(`accounts?seasonId=${seasonId}`))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_workshare_account_summaries", { season_id: seasonId });
    expect((await accountsGET(request("accounts?seasonId=bad"))).status).toBe(400);
  });
  it("accepts normalized core-only account saves without adding legacy quotas", async () => {
    const core = { id: "account-a", updatedAt, fullName: "  Account A  ", emails: [" PARENT@EXAMPLE.TEST "], athletes: [], isArchived: false };
    const response = await accountsPUT(request("accounts", "PUT", core));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("save_workshare_account", { input: { ...core, fullName: "Account A", emails: ["parent@example.test"] } });
    expect((await accountsPUT(request("accounts", "PUT", { ...core, completed: { general: 5 } }))).status).toBe(400);
  });
  it("lists seasons with private no-store headers", async () => {
    const response = await seasonsGET(request("seasons"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_workshare_seasons");
  });
  it("creates an explicit season and writes scoped requirements with separate versions", async () => {
    expect((await seasonsPOST(request("seasons", "POST", season))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenLastCalledWith("create_workshare_season", { input: season });
    expect((await requirementsPUT(request("accounts/account-a/requirements", "PUT", requirement), { params: Promise.resolve({ id: "account-a" }) })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("save_workshare_requirements", { account_id: "account-a", input: requirement });
  });
  it("creates, edits, deletes and filters individual tickets through protected RPCs", async () => {
    expect((await ticketsPOST(request("tickets", "POST", ticket))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenLastCalledWith("create_workshare_ticket", { input: ticket });
    expect((await ticketPUT(request(`tickets/${ticketId}`, "PUT", { updatedAt, ...fields }), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("update_workshare_ticket", { ticket_id: ticketId, input: { updatedAt, ...fields } });
    expect((await ticketDELETE(request(`tickets/${ticketId}`, "DELETE", { updatedAt }), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("delete_workshare_ticket", { ticket_id: ticketId, expected_version: updatedAt });
    expect((await ticketsGET(request(`tickets?seasonId=${seasonId}&page=2`))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_workshare_tickets", { input: { seasonId, page: 2 } });
  });
  it("rejects cross-origin mutations before authentication", async () => {
    const response = await ticketsPOST(request("tickets", "POST", ticket, "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { id: "unverified-domain", email: "coach@velocity-swimming.com", email_confirmed_at: null },
    { id: "anonymous-domain", email: "coach@velocity-swimming.com", email_confirmed_at: "2026-11-18T00:00:00Z", is_anonymous: true },
  ])("rejects unverified and anonymous identities before checking staff", async (user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    expect((await seasonsGET(request("seasons"))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects signed-out and nonstaff reads and writes", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await seasonsGET(request("seasons"))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "family", email_confirmed_at: "2026-11-18T00:00:00Z" } }, error: null });
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await ticketsPOST(request("tickets", "POST", ticket))).status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("is_workshare_staff");
  });
  it("rejects malformed, oversized, read-only and invalid writes before mutation RPCs", async () => {
    const malformed = new Request("https://velocity.example/api/workshare/tickets", { method: "POST", headers: { host: "velocity.example", origin: "https://velocity.example" }, body: "{" });
    expect((await ticketsPOST(malformed)).status).toBe(400);
    expect((await ticketsPOST(request("tickets", "POST", { ...ticket, description: "é".repeat(600000) }))).status).toBe(413);
    expect((await ticketsPOST(request("tickets", "POST", { ...ticket, total: 5 }))).status).toBe(400);
    expect((await ticketPUT(request(`tickets/${ticketId}`, "PUT", { ...fields, updatedAt, seasonId }), context)).status).toBe(400);
    expect((await ticketsGET(request("tickets?page=1"))).status).toBe(400);
    expect(mocks.rpc.mock.calls.every(([name]) => name === "is_workshare_staff")).toBe(true);
  });
  it.each([["40001", 409], ["23505", 409], ["P0002", 404], ["P0410", 410], ["23514", 400], ["23P01", 400], ["XX000", 503]])("maps database code %s to %s", async (code, expected) => {
    mocks.rpc.mockImplementation(async (name: string) => name === "is_workshare_staff" ? { data: true, error: null } : { data: null, error: { code, message: "Rejected" } });
    const response = await ticketsPOST(request("tickets", "POST", ticket));
    expect(response.status).toBe(expected);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
