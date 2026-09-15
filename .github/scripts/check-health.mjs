// Reads the /api/health body the image answered in CI, and fails the job
// unless it describes a container that is fit to release.
//
// Usage: node .github/scripts/check-health.mjs <health.json> <expected full commit>
//
// Health output is secret-free by design. This still prints only the fields it
// checks, so the job log carries nothing it does not need.
import { readFileSync } from "node:fs";

const [file, expectedCommit] = process.argv.slice(2);
const health = JSON.parse(readFileSync(file, "utf8"));

const checks = [
  ["reports the commit it was built from", Boolean(expectedCommit) && health.commitSha === expectedCommit],
  ["database answered", health.database?.ok === true],
  [
    "every migration is applied",
    health.schema?.ok === true && health.schema.applied === health.schema.expected,
  ],
  ["sharp loads and renders", health.sharp?.ok === true],
  // CI has no R2. A production process must refuse local disk rather than
  // report it healthy.
  [
    "image storage refuses local disk",
    health.imageStorage?.ok === false && health.imageStorage?.backend === "none",
  ],
];

for (const [name, passed] of checks) console.log(`${passed ? "pass" : "FAIL"}  ${name}`);
console.log(
  JSON.stringify(
    {
      commitSha: health.commitSha,
      database: health.database,
      schema: health.schema,
      sharp: health.sharp,
      imageStorage: health.imageStorage,
    },
    null,
    2,
  ),
);

if (checks.some(([, passed]) => !passed)) process.exit(1);
