import "../server/env-loader";
import { getRevenueEngineSnapshot, initializeRevenueEnginePersistence, prepareRevenueEngineState } from "../server/revenue-engine";
import {
  buildRevenueMoneyReadinessReport,
  formatRevenueMoneyReadinessText,
  hydrateRevenueMoneyReadinessSnapshot,
  parseRevenueMoneyReadinessArgs,
  validateRevenueMoneyReadinessOptions,
} from "../server/revenue-engine-money-readiness-cli";

async function main() {
  const options = parseRevenueMoneyReadinessArgs(process.argv.slice(2));
  const errors = validateRevenueMoneyReadinessOptions(options);
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  const snapshot = await hydrateRevenueMoneyReadinessSnapshot(options, {
    initializePersistence: initializeRevenueEnginePersistence,
    prepareState: prepareRevenueEngineState,
    getSnapshot: getRevenueEngineSnapshot,
  });
  const report = buildRevenueMoneyReadinessReport(snapshot, options);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatRevenueMoneyReadinessText(report));
  process.exitCode = report.ready ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
