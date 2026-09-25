import Link from "next/link";
import { and, eq, desc, asc, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projects, categories, images } from "@/db/schema";
import { fetchableImageUrls } from "@/lib/image/storage";
import { PageHeading } from "@/components/page-heading";
import { PageFab } from "@/components/page-bar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "./filter-bar";
import { LibraryBar } from "./library-bar";
import { IconNew } from "@/components/icons";
import { ArticleTable } from "./article-table";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination } from "@/components/pagination";

export const dynamic = "force-dynamic";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const db = await getDb();

  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  /* A QUERY STRING IS UNTRUSTED INPUT, and both of these went straight into
     SQL. `?category=none` reached Postgres as a uuid comparison and took the
     whole page down with "invalid input syntax for type uuid" — a 500 from a
     hand-edited URL, or from a bookmark kept after a direction was deleted.
     A value that is not a real filter is simply not applied. */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const conds = [];
  if (sp.category && UUID.test(sp.category)) {
    conds.push(eq(projects.categoryId, sp.category));
  }
  if (sp.status === "draft" || sp.status === "published") {
    conds.push(eq(projects.status, sp.status));
  }

  let rows = await db
    .select({
      id: projects.id,
      status: projects.status,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      topic: projects.selectedTopic,
      categoryName: categories.name,
      // Two keys out of `inputs`, not the whole of it: it also carries prompts,
      // candidates and drafted briefs, and this is every row on the page.
      coverImageId: sql<string | null>`${projects.inputs} ->> 'coverImageId'`,
      publishedCoverImageId: sql<string | null>`${projects.inputs} ->> 'publishedCoverImageId'`,
    })
    .from(projects)
    .leftJoin(categories, eq(projects.categoryId, categories.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(projects.updatedAt));

  const query = (sp.q ?? "").trim().toLowerCase();
  if (query) {
    rows = rows.filter((row) =>
      (row.topic?.title ?? "Untitled project").toLowerCase().includes(query),
    );
  }

  /* THE COVER, NOT THE NEWEST PICTURE. This took each article's most recent
     image, so generating a fourth variation changed the thumbnail of an
     article whose chosen cover was the first — and a published article showed
     a picture that never reached the Hub. Now it is the same answer publishing
     gives: for a published article the image the Hub received, otherwise the
     one chosen; the newest only when nothing was ever chosen, which is also
     what publishing falls back to (see `coverImage`). */
  const wantedByProject = new Map(
    rows.map((row) => [
      row.id,
      [row.status === "published" ? row.publishedCoverImageId : null, row.coverImageId].filter(
        (id): id is string => !!id,
      ),
    ]),
  );
  const latestImageByProject = new Map<string, string>();
  const latestImagePathByProject = new Map<string, string>();
  if (rows.length > 0) {
    const projectIds = rows.map((row) => row.id);
    /* Only the covers. The read time that used to sit beside them cost every
       draft's FULL BODY TEXT, fetched and word-counted for every row on the
       page, to render two words in a column nobody sorted by. The column is
       gone and so is the query. */
    const imageRows = await db
      .select({
        id: images.id,
        projectId: images.projectId,
        storagePath: images.storagePath,
      })
      .from(images)
      .where(inArray(images.projectId, projectIds))
      .orderBy(desc(images.createdAt));
    const byId = new Map(imageRows.map((image) => [image.id, image]));
    for (const image of imageRows) {
      if (latestImageByProject.has(image.projectId)) continue;
      // The first wanted image that still exists on this article, else the newest.
      const wanted = (wantedByProject.get(image.projectId) ?? [])
        .map((id) => byId.get(id))
        .find((candidate) => candidate?.projectId === image.projectId);
      const pick = wanted ?? image;
      latestImageByProject.set(image.projectId, pick.id);
      latestImagePathByProject.set(image.projectId, pick.storagePath);
    }
  }

  // The browser loads every card image straight from R2's public domain.
  // Without it, each card hits /api/images/[id], and a full grid means ~27
  // serverless invocations each opening a DB connection.
  const urlByPath = await fetchableImageUrls([
    ...latestImagePathByProject.values(),
  ]);
  const imageUrlByProject = new Map<string, string>();
  for (const [projectId, imageId] of latestImageByProject) {
    const storagePath = latestImagePathByProject.get(projectId);
    const direct = storagePath ? urlByPath.get(storagePath) : undefined;
    // Fall back to the API route for `local:` images.
    imageUrlByProject.set(projectId, direct ?? `/api/images/${imageId}`);
  }

  /* `field_dir`, set by the column headings (SortHead). Anything else — a
     hand-edited URL, an old bookmark — is the default, newest first. The older
     `created_desc` and `title_asc`/`title_desc` still parse. */
  const SORT_FIELDS = ["title", "direction", "status", "updated", "created"];
  const [sortField, sortDir] = (sp.sort ?? "").split("_");
  const sort =
    SORT_FIELDS.includes(sortField) && (sortDir === "asc" || sortDir === "desc")
      ? `${sortField}_${sortDir}`
      : "updated_desc";
  const [field, dir] = sort.split("_");
  const byText = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: "base" });
  rows.sort((a, b) => {
    let comparison = 0;
    if (field === "title") comparison = byText(a.topic?.title || "Untitled project", b.topic?.title || "Untitled project");
    else if (field === "direction") comparison = byText(a.categoryName || "Uncategorized", b.categoryName || "Uncategorized");
    else if (field === "status") comparison = byText(a.status, b.status);
    else if (field === "created") comparison = a.createdAt.getTime() - b.createdAt.getTime();
    else comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
    // Ties — every draft, when sorting by status — fall back to newest first,
    // so the order within a group is still one the reader recognises.
    if (comparison === 0) return b.updatedAt.getTime() - a.updatedAt.getTime();
    return dir === "asc" ? comparison : -comparison;
  });
  const hasActiveFilters = Boolean(sp.category || sp.status || query);

  /* PAGED AFTER SORTING, NOT BEFORE. The sort decides what "first" means, so
     slicing earlier would hand out the first twenty of an arbitrary order and
     call it page one. */
  /* The reader picks the page size from the pager; `?per=` carries it. Only the
     offered sizes are honoured, so a hand-edited `?per=100000` is a 10. */
  const PER_PAGE_OPTIONS = [10, 25, 50, 100];
  const requestedPer = Number.parseInt(sp.per ?? "", 10);
  const PER_PAGE = PER_PAGE_OPTIONS.includes(requestedPer) ? requestedPer : PER_PAGE_OPTIONS[0];
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  /* Clamped rather than trusted: `?page=0`, `?page=99` and `?page=abc` all
     resolve to a page that exists instead of an empty table. */
  const requested = Number.parseInt(sp.page ?? "1", 10);
  const page = Math.min(Math.max(Number.isFinite(requested) ? requested : 1, 1), pageCount);
  const start = (page - 1) * PER_PAGE;
  const pageRows = rows.slice(start, start + PER_PAGE);

  const hrefFor = ({ page: n, per }: { page: number; per: number }) => {
    const next = new URLSearchParams();
    if (sp.q) next.set("q", sp.q);
    if (sp.category) next.set("category", sp.category);
    if (sp.status) next.set("status", sp.status);
    if (sp.sort) next.set("sort", sp.sort);
    if (per !== PER_PAGE_OPTIONS[0]) next.set("per", String(per));
    if (n > 1) next.set("page", String(n));
    return next.size ? `/library?${next.toString()}` : "/library";
  };
  const hrefForPage = (n: number) => hrefFor({ page: n, per: PER_PAGE });
  /* A new page size starts again at page one: page 3 of a 10-row list is not
     a place a 50-row list has. */
  const perPageOptions = PER_PAGE_OPTIONS.map((per) => ({ value: per, href: hrefFor({ page: 1, per }) }));
  const toItemProps = (row: (typeof rows)[number]) => ({
    id: row.id,
    title: row.topic?.title || "Untitled project",
    category: row.categoryName || "Uncategorized",
    dateLabel: new Date(row.updatedAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    status: row.status,
    imageUrl: imageUrlByProject.get(row.id) ?? null,
  });

  return (
    <div className="min-h-svh bg-sunken">
      {/* On a phone the name of the page goes on the menu button's line and
          takes search with it; everything else in the header is a desktop
          idea. See LibraryBar. */}
      <LibraryBar />

      {/* New article on a phone or tablet: floating in the corner. It goes to
          Create, where every article starts. */}
      <PageFab href="/" label="New article" />

      {/* Not sticky and no rule beneath it: the title is content, so it scrolls
          away like the heading on Create. Pinned to the top it also stacked
          under the app's mobile header and covered the hamburger. */}
      <header className="mx-auto hidden w-full max-w-7xl px-3 pt-10 sm:px-8 sm:pt-14 lg:block lg:px-12 xl:px-16">
        {/* IT IS CALLED LIBRARY. "Everything on the desk." was a line of voice
            standing where the page's name goes — so the rail said Library, the
            browser tab said Library, and the page itself said something else.
            A title names the place; the voice can live in the writing. */}
        {/* A DECK, AT THE LENGTH THE SETTINGS ONES SETTLED ON — a phrase that
            names what the page holds and stops. Desktop only, because this
            whole header is: on a phone the name lives in the bar and there is
            no room under it for a second line that is not an article.

            It says "drafted or out" rather than counting, which is what this
            line used to do. A count is already down the page in the range on
            the paging pill, and it changes as you filter — a deck that moves
            while you type is a deck you learn to stop reading. */}
        {/* The controls sit ON the heading's line rather than in a band under
            it. Search and two filters is not a section of the page — it is the
            heading's action, the way "New routine" is on Routines. */}
        <PageHeading
          title="Library"
          description="Every article, drafted or out"
          actions={
            /* THE PAGE'S FORWARD ACTION, AFTER THE CONTROLS THAT NARROW IT:
               find, filter, then make something new. 36 tall like the search
               and the two selects beside it. Desktop only, like this header;
               below it New article is the floating button. */
            <div className="flex flex-wrap items-center justify-end gap-2">
              <FilterBar categories={cats.map((c) => ({ value: c.id, label: c.name }))} />
              <Button asChild className="h-9">
                <Link href="/">New article</Link>
              </Button>
            </div>
          }
        />
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 pb-24 pt-4 sm:px-8 sm:pt-10 lg:px-12 xl:px-16">
        {rows.length === 0 ? (
          <EmptyState
            title={hasActiveFilters ? "Nothing matches those filters" : "Nothing here yet"}
            description={
              hasActiveFilters
                ? "Try a different direction or status, or clear them above."
                : "The first article you start will land here."
            }
            /* No button while a filter is on: the useful action then is
               clearing it, and that control is already in the bar above. */
            action={
              hasActiveFilters ? undefined : (
                <Link href="/" className="cs-btn-primary">
                  New content
                </Link>
              )
            }
          />
        ) : (
          <ArticleTable rows={pageRows.map(toItemProps)} sort={sort} />
        )}

        {rows.length > 0 && (
          <Pagination
            label="Library pages"
            perPage={{ value: PER_PAGE, options: perPageOptions }}
            pageCount={pageCount}
            total={total}
            from={start + 1}
            to={start + pageRows.length}
            hrefFor={{
              previous: page > 1 ? hrefForPage(page - 1) : null,
              next: page < pageCount ? hrefForPage(page + 1) : null,
            }}
          />
        )}
      </main>
    </div>
  );
}
