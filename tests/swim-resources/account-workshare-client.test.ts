import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadAccountWorkshare,
  workshareHours,
} from "@/lib/account-workshare";

afterEach(() => vi.unstubAllGlobals());

describe("own-account Workshare client", () => {
  it("loads only the current identity summary without caching and forwards cancellation", async () => {
    const summary = { seasons: [], seasonId: null, accounts: [] };
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: summary }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await loadAccountWorkshare(undefined, signal)).toEqual(summary);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/account/workshare", {
      cache: "no-store",
      signal,
    });
  });

  it("targets an explicitly selected historical season", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({ data: { seasons: [], seasonId: "season", accounts: [] } }),
    );
    vi.stubGlobal("fetch", fetch);
    await loadAccountWorkshare("season");
    expect(fetch).toHaveBeenCalledWith("/api/account/workshare?seasonId=season", {
      cache: "no-store",
      signal: undefined,
    });
  });

  it("rejects denied or failed reads instead of returning a successful empty account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: "Verify your email." }, { status: 403 }),
      ),
    );
    await expect(loadAccountWorkshare()).rejects.toThrow("Verify your email.");
  });

  it("distinguishes unset requirements from zero and retains fractional hours", () => {
    expect(workshareHours(0, null)).toBe("0/-");
    expect(workshareHours(0, 0)).toBe("0/0");
    expect(workshareHours(4.25, 16.5)).toBe("4.25/16.5");
  });
});
