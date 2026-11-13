import "../server/env-loader";
import { testCeoMorningBrief } from "../server/reminder-scheduler";
import { parseSendCeoBriefArgs, validateSendCeoBriefOptions } from "../server/ceo-brief-cli";

async function main() {
  const options = parseSendCeoBriefArgs(process.argv.slice(2));
  const errors = validateSendCeoBriefOptions(options);

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    console.error("Usage: npm run ceo:send-brief -- --user-id=<real-user-id> --execute");
    process.exit(1);
  }

  const result = await testCeoMorningBrief(options.userId);
  if (!result.success) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(result.message);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
