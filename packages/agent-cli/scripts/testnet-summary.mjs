import { appendFileSync, readFileSync } from 'node:fs';
import {
  formatTestnetSummary,
  verifyTestnetReport,
} from './testnet-report.mjs';

let report;
let passed = false;
try {
  report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  verifyTestnetReport(report);
  passed = report.status === 'passed';
} catch {
  // Missing artifacts, malformed JSON and unverifiable metadata all fail closed.
  // Do not write a raw filesystem/validation error that may contain secrets.
  report = undefined;
}
const summary = formatTestnetSummary(report);
try {
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else process.stdout.write(summary);
} catch {
  process.stdout.write(summary);
  passed = false;
}
process.exitCode = passed ? 0 : 1;
