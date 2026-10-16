// Run only in the release workflow's scratch app/database, never production.
// A real 35-second idle gap catches the previous 20-second connection timeout.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';

const require = createRequire('/app/server.js');
const postgres = require('postgres');
const databaseUrl = process.env.DATABASE_URL;
const target = new URL(databaseUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'scratch database only');
assert.equal(target.password, 'ci-throwaway', 'scratch credentials only');
const probe = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connection: { application_name: 'ci-connection-probe' },
});
try {
  const health = async () => {
    const response = await fetch('http://127.0.0.1:3000/api/health');
    const body = await response.json();
    assert.equal(body.database?.ok, true);
    assert.equal(body.schema?.ok, true);
  };
  const connections = () => probe`
    select pid from pg_stat_activity
    where backend_type = 'client backend' and datname = current_database()
      and pid <> pg_backend_pid()
      and application_name <> 'ci-connection-probe'
  `;
  await health();
  const before = await connections();
  assert.ok(before.length > 0, 'the app holds a database connection');
  await setTimeout(35_000);
  await health();
  const after = await connections();
  const retained = before.some(({ pid }) => after.some((row) => row.pid === pid));
  assert.ok(retained, 'the app reuses a backend across its 30-second health-check cycle');
  console.log('pass  healthy database/schema and connection reused across a 35-second gap');
} finally {
  await probe.end();
}
