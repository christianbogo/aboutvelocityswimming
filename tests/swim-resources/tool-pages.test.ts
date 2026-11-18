import { describe, expect, it, vi } from "vitest";
import { getAvailableTools } from "@/lib/tool-directory";
import { getToolPages } from "@/lib/tool-pages";

vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(href);
  },
}));
import LegacyTimesPage from "@/app/tools/(collection)/times/page";
import LegacyOverviewPage from "@/app/tools/(collection)/times/overview/page";

describe("independent times tools", () => {
  it("lists each tool directly and keeps staff tools restricted", () => {
    const tools = getAvailableTools(false);
    expect(tools.map(([id, tool]) => [id, tool.homeHref])).toEqual([
      ["my-times", "/tools/my-times"],
      ["rankings", "/tools/rankings"],
      ["records", "/tools/records"],
      ["standards", "/tools/standards"],
      ["workshare", "/tools/workshare/overview"],
    ]);
    for (const [id] of tools.slice(0, 4)) {
      expect(getToolPages(id, false)).toEqual([]);
    }
    expect(getAvailableTools(true).map(([id]) => id)).toContain("imports");
  });

  it("redirects the retired overview directly to Times", () => {
    expect(() => LegacyOverviewPage()).toThrow("/tools/my-times");
  });

  it("redirects old bookmarks without losing selections or repeated parameters", async () => {
    for (const [view, path] of [
      ["my-times", "/tools/my-times"],
      ["rankings", "/tools/rankings"],
      ["records", "/tools/records"],
      ["standards", "/tools/standards"],
      ["unknown", "/tools/rankings"],
      [undefined, "/tools/rankings"],
    ]) {
      const filters = '{"course":"LCM","ageGroups":["8&U"]}';
      const expected = new URLSearchParams({ filters, source: "shared" });
      expected.append("source", "saved");
      await expect(
        LegacyTimesPage({
          searchParams: Promise.resolve({
            view,
            filters,
            source: ["shared", "saved"],
          }),
        }),
      ).rejects.toThrow(`${path}?${expected}`);
    }
  });
});
