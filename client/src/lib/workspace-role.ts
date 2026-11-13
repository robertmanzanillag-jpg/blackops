import { useQuery } from "@tanstack/react-query";
import { isBlackRoomScopeAgent, type WorkspaceRole } from "@shared/workspace-access";

export type WorkspaceMe = { role: WorkspaceRole | null; revoked?: boolean; canManagePartners: boolean; blackRoomScope: string[] | null };

export const WORKSPACE_ME_KEY = ["workspace-me"] as const;

/** Role of the signed-in user. While loading (or on error) the UI treats the user as non-owner. */
export function useWorkspaceRole(enabled = true) {
  const query = useQuery<WorkspaceMe>({
    queryKey: WORKSPACE_ME_KEY,
    queryFn: async () => {
      const response = await fetch("/api/workspace/me", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`${response.status}`);
      return response.json();
    },
    enabled,
    staleTime: 60_000,
    retry: false,
  });
  const role = query.data?.role ?? null;
  return {
    role,
    isOwner: role === "owner",
    isPartner: role === "partner",
    loading: query.isLoading,
    /** A partner whose access Robert revoked: every API call is refused. */
    revoked: query.data?.revoked === true,
    /** Partners only chat with / order Black Room members; everyone else is unrestricted by this helper. */
    canInteractWith: (agentId: string) => role !== "partner" || isBlackRoomScopeAgent(agentId),
  };
}
