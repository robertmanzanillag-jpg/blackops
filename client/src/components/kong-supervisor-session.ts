export type SupervisorAuth = { authenticated?: boolean; user?: { id?: string } };
// The router's session and a fresh server verification must agree before any
// private cached state can render. A logout/refetch closes this gate at once.
export function kongSupervisorSessionScope(router: SupervisorAuth | undefined, verified: SupervisorAuth | undefined, routerFetching: boolean, verifying: boolean, verificationFailed = false, routerFailed = false): string | null {
  if (routerFetching || verifying || verificationFailed || routerFailed || !router?.authenticated || !verified?.authenticated) return null;
  const id = router.user?.id;
  return typeof id === "string" && id.length > 0 && id === verified.user?.id ? id : null;
}
