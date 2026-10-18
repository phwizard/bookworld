// Prints the usage report from the local event log. `pnpm metrics [--since YYYY-MM-DD] [--json] [file]`
import { metricsFile, readEvents } from './metrics.ts';
import { buildReport, formatReport } from './metrics-report.ts';

const args = process.argv.slice(2);
let since: string | undefined;
let json = false;
let file: string | null = metricsFile;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--since') since = args[++i];
  else if (a === '--json') json = true;
  else file = a;
}
const report = buildReport(readEvents(file), { since });
console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
