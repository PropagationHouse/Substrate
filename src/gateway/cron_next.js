// Croner helper: computes next run time for cron expressions.
// Called from Python via subprocess.
// Usage:  node cron_next.js "0 8 * * *"
// Output: ISO 8601 timestamp per line, or "INVALID" on bad expr
const { Cron } = require("croner");

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write("Usage: node cron_next.js <expr> [expr2 ...]\n");
  process.exit(1);
}

for (const expr of args) {
  try {
    const job = new Cron(expr);
    const next = job.nextRun();
    if (next) {
      process.stdout.write(next.toISOString() + "\n");
    } else {
      process.stdout.write("NONE\n");
    }
  } catch (e) {
    process.stdout.write("INVALID\n");
  }
}
