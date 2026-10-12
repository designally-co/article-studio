/**
 * Replace the local articles with production's, files and all.
 *
 * Local development runs on embedded PGlite with seed data, so the pipeline is
 * usually exercised against three invented articles. This pulls the real ones
 * down instead, which is the difference between testing a layout against
 * "word word word" and testing it against an article somebody published.
 *
 * DESTRUCTIVE, LOCALLY ONLY. It deletes every local project and everything
 * hanging off one. It never writes to production — the production connection is
 * opened read-only in intent and only ever SELECTed from.
 *
 * TWO THINGS MAKE THIS MORE THAN A COPY.
 *
 * Foreign keys do not line up. The two databases were seeded independently, so
 * their categories share all 34 names and NOT ONE id, and the same person has a
 * different user id in each. Copying `category_id` verbatim would either fail
 * the constraint or, worse, point an article at whatever local row happened to
 * take that id. Both columns are remapped: categories by name, the author to
 * whoever exists locally.
 *
 * Image bytes do not travel either. Rows carry R2 URLs, and local has no R2
 * credentials — `resolveImage` would fail for every one of them and the Library
 * would be a wall of broken thumbnails. Each file is downloaded from the
 * bucket's public domain (no credentials needed) into `data/images/` and its
 * path rewritten to `local:`, so the copy is self-contained and keeps working
 * with the network off.
 *
 * Ids are otherwise preserved, because things point at each other by id:
 * `images.reference_ids` names the references a cover came from, and
 * `inputs_json.coverImageId` names the image an article publishes.
 */
import path from "node:path";
import fs from "node:fs/promises";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";

const LOCAL_DIR = path.join(process.cwd(), "data", "images");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Need DATABASE_URL (production).");
  process.exit(1);
}

const prod = postgres(DATABASE_URL, { max: 1 });
const local = new PGlite("./data/pg");
/* The tables live in the schema `studio` (migration 0030), and every query
   below names them bare. One connection each, so this holds for the whole run.
   The local database must have been started once with this build, so its
   tables have moved too. */
await prod`set search_path = studio`;
await local.query("set search_path = studio");

/** Column names as the database reports them, so nothing is hard-coded here. */
async function columnsOf(table: string): Promise<string[]> {
  const rows = (await prod`
    select column_name from information_schema.columns
    where table_schema = 'studio' and table_name = ${table}
    order by ordinal_position
  `) as unknown as { column_name: string }[];
  return rows.map((r) => r.column_name);
}

/** jsonb comes back parsed from postgres.js and must go in as text for PGlite. */
function bind(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

async function copyTable(
  table: string,
  rows: Record<string, unknown>[],
  remap: Record<string, (row: Record<string, unknown>) => unknown> = {}
) {
  if (rows.length === 0) {
    console.log(`  ${table.padEnd(18)} 0`);
    return;
  }
  const cols = await columnsOf(table);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const statement = `insert into ${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${placeholders})`;
  for (const row of rows) {
    const values = cols.map((c) => bind(c in remap ? remap[c](row) : row[c]));
    await local.query(statement, values);
  }
  console.log(`  ${table.padEnd(18)} ${rows.length}`);
}

async function main() {
  // ---- what local has to map onto -------------------------------------------
  const localCategories = (
    (await local.query(`select id, name from categories`)) as { rows: { id: string; name: string }[] }
  ).rows;
  const byName = new Map(localCategories.map((c) => [c.name, c.id]));
  const localUser = (
    (await local.query(`select id from users order by created_at asc limit 1`)) as { rows: { id: string }[] }
  ).rows[0];
  if (!localUser) throw new Error("No local user to attribute articles to — sign in locally first.");

  const prodCategories = (await prod`select id, name from categories`) as unknown as {
    id: string;
    name: string;
  }[];
  const prodCategoryName = new Map(prodCategories.map((c) => [c.id, c.name]));

  /** Production category id -> the local row with the same name. */
  const categoryFor = (prodId: unknown): string | null => {
    if (typeof prodId !== "string") return null;
    const name = prodCategoryName.get(prodId);
    return (name && byName.get(name)) ?? null;
  };

  // ---- clear the local articles ---------------------------------------------
  console.log("clearing local articles…");
  for (const t of ["routine_runs", "image_references", "images", "refinements", "drafts", "projects"]) {
    const before = (await local.query(`select count(*)::int n from ${t}`)) as { rows: { n: number }[] };
    // routine_runs first and by hand: it references projects, and a run whose
    // article is gone is not a run, it is a dangling row on the Routines page.
    await local.query(t === "routine_runs" ? `delete from ${t} where project_id is not null` : `delete from ${t}`);
    console.log(`  ${t.padEnd(18)} -${before.rows[0].n}`);
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });

  // ---- pull ------------------------------------------------------------------
  console.log("\ncopying from production…");
  const projects = (await prod`select * from projects order by created_at asc`) as unknown as Record<
    string,
    unknown
  >[];
  const ids = projects.map((p) => p.id as string);

  await copyTable("projects", projects, {
    category_id: (row) => categoryFor(row.category_id),
    created_by: () => localUser.id,
  });
  await copyTable(
    "drafts",
    (await prod`select * from drafts where project_id in ${prod(ids)}`) as unknown as Record<string, unknown>[]
  );
  await copyTable(
    "refinements",
    (await prod`select * from refinements where project_id in ${prod(ids)}`) as unknown as Record<
      string,
      unknown
    >[]
  );
  await copyTable(
    "images",
    (await prod`select * from images where project_id in ${prod(ids)}`) as unknown as Record<string, unknown>[]
  );
  await copyTable(
    "image_references",
    (await prod`select * from image_references where project_id in ${prod(ids)}`) as unknown as Record<
      string,
      unknown
    >[]
  );

  // ---- bring the bytes down too ---------------------------------------------
  console.log("\ndownloading image files…");
  let got = 0;
  let missing = 0;
  let bytes = 0;
  for (const table of ["images", "image_references"] as const) {
    // A swept reference has no file left to fetch; its row is kept for the
    // licence it records, and loadProject already filters it out.
    const where = table === "image_references" ? "and swept_at is null" : "";
    const rows = (await local.query(
      `select id, storage_path from ${table} where storage_path like 'https://%' ${where}`
    )) as { rows: { id: string; storage_path: string }[] };

    for (const row of rows.rows) {
      // The object key is a UUID and the extension — unique already, so it
      // doubles as the local filename.
      const filename = path.basename(new URL(row.storage_path).pathname);
      const res = await fetch(row.storage_path);
      if (!res.ok) {
        missing += 1;
        continue;
      }
      const data = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(path.join(LOCAL_DIR, filename), data);
      await local.query(`update ${table} set storage_path = $1 where id = $2`, [`local:${filename}`, row.id]);
      got += 1;
      bytes += data.length;
    }
  }
  console.log(`  ${got} files (${(bytes / 1024 / 1024).toFixed(1)}MB)${missing ? `, ${missing} absent upstream` : ""}`);

  const counts = (await local.query(
    `select (select count(*)::int from projects) p, (select count(*)::int from drafts) d,
            (select count(*)::int from images) i, (select count(*)::int from image_references) r`
  )) as { rows: { p: number; d: number; i: number; r: number }[] };
  const c = counts.rows[0];
  console.log(`\nlocal now: ${c.p} articles, ${c.d} drafts, ${c.i} images, ${c.r} references`);
}

main()
  .then(async () => {
    await prod.end();
    await local.close();
  })
  .catch(async (error) => {
    console.error(error);
    await prod.end();
    await local.close();
    process.exit(1);
  });
