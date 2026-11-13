import { storage } from "./storage";
import type {
  AuditLog,
  InsertAuditLog,
  InsertPendingAction,
  PendingAction,
  PermissionLevel,
  RiskLevel,
  TrustActorType,
  TrustExecutionMode,
  TrustOrigin,
} from "@shared/schema";

export type TrustScope = "calendar" | "finance" | "code" | "github" | "communications" | "projects" | "tasks" | "memory" | "ecommerce" | "system";

export interface TrustActionRequest {
  userId: string;
  actorType: TrustActorType;
  actorId?: string;
  origin: TrustOrigin;
  executionMode: TrustExecutionMode;
  actionType: string;
  resourceType: string;
  resourceId?: string;
  title: string;
  description: string;
  input?: unknown;
  proposedChanges?: unknown;
  metadata?: unknown;
  scope?: TrustScope;
}

const DEFAULT_SCOPE_PERMISSIONS: Record<TrustScope, PermissionLevel> = {
  calendar: "execute_after_approval",
  finance: "execute_after_approval",
  code: "execute_after_approval",
  github: "execute_after_approval",
  communications: "draft_only",
  projects: "execute_after_approval",
  tasks: "autonomous",
  memory: "autonomous",
  ecommerce: "execute_after_approval",
  system: "execute_after_approval",
};

const ACTION_RISK: Record<string, RiskLevel> = {
  "calendar.create_event": "medium",
  "calendar.modify_radio": "high",
  "finance.create_investment": "high",
  "finance.update_investment": "high",
  "finance.delete_investment": "critical",
  "code.write_file": "critical",
  "code.apply_generated": "critical",
  "code.execute_query": "critical",
  "code.create_table": "critical",
  "code.add_column": "critical",
  "github.update_file": "critical",
  "github.delete_file": "critical",
  "communications.send": "critical",
  "dropshipping.spend": "critical",
  "dropshipping.publish_product": "critical",
  "dropshipping.create_shopify_draft": "critical",
  "dropshipping.publish_social": "critical",
  "dropshipping.contact_supplier": "critical",
  "dropshipping.fulfill_order": "critical",
  "dropshipping.order_sample": "high",
  "marketing.publish": "critical",
  "marketing.blackroom_link_add": "high",
  "marketing.blackroom_link_update": "high",
  "marketing.blackroom_link_deactivate": "high",
  "marketing.blackroom_timer_add": "high",
  "marketing.metricool_automation": "critical",
  "radio_edit.resolve_dj_name": "low",
  "radio_edit.youtube_to_drive": "medium",
  "google_drive.create_folder": "low",
};

export function getActionScope(actionType: string): TrustScope {
  if (actionType.startsWith("calendar.")) return "calendar";
  if (actionType.startsWith("finance.")) return "finance";
  if (actionType.startsWith("code.")) return "code";
  if (actionType.startsWith("github.")) return "github";
  if (actionType.startsWith("communications.") || actionType.startsWith("marketing.")) return "communications";
  if (actionType.startsWith("dropshipping.")) return "ecommerce";
  if (actionType.startsWith("project.")) return "projects";
  if (actionType.startsWith("task.") || actionType.startsWith("reminder.")) return "tasks";
  if (actionType.startsWith("memory.")) return "memory";
  return "system";
}

export function getActionRisk(actionType: string): RiskLevel {
  return ACTION_RISK[actionType] || "medium";
}

export async function getEffectivePermission(userId: string, scope: TrustScope): Promise<PermissionLevel> {
  const permissions = await storage.getAssistantPermissions(userId);
  const specific = permissions.find((permission) => permission.scope === scope && permission.enabled);
  const global = permissions.find((permission) => permission.scope === "global" && permission.enabled);
  return specific?.permissionLevel || global?.permissionLevel || DEFAULT_SCOPE_PERMISSIONS[scope];
}

export async function writeAuditLog(log: InsertAuditLog): Promise<AuditLog> {
  return storage.createAuditLog(log);
}

export async function createPendingActionForApproval(request: TrustActionRequest): Promise<PendingAction> {
  const scope = request.scope || getActionScope(request.actionType);
  const riskLevel = getActionRisk(request.actionType);
  const permissionLevelRequired = await getEffectivePermission(request.userId, scope);

  const pendingAction = await storage.createPendingAction(request.userId, {
    userId: request.userId,
    createdByActorType: request.actorType,
    createdByActorId: request.actorId,
    origin: request.origin,
    actionType: request.actionType,
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    title: request.title,
    description: request.description,
    riskLevel,
    permissionLevelRequired,
    input: request.input as InsertPendingAction["input"],
    proposedChanges: request.proposedChanges as InsertPendingAction["proposedChanges"],
  });

  await writeAuditLog({
    userId: request.userId,
    actorType: request.actorType,
    actorId: request.actorId,
    origin: request.origin,
    actionType: request.actionType,
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    pendingActionId: pendingAction.id,
    metadata: (request.metadata || { scope, riskLevel }) as InsertAuditLog["metadata"],
    status: "pending_approval",
    executionMode: request.executionMode,
  });

  return pendingAction;
}
