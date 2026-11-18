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
import WorkshareEntry from "@/app/tools/(workshare)/workshare/page";
import WorkshareOverview from "@/app/tools/(workshare)/workshare/overview/page";
import RetiredJobs from "@/app/tools/(workshare)/workshare/jobs/page";
import RetiredSettings from "@/app/tools/(workshare)/workshare/admin/settings/page";
import RetiredRoster from "@/app/tools/(workshare)/workshare/admin/roster/page";
import RetiredFamilyDetail from "@/app/tools/(workshare)/workshare/admin/families/[familyId]/page";
import RetiredFamilies from "@/app/tools/(workshare)/workshare/admin/families/page";
import RetiredLogs from "@/app/tools/(workshare)/workshare/logs/page";
import RetiredGuest from "@/app/tools/(workshare)/workshare/guest/page";

describe("independent times tools", () => {
  it("restricts approved staff to Admin while other tools stay locked", () => {
    expect(getAvailableTools({ allTools: false, staff: true }).map(([id]) => id)).toEqual(["admin"]);
    expect(getAvailableTools({ allTools: false, staff: false })).toEqual([]);
  });
  it("lists each tool directly and keeps staff tools restricted", () => {
    const tools = getAvailableTools({ allTools: true, staff: false });
    expect(tools.map(([id, tool]) => [id, tool.homeHref])).toEqual([
      ["my-times", "/tools/my-times"],
      ["goals", "/tools/goals"],
      ["rankings", "/tools/rankings"],
      ["records", "/tools/records"],
      ["standards", "/tools/standards"],
    ]);
    for (const [id] of tools) {
      expect(getToolPages(id)).toEqual([]);
    }
    expect(getAvailableTools({ allTools: true, staff: true }).map(([id]) => id)).toContain("imports");
    expect(getAvailableTools({ allTools: true, staff: true }).map(([id, { title, homeHref }]) => ({ id, title, homeHref })))
      .toContainEqual({ id: "admin", title: "Admin", homeHref: "/tools/admin" });
  });

  it("keeps Admin standalone and redirects retired Workshare bookmarks", () => {
    expect(getToolPages("admin")).toEqual([]);
    expect(getAvailableTools({ allTools: true, staff: false }).map(([id]) => id)).not.toContain("admin");
    expect(getAvailableTools({ allTools: true, staff: true }).map(([id]) => id)).not.toContain("workshare");
    for (const Page of [WorkshareEntry, WorkshareOverview, RetiredJobs, RetiredSettings, RetiredRoster, RetiredFamilyDetail, RetiredFamilies, RetiredLogs, RetiredGuest]) {
      expect(() => Page()).toThrow("/tools/admin");
    }
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
