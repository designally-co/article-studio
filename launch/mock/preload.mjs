/**
 * Loaded into the Article Studio server with `node --import` (see run.sh).
 *
 * Every outbound request the server makes goes through here. Fal.ai is sent to
 * the local mock (launch/mock/server.mjs); anything else outside this machine
 * is answered with an empty 404 and never leaves it. That is the guarantee the
 * capture spends no credit and pulls no third-party photograph into frame: the
 * article's source pages, Unsplash and Openverse are simply not reachable.
 *
 * Requests to the local Hub (HUB_BASE_URL) go through, after the mock's `hub`
 * gate lets them (see server.mjs).
 *
 * Anthropic needs no rewrite here: ANTHROPIC_BASE_URL points the SDK at the
 * mock directly.
 */
const MOCK = process.env.MOCK_ORIGIN || "http://127.0.0.1:4010";
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const HUB = process.env.HUB_BASE_URL ? new URL(process.env.HUB_BASE_URL).origin : null;
const realFetch = globalThis.fetch;

function rewrite(url) {
  if (url.hostname === "fal.run" || url.hostname === "queue.fal.run") return `${MOCK}/fal${url.pathname}`;
  if (url.hostname.endsWith("fal.media")) return `${MOCK}/files/${url.pathname.split("/").pop()}`;
  return null;
}

globalThis.fetch = async function launchFetch(input, init) {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url;
  try {
    url = new URL(href);
  } catch {
    return realFetch(input, init);
  }
  // The local Hub is real, but waits at the mock's `hub` gate so the capture
  // can hold the publish card on screen.
  if (url.origin === HUB) await realFetch(`${MOCK}/control/wait?name=hub`);
  if (LOCAL.test(url.hostname)) return realFetch(input, init);
  const target = rewrite(url);
  if (target) {
    const request = input instanceof Request ? input : undefined;
    return realFetch(target, {
      method: init?.method ?? request?.method,
      headers: init?.headers ?? request?.headers,
      body: init?.body ?? (request ? await request.arrayBuffer() : undefined),
      signal: init?.signal,
    });
  }
  console.log(`[launch] blocked outbound request to ${url.hostname}`);
  return new Response("", { status: 404, statusText: "Blocked by launch capture" });
};
