import path from "node:path";
import type { NextConfig } from "next";

/** Every platform build of libvips present at build time — linux-x64 on Vercel. */
const LIBVIPS = "./node_modules/@img/sharp-libvips-*/lib/**";

const nextConfig: NextConfig = {
  /*
   * SHARP MUST NOT BE BUNDLED, IT MUST BE TRACED WHOLE.
   *
   * Left to itself, Next's tracer follows sharp's JavaScript, ships the `.node`
   * binding it finds, and stops — the libvips shared object that binding links
   * against is loaded by dlopen at runtime, which no static analysis can see.
   * On Vercel that produced `ERR_DLOPEN_FAILED: libvips-cpp.so`, and image
   * work simply did not run in production.
   *
   * Marking it external makes Next leave the package alone and copy it out of
   * node_modules entire, `.so` and all. Verify after any Next upgrade by
   * grepping a route's `.nft.json` for `libvips` and looking for a BINARY, not
   * just the package.json beside it — that is the shape the old failure took.
   */
  serverExternalPackages: ["@electric-sql/pglite", "sharp"],
  /*
   * The self-contained server the container image runs — but NEVER ON VERCEL,
   * which does its own tracing and packaging.
   *
   * It has tolerated the setting so far. The Survey app, one Next minor ahead,
   * did not: its first deploy after the same line landed died with
   * `ENOENT .next/next-server.js.nft.json` at onBuildComplete. Vercel is kept
   * here as the rollback and then as an internal clone, and it never runs the
   * image, so there is nothing to gain by asking it for this output and a
   * broken deploy to lose.
   */
  output: process.env.VERCEL ? undefined : "standalone",
  /*
   * SHIP LIBVIPS, WHICH NOTHING ELSE WILL.
   *
   * sharp's `.node` binding is traced automatically; the 17MB shared object it
   * links against is not, because it is loaded by dlopen at runtime and no
   * static analysis can see the call. Without this, every sharp call on Vercel
   * died with `ERR_DLOPEN_FAILED: libvips-cpp.so` while working perfectly on a
   * developer's machine, where the library happens to be installed.
   *
   * `serverExternalPackages: ["sharp"]` does NOT fix it — tried, and the trace
   * was byte-identical. This is the only mechanism that works.
   *
   * IT ALSO USED NOT TO WORK. On Next 15 under Turbopack this option was
   * silently ignored, which is why the app spent months treating sharp as
   * unavailable in production and degrading around it. Re-verified on 16.2.10:
   * the binary is traced and lands in the output. Check it again after a Next
   * upgrade, by grepping a route's `.nft.json` for `libvips` and looking for a
   * `.so`/`.dylib` rather than the package.json beside it.
   *
   * Listed per route rather than globally: 17MB on every function would be
   * carried by the ones that never touch an image. These four are the entries
   * that can reach sharp — the pipeline's server actions, the autopilot that
   * generates without an editor, logo compositing, and the health probe that
   * reports whether any of it can run.
   *
   * THE KEYS ARE GLOBS, so a literal `[id]` is a CHARACTER CLASS and matches
   * "i" or "d" — never the segment. `"/api/brand-image/[id]"` looked exactly
   * right, built without complaint, and shipped no library at all. Dynamic
   * segments have to be reached with `**`, and a route group stays in the path.
   * Verified per route by reading each `.nft.json` after a build; the four
   * below carry the binary and nothing else does.
   */
  outputFileTracingIncludes: {
    "/api/health": [LIBVIPS],
    "/api/cron/autopilot": [LIBVIPS],
    "/api/brand-image/**": [LIBVIPS],
    "/(app)/pipeline/**": [LIBVIPS],
  },
  /*
   * THIS DIRECTORY IS THE WORKSPACE, and saying so is not housekeeping.
   *
   * Turbopack infers the root by walking up for lockfiles, and a stray
   * `package-lock.json` in the HOME directory outranks this project's own — so
   * the root resolved to `/Users/admin`, `drizzle-orm` stopped resolving, and
   * `next dev` accepted connections while never answering one. A dev server
   * that hangs instead of erroring is the expensive kind of broken: it looks
   * like a slow compile for as long as you are willing to wait.
   */
  turbopack: { root: path.resolve(process.cwd()) },
  experimental: {
    // Brand profile pictures upload through a Server Action; the default body
    // limit is 1MB. Allow room for the 2MB image cap plus multipart overhead.
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
