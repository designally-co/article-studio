/**
 * Gets the LOCAL PGlite database ready for a capture: one signed-in editor and
 * a Fal.ai key row (a placeholder: preload.mjs sends every Fal call to the
 * mock, so the value is never used). Run with the app stopped — PGlite is one
 * process at a time — and after the app has booted once to migrate and seed.
 *
 * Prints the user's id, which the capture turns into a session cookie.
 */
import { PGlite } from "@electric-sql/pglite";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import path from "node:path";

const db = new PGlite(path.join(process.cwd(), "data", "pg"));

function encrypt(plain) {
  // The same scheme as src/lib/crypto.ts, keyed by ENCRYPTION_KEY.
  const key = scryptSync(process.env.ENCRYPTION_KEY, "content-studio-api-keys", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), data.toString("hex")].join(":");
}

const email = "editor@example.com";
await db.query(`insert into users (email, name, role) values ($1, $2, 'admin') on conflict (email) do nothing`, [
  email,
  "Demo Editor",
]);
const { rows: [user] } = await db.query(`select id from users where email = $1`, [email]);

const { rows: keys } = await db.query(`select id from api_keys where provider = 'fal'`);
if (keys.length === 0) {
  await db.query(`insert into api_keys (provider, label, encrypted_value) values ('fal', 'Fal.ai', $1)`, [
    encrypt("launch-placeholder-not-a-key"),
  ]);
}
const { rows: [directions] } = await db.query(`select count(*)::int as n from categories`);
console.error(`directions seeded: ${directions.n}`);
await db.close();
console.log(user.id);
