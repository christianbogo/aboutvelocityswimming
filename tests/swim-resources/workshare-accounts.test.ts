import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  serverClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

import { GET, POST, PUT } from "@/app/api/workshare/accounts/route";
import { AccountValidationError, parseAccount } from "@/features/workshare/lib/accounts-validation";

const version = "2026-11-18T18:00:00.123456+00:00";
const athlete = {
  fullName: "Example Swimmer", trainingGroup: "Prep", timesAthleteId: null, isArchived: false,
};
function account(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Example Account", emails: ["parent@example.com"], athletes: [{ ...athlete }],
    currentSeason: "2026–2027", generalHoursRequired: null, starlightHoursRequired: null,
    appleCapitalHoursRequired: null, isArchived: false, ...overrides,
  };
}
function request(method: "POST" | "PUT", value: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request("https://velocity.example/api/workshare/accounts", {
    method, headers: { host: "velocity.example", origin: "https://velocity.example", ...extraHeaders },
    body: JSON.stringify(value),
  });
}
const getRequest = () => new Request("https://velocity.example/api/workshare/accounts");

describe("Workshare account writes", () => {
  it("normalizes contact data while keeping unknown hours distinct from zero", () => {
    const parsed = parseAccount(account({
      fullName: "  Example Account  ", emails: [" PARENT@Example.com ", "parent@example.com", "athlete@example.com"],
      currentSeason: " ", generalHoursRequired: 0, starlightHoursRequired: 4.1, appleCapitalHoursRequired: 10000,
      athletes: [{ ...athlete, fullName: "  Example Swimmer ", trainingGroup: " Prep " }],
    }));
    expect(parsed).toMatchObject({
      fullName: "Example Account", emails: ["parent@example.com", "athlete@example.com"], currentSeason: null,
      generalHoursRequired: 0, starlightHoursRequired: 4.1, appleCapitalHoursRequired: 10000,
      athletes: [{ ...athlete }],
    });
    expect(parseAccount(account()).generalHoursRequired).toBeNull();
  });

  it("preserves exact update versions and explicit Times IDs without matching by name", () => {
    const parsed = parseAccount(account({ id: " account-id ", updatedAt: ` ${version} `,
      athletes: [{ ...athlete, id: " member-id ", timesAthleteId: " times:independent-id " }],
    }), "update");
    expect(parsed).toMatchObject({ id: "account-id", updatedAt: version,
      athletes: [{ id: "member-id", timesAthleteId: "times:independent-id" }],
    });
    expect(parseAccount(account({ athletes: [athlete, athlete] })).athletes).toHaveLength(2);
  });

  it("allows empty accounts and independent account and athlete archive flags", () => {
    expect(parseAccount(account({ emails: [], athletes: [] }))).toMatchObject({ emails: [], athletes: [] });
    expect(parseAccount(account({ isArchived: true, athletes: [{ ...athlete, isArchived: false }] })))
      .toMatchObject({ isArchived: true, athletes: [{ isArchived: false }] });
  });

  it.each([undefined, "0", -0.1, 10000.01, 1.001, Number.NaN, Infinity])(
    "rejects invalid required hour input %s", (value) => {
      expect(() => parseAccount(account({ generalHoursRequired: value }))).toThrow(AccountValidationError);
    },
  );

  it.each([
    { fullName: " " }, { fullName: "a".repeat(201) }, { emails: ["invalid"] }, { emails: [""] },
    { emails: ["a".repeat(250) + "@example.com"] }, { emails: Array(101).fill("a@example.com") },
    { athletes: Array(101).fill(athlete) }, { currentSeason: "a".repeat(101) }, { isArchived: "false" },
    { authorizedEmails: [] }, { completeHourTickets: [] }, { currentSeason: undefined },
  ])("rejects incomplete, oversized, or unsupported account fields: %j", (overrides) => {
    expect(() => parseAccount(account(overrides))).toThrow(AccountValidationError);
  });

  it.each([
    { fullName: " " }, { fullName: "a".repeat(201) }, { trainingGroup: "a".repeat(101) },
    { timesAthleteId: " " }, { timesAthleteId: "a".repeat(1501) }, { timesAthleteId: undefined },
    { isArchived: 0 }, { unknown: "value" },
  ])("rejects invalid athlete fields: %j", (overrides) => {
    expect(() => parseAccount(account({ athletes: [{ ...athlete, ...overrides }] })))
      .toThrow(AccountValidationError);
  });

  it("requires an account ID and version for updates and prevents create ID injection", () => {
    expect(() => parseAccount(account(), "update")).toThrow("Account ID");
    expect(() => parseAccount(account({ id: "account-id" }), "update")).toThrow("Account version");
    expect(() => parseAccount(account({ id: "account-id", updatedAt: "yesterday" }), "update")).toThrow("timestamp");
    expect(() => parseAccount(account({ id: "account-id", updatedAt: version }))).toThrow("New accounts");
    expect(() => parseAccount(account({ athletes: [{ ...athlete, id: "existing-id" }] }))).toThrow("New athletes");
    expect(() => parseAccount(account({ id: "a".repeat(1501), updatedAt: version }), "update")).toThrow("1500");
  });

  it("rejects duplicate member IDs while accepting the longest allowed explicit Times ID", () => {
    expect(() => parseAccount(account({ id: "account-id", updatedAt: version,
      athletes: [{ ...athlete, id: "same-id" }, { ...athlete, id: " same-id " }],
    }), "update")).toThrow("more than once");
    expect(parseAccount(account({ athletes: [{ ...athlete, timesAthleteId: "a".repeat(1500) }] }))
      .athletes[0].timesAthleteId).toHaveLength(1500);
  });
});

describe("staff account API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "staff-user", email_confirmed_at: "2026-11-18T00:00:00Z" } }, error: null });
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "is_workshare_staff" ? true : name === "list_workshare_accounts" ? [] : { id: "saved-id" }, error: null,
    }));
  });

  it.each([
    { id: "unverified-domain", email: "coach@velocity-swimming.com", email_confirmed_at: null },
    { id: "anonymous-domain", email: "coach@velocity-swimming.com", email_confirmed_at: "2026-11-18T00:00:00Z", is_anonymous: true },
  ])("rejects unverified and anonymous identities before checking staff", async (user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    expect((await GET(getRequest())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects signed-out reads before any RPC", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(getRequest())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([() => GET(getRequest()), () => POST(request("POST", account())), () => PUT(request("PUT", account()))])(
    "prevents nonstaff account access", async (handler) => {
      mocks.rpc.mockResolvedValue({ data: false, error: null });
      expect((await handler()).status).toBe(403);
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("is_workshare_staff");
    },
  );

  it("returns a private, uncached account list for staff", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ data: [] });
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_workshare_accounts");
  });

  it("denies cross-origin mutations before authentication or writes", async () => {
    const response = await POST(request("POST", account(), { origin: "https://attacker.example" }));
    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("creates a normalized account through the protected RPC", async () => {
    const response = await POST(request("POST", account({ emails: [" PARENT@EXAMPLE.COM "] })));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: "saved-id" } });
    expect(mocks.rpc).toHaveBeenLastCalledWith("save_workshare_account", {
      input: account({ emails: ["parent@example.com"] }),
    });
  });

  it("rejects malformed or invalid bodies before the save RPC", async () => {
    const malformed = new Request("https://velocity.example/api/workshare/accounts", {
      method: "POST", headers: { host: "velocity.example", origin: "https://velocity.example" }, body: "{",
    });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request("POST", account({ extra: true })))).status).toBe(400);
    expect((await PUT(request("PUT", account({ id: "saved-id" })))).status).toBe(400);
    expect(mocks.rpc.mock.calls.every(([name]) => name === "is_workshare_staff")).toBe(true);
  });

  it("bounds declared and actual UTF-8 request size", async () => {
    expect((await POST(request("POST", account(), { "content-length": String(1024 * 1024 + 1) }))).status).toBe(413);
    expect((await POST(request("POST", account({ fullName: "é".repeat(600000) })))).status).toBe(413);
    expect(mocks.rpc.mock.calls.every(([name]) => name === "is_workshare_staff")).toBe(true);
  });

  it.each([["40001", 409], ["42501", 403], ["22023", 400], ["23503", 400], ["XX000", 503]])(
    "maps database error %s to %s without claiming a save", async (code, status) => {
      mocks.rpc.mockImplementation(async (name: string) => name === "is_workshare_staff"
        ? { data: true, error: null } : { data: null, error: { code, message: "Rejected" } });
      const response = await PUT(request("PUT", account({ id: "saved-id", updatedAt: version })));
      expect(response.status).toBe(status);
      expect(await response.json()).toHaveProperty("error");
    },
  );
});
