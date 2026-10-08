/**
 * Prepares a LOCAL, throwaway Knowledge Hub for the launch capture: one user
 * holding the API key Article Studio publishes with. Never point this at a
 * real database — run.sh passes a SQLite file under launch/.work.
 *
 *   HUB_DIR=../designally-knowledge-hub/cms DATABASE_URI=file:… PAYLOAD_SECRET=… \
 *     node --import tsx launch/hub/seed-hub.mts
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const hubDir = process.env.HUB_DIR
if (!hubDir) throw new Error('Set HUB_DIR to the Hub cms/ directory.')
if (!/^file:/.test(process.env.DATABASE_URI ?? '')) throw new Error('Refusing: DATABASE_URI must be a local SQLite file.')

// Resolved from the Hub's own node_modules: this folder has none.
const fromHub = (spec: string) => import(pathToFileURL(path.resolve(hubDir, 'node_modules', spec, 'dist/index.js')).href)
const { getPayload } = await fromHub('payload')
const { default: config } = await import(pathToFileURL(path.resolve(hubDir, 'src/payload.config.ts')).href)
const payload = await getPayload({ config })

const email = 'studio@example.com'
const apiKey = process.env.HUB_API_KEY ?? 'launch-local-key'
const existing = await payload.find({ collection: 'users', where: { email: { equals: email } }, overrideAccess: true })
if (existing.docs.length === 0) {
  await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: { email, password: apiKey + '-pw', enableAPIKey: true, apiKey } as never,
  })
}
console.log('hub seeded')
process.exit(0)
