import { readFileSync } from "node:fs";

console.log(readFileSync("CEO_ASSISTANT_HANDOFF.md", "utf8").trimEnd());
