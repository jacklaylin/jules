// Reports any db/ migration the code needs that the database is missing, by filename. Read-only: it
// asks PostgREST for zero rows of each table and for its function listing.
// Run before deploying a PR that adds a migration, and right after any deploy:
//   node --env-file=.env.local scripts/schema-check.js
// Exits 0 when the schema is complete, 1 when a migration is missing, 2 when the check could not run.
import { checkSchema, schemaReport, formatSchemaReport } from '../lib/schema-check.js';

let results;
try { results = await checkSchema(process.env); }
catch (error) { console.error(`${error.message}. Run with --env-file=.env.local; nothing was checked.`); process.exit(2); }
const report = schemaReport(results);
console.log(formatSchemaReport(report));
process.exit(report.ok ? 0 : report.missing.length ? 1 : 2);
