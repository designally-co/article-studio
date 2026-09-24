import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetch a URL only if every address it touches is on the public internet.
 *
 * WHY THIS EXISTS. The server fetches addresses it did not choose: search-API
 * results, and — since covers can be taken from the pages an article cites —
 * URLs a language model wrote into a Sources list. The check that was here
 * before looked at the hostname as a string and refused literal private
 * addresses, which it said plainly was only "the cheap half": it did not
 * resolve DNS, so `intranet.example.com` pointing at 10.0.0.5 passed, and it
 * followed redirects blindly, so a public page answering 302 to
 * `http://169.254.169.254/` passed too. On Vercel that reaches little. On the
 * office NAS this app is moving to, it reaches the office.
 *
 * So each hop is checked the same way before it is requested:
 *   - https only;
 *   - no loopback / `.local` / `.internal` names;
 *   - the name is RESOLVED, and every address it resolves to must be public;
 *   - redirects are followed by hand, at most MAX_REDIRECTS, each re-checked.
 *
 * WHAT IT DOES NOT CLOSE: DNS rebinding — a name that resolves publicly for the
 * check and privately a moment later for the connection. Pinning the connection
 * to the checked address needs a custom agent this runtime's `fetch` does not
 * take. The window is small and the bodies are capped; it is named here so it
 * is not mistaken for closed.
 */

const MAX_REDIRECTS = 3;

function isPrivateV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, and cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

function isPrivateV6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // IPv4-mapped (::ffff:10.0.0.1) — judged as the IPv4 address it carries.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateV4(mapped[1]);
  return (
    /^f[cd]/.test(lower) || // unique local fc00::/7
    /^fe[89ab]/.test(lower) || // link-local fe80::/10
    /^ff/.test(lower) // multicast
  );
}

/** True when this literal address is somewhere the public internet is not. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateV4(address);
  if (family === 6) return isPrivateV6(address);
  return true;
}

/** The URL if it is an https address whose name resolves only to public addresses. */
export async function checkPublicUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
  if (host.endsWith(".internal") || host === "metadata.google.internal") return null;

  if (isIP(host)) return isPrivateAddress(host) ? null : url;

  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0) return null;
    if (addresses.some(({ address }) => isPrivateAddress(address))) return null;
  } catch {
    return null;
  }
  return url;
}

/**
 * GET a public URL, following redirects by hand and checking every hop.
 * Null when any hop is not public, the request fails, or it times out.
 */
export async function publicFetch(
  raw: string,
  options: { accept: string; userAgent: string; timeoutMs: number },
): Promise<Response | null> {
  const deadline = AbortSignal.timeout(options.timeoutMs);
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await checkPublicUrl(current);
    if (!url) return null;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "user-agent": options.userAgent, accept: options.accept },
        redirect: "manual",
        signal: deadline,
        cache: "no-store",
      });
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      // Drain nothing: the body of a redirect is not read.
      if (!location) return null;
      try {
        current = new URL(location, url).toString();
      } catch {
        return null;
      }
      continue;
    }
    return response;
  }
  return null;
}

/**
 * The body, or null if it is larger than `maxBytes`.
 *
 * Read as a stream and abandoned at the cap: `content-length` is a claim the
 * server makes, and a missing or false one must not let a response be read
 * into memory without limit.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}
