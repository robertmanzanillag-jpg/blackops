import "../server/env-loader";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  getCeoConversationTitle,
  getLegacyTelegramConversationTitle,
} from "../server/ceo-conversation-title";
import {
  getUniqueUserMigrationTargets,
  USER_MIGRATION_TARGETS,
  validateUserMigrationRequest,
} from "../server/user-migration-plan";

type CliOptions = {
  fromUserId: string;
  toUserId: string;
  execute: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    fromUserId: getValue("--from"),
    toUserId: getValue("--to"),
    execute: argv.includes("--execute"),
  };
}

async function countRows(tableName: string, columnName: string, userId: string): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as count from ${tableName} where ${columnName} = '${userId.replace(/'/g, "''")}'`));
  const row = result.rows?.[0] as { count?: number } | undefined;
  return Number(row?.count || 0);
}

async function updateRows(tableName: string, columnName: string, fromUserId: string, toUserId: string): Promise<void> {
  await db.execute(sql.raw(`update ${tableName} set ${columnName} = '${toUserId.replace(/'/g, "''")}' where ${columnName} = '${fromUserId.replace(/'/g, "''")}'`));
}

async function migrateConversationTitle(fromTitle: string, toTitle: string, execute: boolean): Promise<void> {
  const fromCount = await countRows("conversations", "title", fromTitle);
  const toCount = await countRows("conversations", "title", toTitle);

  console.log(`conversations.title: ${fromCount} source conversation(s), ${toCount} target conversation(s)`);
  if (fromCount > 0 && toCount > 0) {
    throw new Error(`Cannot migrate conversation title because target title already exists: ${toTitle}`);
  }
  if (execute && fromCount > 0) {
    await updateRows("conversations", "title", fromTitle, toTitle);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const errors = validateUserMigrationRequest({
    fromUserId: options.fromUserId,
    toUserId: options.toUserId,
  });

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    console.error("Usage: npm run user:migrate -- --from=mock-user-123 --to=<real-user-id> [--execute]");
    process.exit(1);
  }

  console.log(options.execute ? "EXECUTE user migration" : "DRY RUN user migration");
  console.log(`from: ${options.fromUserId}`);
  console.log(`to:   ${options.toUserId}`);
  console.log("");

  for (const target of getUniqueUserMigrationTargets()) {
    const fromCount = await countRows(target.tableName, target.columnName, options.fromUserId);
    const toCount = await countRows(target.tableName, target.columnName, options.toUserId);
    if (fromCount > 0 && toCount > 0) {
      throw new Error(`Cannot migrate ${target.tableName}: source and target both have ${target.columnName} rows`);
    }
  }

  for (const target of USER_MIGRATION_TARGETS) {
    const count = await countRows(target.tableName, target.columnName, options.fromUserId);
    console.log(`${target.tableName}.${target.columnName}: ${count} row(s)`);
    if (options.execute && count > 0) {
      await updateRows(target.tableName, target.columnName, options.fromUserId, options.toUserId);
    }
  }

  await migrateConversationTitle(
    getCeoConversationTitle(options.fromUserId),
    getCeoConversationTitle(options.toUserId),
    options.execute,
  );
  await migrateConversationTitle(
    getLegacyTelegramConversationTitle(options.fromUserId),
    getLegacyTelegramConversationTitle(options.toUserId),
    options.execute,
  );

  console.log("");
  console.log(options.execute ? "Migration complete." : "Dry run complete. Re-run with --execute to apply.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
