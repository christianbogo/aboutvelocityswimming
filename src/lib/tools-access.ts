// Temporary access restriction while the tools are being prepared for release.
export function isToolsAdmin(
  email: string | null | undefined,
  verified: boolean,
) {
  return (
    verified && email?.trim().toLowerCase() === "christiancutter02@gmail.com"
  );
}

export function isToolsPage(pathname: string) {
  return pathname === "/tools" || pathname.startsWith("/tools/");
}

export function isToolsApi(pathname: string) {
  return [
    "/api/data",
    "/api/workshare",
    "/api/times",
    "/api/collection",
    "/api/swim-resources",
  ].some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

export interface ToolsIdentity {
  email?: string | null;
  emailVerified: boolean;
  staff: boolean;
  workshareStaff?: boolean;
}

export interface ToolsCapabilities {
  allTools: boolean;
  staff: boolean;
}

export function getToolsCapabilities(
  user: ToolsIdentity | null | undefined,
): ToolsCapabilities {
  return {
    allTools: isToolsAdmin(user?.email, user?.emailVerified === true),
    staff:
      user?.emailVerified === true &&
      (user.staff === true || user.workshareStaff === true),
  };
}

function within(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Staff access is deliberately limited while the other tools remain locked. */
export function isStaffToolsPath(pathname: string) {
  return (
    pathname === "/tools" ||
    pathname === "/tools/" ||
    within(pathname, "/tools/admin") ||
    [
      "/api/workshare/accounts",
      "/api/workshare/seasons",
      "/api/workshare/tickets",
    ].some((prefix) => within(pathname, prefix))
  );
}

export function canAccessToolsPath(
  pathname: string,
  user: ToolsIdentity | null | undefined,
) {
  if (!isToolsPage(pathname) && !isToolsApi(pathname)) return false;
  const access = getToolsCapabilities(user);
  return access.allTools || (access.staff && isStaffToolsPath(pathname));
}

export function getToolsHome(user: ToolsIdentity | null | undefined) {
  const access = getToolsCapabilities(user);
  return access.allTools ? "/tools" : access.staff ? "/tools/admin" : "/login";
}

/** `next` has already been validated as a safe, same-site path by the callback. */
export function getToolsSignInDestination(
  user: ToolsIdentity | null | undefined,
  next = "/tools",
  linking = false,
) {
  const pathname = next.split(/[?#]/, 1)[0];
  if (!isToolsPage(pathname)) return next;
  const home = getToolsHome(user);
  if (home === "/login") return home;
  if (
    !linking &&
    (pathname === "/tools" || pathname === "/tools/") &&
    home === "/tools/admin"
  )
    return home;
  return canAccessToolsPath(pathname, user) ? next : home;
}
