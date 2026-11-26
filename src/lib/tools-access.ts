// Draft tools are restricted to their owner; released tools accept verified accounts.
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
    "/api/attendance",
    "/api/workshare",
    "/api/times",
  ].some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

export interface ToolsIdentity {
  email?: string | null;
  emailVerified: boolean;
  staff: boolean;
  workshareStaff?: boolean;
}

export interface ToolsCapabilities {
  signedIn?: boolean;
  allTools: boolean;
  staff: boolean;
}

export function getToolsCapabilities(
  user: ToolsIdentity | null | undefined,
): ToolsCapabilities {
  return {
    signedIn: Boolean(user?.email?.trim()) && user?.emailVerified === true,
    allTools: isToolsAdmin(user?.email, user?.emailVerified === true),
    staff:
      user?.emailVerified === true &&
      (user.staff === true || user.workshareStaff === true),
  };
}

function within(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Admin endpoints use database-confirmed staff authority. */
export function isStaffToolsPath(pathname: string) {
  return (
    within(pathname, "/tools/admin") ||
    [
      "/api/workshare/accounts",
      "/api/workshare/athletes",
      "/api/workshare/seasons",
      "/api/workshare/tickets",
    ].some((prefix) => within(pathname, prefix))
  );
}

/** Released read-only tools, plus Account. Unknown routes stay restricted. */
export function isSignedInToolsPath(pathname: string) {
  return (
    ["/tools", "/tools/", "/api/times"].includes(pathname) ||
    [
      "/tools/my-times",
      "/tools/times",
      "/tools/rankings",
      "/tools/records",
      "/tools/standards",
    ].some((prefix) => within(pathname, prefix))
  );
}

export function canAccessToolsPath(
  pathname: string,
  user: ToolsIdentity | null | undefined,
) {
  if (!isToolsPage(pathname) && !isToolsApi(pathname)) return false;
  const access = getToolsCapabilities(user);
  return (
    access.allTools ||
    (access.signedIn && isSignedInToolsPath(pathname)) ||
    (access.staff && isStaffToolsPath(pathname))
  );
}

export function getToolsHome(user: ToolsIdentity | null | undefined) {
  return getToolsCapabilities(user).signedIn ? "/tools" : "/login";
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
  if (linking && pathname === "/tools") return next;
  return canAccessToolsPath(pathname, user) ? next : home;
}
