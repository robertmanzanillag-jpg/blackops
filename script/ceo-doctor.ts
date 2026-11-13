import "../server/env-loader";
import { buildCeoDoctorChecks, buildCeoDoctorNextCommands, formatCeoDoctorJson, formatCeoDoctorReport, parseCeoDoctorArgs } from "../server/ceo-doctor-cli";

const options = parseCeoDoctorArgs(process.argv.slice(2));
const checks = buildCeoDoctorChecks(process.env, options);
const commands = buildCeoDoctorNextCommands(options);

console.log(options.json ? formatCeoDoctorJson(checks, commands) : formatCeoDoctorReport(checks, commands));
process.exit(checks.every((check) => check.ok) ? 0 : 1);
