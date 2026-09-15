/**
 * Whether this process may fall back to its own disk for the things a
 * deployment has to get from outside: the database (embedded PGlite), image
 * storage (./data/images) and the key that encrypts saved provider keys.
 *
 * IN DEVELOPMENT, ALWAYS. IN PRODUCTION, ONLY WHEN ASKED. Each fallback is the
 * right answer on a laptop and a silent failure on a server. A container
 * missing DATABASE_URL boots an empty database, seeds it and reports itself
 * healthy. One missing ENCRYPTION_KEY generates a fresh key, and every provider
 * key saved under the real one stops decrypting. One missing the R2 variables
 * writes covers to a disk that goes away with the container. So a production
 * process refuses all three, and says which variable it wanted.
 *
 * `ALLOW_LOCAL_FALLBACKS=1` turns them back on for a production build run
 * somewhere disposable — `npm start` on a laptop. Never on a real deployment.
 */
export function localFallbacksAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_FALLBACKS === "1";
}
