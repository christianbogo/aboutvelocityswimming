import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  invalidateTimes: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  serverClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/lib/times/server", () => ({
  invalidateTimes: mocks.invalidateTimes,
}));
import { GET, POST } from "@/app/api/times/manage/route";
import { POST as importFile } from "@/app/api/times/import/route";
import { parseMeetFiles } from "@/lib/results/parse-file";
import { individual } from "../fixtures/results/files";
const request = (body: unknown, origin = "https://example.test") =>
  new Request("https://example.test/api/times/manage", {
    method: "POST",
    headers: {
      origin,
      host: "example.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        email: "christiancutter02@gmail.com",
        email_confirmed_at: "2026-01-01",
      },
    },
    error: null,
  });
});
it.each([
  null,
  { email: "coach@velocity-swimming.com", email_confirmed_at: "2026-01-01" },
  { email: "christiancutter02@gmail.com", email_confirmed_at: null },
])("denies missing or non-owner identity", async (user) => {
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  expect([401, 403]).toContain(
    (await GET(new Request("https://example.test/api/times/manage?kind=swim")))
      .status,
  );
  expect([401, 403]).toContain(
    (await importFile(request({ rows: [] }))).status,
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("checks same-origin and validates manual records before the database", async () => {
  expect((await POST(request({}, "https://outside.test"))).status).toBe(403);
  expect(
    (await POST(request({ kind: "athlete", data: { id: "new" } }))).status,
  ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("returns stale conflicts and invalidates caches only after a committed save", async () => {
  const body = {
    kind: "athlete",
    version: "old",
    data: {
      id: "test",
      name: { first: "Synthetic", last: "Swimmer" },
      gender: "F",
      status: "inactive",
    },
  };
  mocks.rpc.mockResolvedValueOnce({
    error: { code: "40001", message: "This record changed." },
  });
  expect((await POST(request(body))).status).toBe(409);
  expect(mocks.invalidateTimes).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({
    data: { id: "test", data: body.data, version: "new" },
    error: null,
  });
  const saved = await POST(request(body));
  expect(saved.status).toBe(200);
  expect(saved.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.invalidateTimes).toHaveBeenCalledOnce();
});
it("revalidates worker output and reports partial success without forwarding invalid candidates", async () => {
  const { rows } = await parseMeetFiles([individual()]);
  mocks.rpc.mockResolvedValue({
    data: {
      saved: 1,
      outcomes: [
        {
          status: "saved",
          filename: "synthetic.sd3",
          line: 4,
          message: "Saved.",
        },
      ],
    },
    error: null,
  });
  const result = await importFile(
    request({
      rows: [rows[0], { ...rows[0], timeMs: -1 }],
      includeHistoricalCuda: true,
    }),
  );
  expect(result.status).toBe(200);
  expect((await result.json()).outcomes).toHaveLength(2);
  expect(mocks.rpc.mock.calls[0][1].input.rows).toHaveLength(1);
  expect(mocks.rpc.mock.calls[0][1].input.includeHistoricalCuda).toBe(true);
  expect(mocks.invalidateTimes).toHaveBeenCalledOnce();
});
it("bounds request batches", async () => {
  expect(
    (
      await importFile(
        request({ rows: Array.from({ length: 101 }, () => ({})) }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
