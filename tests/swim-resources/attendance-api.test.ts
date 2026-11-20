import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  serverClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));
import { GET, POST } from "@/app/api/attendance/route";

const request = (body: unknown, origin = "https://example.test") =>
  new Request("https://example.test/api/attendance", {
    method: "POST",
    headers: { origin, host: "example.test" },
    body: JSON.stringify(body),
  });
const session = {
  id: "session-1",
  data: {
    id: "session-1",
    date: "2026-11-19",
    trainingGroup: "Prep",
    note: "Preserve this",
  },
};
const mark = {
  id: "mark-1",
  data: {
    id: "mark-1",
    sessionId: "session-1",
    athleteId: "athlete-1",
    status: "absent",
    note: "Preserve this too",
  },
};
const input = () => ({
  date: "2026-11-19",
  group: "Prep",
  session,
  changes: [
    { athleteId: "athlete-1", status: "present", before: mark },
    { athleteId: "athlete-2", status: "late", before: null },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: "owner",
        email: "christiancutter02@gmail.com",
        email_confirmed_at: "2026-01-01",
      },
    },
    error: null,
  });
  mocks.rpc.mockImplementation(async (name) =>
    name === "is_staff" ? { data: true, error: null } : { error: null },
  );
});

it("denies unauthenticated and nonstaff requests before attendance reads or writes", async () => {
  mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
  expect(
    (
      await GET(
        new Request("https://example.test/api/attendance?date=2026-11-19"),
      )
    ).status,
  ).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  expect((await POST(request(input()))).status).toBe(403);
  expect(mocks.rpc.mock.calls).toEqual([["is_staff"]]);
  expect(mocks.from).not.toHaveBeenCalled();
});

it.each([
  { email: "coach@velocity-swimming.com", email_confirmed_at: "2026-01-01" },
  { email: "christiancutter02@gmail.com", email_confirmed_at: null },
  {
    email: "christiancutter02@gmail.com",
    email_confirmed_at: "2026-01-01",
    is_anonymous: true,
  },
])("preserves the draft tool's verified owner boundary: %j", async (user) => {
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  expect((await POST(request(input()))).status).toBe(403);
  expect(
    (
      await GET(
        new Request("https://example.test/api/attendance?date=2026-11-19"),
      )
    ).status,
  ).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});

it("rejects cross-origin, invalid dates, duplicate athletes and invalid snapshots", async () => {
  expect((await POST(request(input(), "https://outside.test"))).status).toBe(
    403,
  );
  expect(mocks.getUser).not.toHaveBeenCalled();
  for (const body of [
    { ...input(), date: "2026-02-30" },
    { ...input(), session: { ...session, id: "athletes/private" } },
    { ...input(), changes: [input().changes[0], input().changes[0]] },
    {
      ...input(),
      changes: [
        {
          athleteId: "athlete-1",
          status: "present",
          before: { ...mark, data: { ...mark.data, sessionId: "other" } },
        },
      ],
    },
    {
      ...input(),
      changes: [{ athleteId: "athlete-1", status: "made-up", before: null }],
    },
    { ...input(), changes: [] },
  ])
    expect((await POST(request(body))).status).toBe(400);
  expect(mocks.rpc.mock.calls.every(([name]) => name === "is_staff")).toBe(
    true,
  );
});

it("commits all changed marks once using the reviewed snapshots without row reads", async () => {
  const response = await POST(request(input()));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.from).not.toHaveBeenCalled();
  expect(
    mocks.rpc.mock.calls.filter(([name]) => name === "commit_records"),
  ).toHaveLength(1);
  expect(mocks.rpc).toHaveBeenLastCalledWith("commit_records", {
    reads: [
      { path: "practice_sessions/session-1", before: session.data },
      { path: "attendance/mark-1", before: mark.data },
      { path: "attendance/session-1_athlete-2", before: null },
    ],
    writes: [
      {
        path: "attendance/mark-1",
        after: { ...mark.data, date: "2026-11-19", status: "present" },
      },
      {
        path: "attendance/session-1_athlete-2",
        after: {
          id: "session-1_athlete-2",
          date: "2026-11-19",
          sessionId: "session-1",
          athleteId: "athlete-2",
          status: "late",
        },
      },
    ],
  });
});

it("uses one stable practice identity and an existence check across competing creates", async () => {
  const body = {
    ...input(),
    session: null,
    changes: [{ athleteId: "athlete-1", status: "present", before: null }],
  };
  await POST(request(body));
  await POST(request(body));
  const calls = mocks.rpc.mock.calls.filter(
    ([name]) => name === "commit_records",
  );
  expect(calls[0][1]).toEqual(calls[1][1]);
  expect(calls[0][1].reads[0]).toEqual({
    path: expect.stringMatching(/^practice_sessions\/practice_[a-f0-9]{64}$/),
    before: null,
  });
  expect(calls[0][1].writes).toHaveLength(2);
});

it.each(["40001", "23505"])(
  "reports concurrent edits/creates as a reloadable conflict (%s)",
  async (code) => {
    mocks.rpc.mockImplementation(async (name) =>
      name === "is_staff"
        ? { data: true }
        : { error: { code, message: "Conflict" } },
    );
    const response = await POST(request(input()));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Reload the practice");
  },
);

it("reads the active relational roster and only the selected day's attendance", async () => {
  const filters: Array<[string, ...unknown[]]> = [];
  const pages = {
    athletes: [
      {
        id: "athlete-1",
        people: {
          name: "Fallback Name",
          data: { structuredName: { first: "Avery", last: "Swimmer" } },
        },
        training_groups: { name: "Prep" },
      },
    ],
    practice_sessions: [session],
    attendance: [mark],
  };
  mocks.from.mockImplementation((table: keyof typeof pages) => {
    const query = {
      then: (resolve: (value: unknown) => void) =>
        Promise.resolve({ data: pages[table], error: null }).then(resolve),
    } as Record<string, unknown>;
    for (const method of ["select", "eq", "order", "range", "in"])
      query[method] = (...args: unknown[]) => {
        filters.push([table, method, ...args]);
        return query;
      };
    return query;
  });
  const response = await GET(
    new Request("https://example.test/api/attendance?date=2026-11-19"),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    date: "2026-11-19",
    swimmers: [
      {
        id: "athlete-1",
        name: { first: "Avery", last: "Swimmer" },
        group: "Prep",
      },
    ],
    sessions: [session],
    marks: [mark],
  });
  expect(filters).toContainEqual(["athletes", "eq", "data->>status", "active"]);
  expect(filters).toContainEqual([
    "practice_sessions",
    "eq",
    "practice_date",
    "2026-11-19",
  ]);
  expect(filters).toContainEqual([
    "attendance",
    "in",
    "session_id",
    ["session-1"],
  ]);
  expect(mocks.rpc.mock.calls).toEqual([["is_staff"]]);
});
