import { DEFAULT_DEV_USER_ID } from "./user-context";
import { hasRealValue } from "./ceo-doctor-cli";

export type UserMigrationColumn = "user_id" | "owner_user_id";

export interface UserMigrationTarget {
  tableName: string;
  columnName: UserMigrationColumn;
  uniquePerUser?: boolean;
}

export interface UserMigrationRequest {
  fromUserId: string;
  toUserId: string;
}

export const USER_MIGRATION_TARGETS: UserMigrationTarget[] = [
  { tableName: "tasks", columnName: "user_id" },
  { tableName: "weekly_summaries", columnName: "user_id" },
  { tableName: "monthly_goals", columnName: "user_id" },
  { tableName: "yearly_goals", columnName: "user_id" },
  { tableName: "weekly_tasks", columnName: "user_id" },
  { tableName: "push_subscriptions", columnName: "user_id" },
  { tableName: "telegram_config", columnName: "user_id", uniquePerUser: true },
  { tableName: "investments", columnName: "user_id" },
  { tableName: "portfolio_config", columnName: "user_id", uniquePerUser: true },
  { tableName: "transactions", columnName: "user_id" },
  { tableName: "watchlist", columnName: "user_id" },
  { tableName: "price_alerts", columnName: "user_id" },
  { tableName: "portfolio_history", columnName: "user_id" },
  { tableName: "user_profile_data", columnName: "user_id" },
  { tableName: "monitored_projects", columnName: "user_id" },
  { tableName: "app_projects", columnName: "user_id" },
  { tableName: "github_connections", columnName: "user_id", uniquePerUser: true },
  { tableName: "dj_contacts", columnName: "user_id" },
  { tableName: "agent_actions", columnName: "user_id" },
  { tableName: "audit_logs", columnName: "user_id" },
  { tableName: "pending_actions", columnName: "user_id" },
  { tableName: "pending_action_events", columnName: "user_id" },
  { tableName: "assistant_permissions", columnName: "user_id" },
  { tableName: "automation_definitions", columnName: "owner_user_id" },
  { tableName: "automation_runs", columnName: "owner_user_id" },
  { tableName: "dj_message_templates", columnName: "user_id" },
  { tableName: "scheduled_reminders", columnName: "user_id" },
];

export function validateUserMigrationRequest(request: UserMigrationRequest): string[] {
  const errors: string[] = [];
  const fromUserId = request.fromUserId.trim();
  const toUserId = request.toUserId.trim();

  if (!fromUserId) {
    errors.push("fromUserId is required");
  } else if (!hasRealValue(fromUserId)) {
    errors.push("fromUserId must be a real value, not a placeholder");
  }
  if (!toUserId) {
    errors.push("toUserId is required");
  } else if (!hasRealValue(toUserId)) {
    errors.push("toUserId must be a real value, not a placeholder");
  }
  if (fromUserId && toUserId && fromUserId === toUserId) {
    errors.push("fromUserId and toUserId must be different");
  }
  if (toUserId === DEFAULT_DEV_USER_ID) {
    errors.push(`${DEFAULT_DEV_USER_ID} cannot be the migration target`);
  }

  return errors;
}

export function getUniqueUserMigrationTargets(): UserMigrationTarget[] {
  return USER_MIGRATION_TARGETS.filter((target) => target.uniquePerUser);
}
