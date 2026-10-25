// key(name) — the farm's one accessor for service keys, server side only.
//
// Plugins call this and never read a store themselves (David, 2026-10-25,
// on the Podcast Plugin Plan: "Whatever the store is, the plugin must never
// read it"). That seam is the migration path:
//   today     the environment — on the Pi5 the farm keyring
//             ~/.config/wiki-keys/env (0600, outside every site folder),
//             loaded by the farm's systemd unit as an EnvironmentFile —
//             then the macOS Keychain on the laptop;
//   next      a broker on the loopback that counts use per caller;
//   later     a broker that asks the caller for a grant.
// Nothing secret may live under a site's pages/, status/ or assets/: those
// are synced to the edge and served to the world.
import { execFile } from 'node:child_process'

// Each service: the environment names to try, in order, and where the laptop keeps it.
const SERVICES = {
  listennotes: { env: ['LISTENNOTES_KEY', 'LISTEN_API_KEY'], keychain: { service: 'podcastapi.com LISTEN_API_KEY', account: 'david' } },
  podcastindex: { env: ['PODCASTINDEX_KEY'] },
  'podcastindex-secret': { env: ['PODCASTINDEX_SECRET'] },
}

const fromKeychain = ({ service, account }) => new Promise(resolve => {
  if (process.platform !== 'darwin') return resolve(null)
  execFile('security', ['find-generic-password', '-s', service, '-a', account, '-w'],
    { timeout: 10000 }, (err, stdout) => resolve(err ? null : stdout.toString().trim() || null))
})

export async function key(name) {
  const s = SERVICES[name]
  if (!s) throw new Error(`no such service key: ${name}`)
  for (const v of s.env) if (process.env[v] && process.env[v].trim()) return process.env[v].trim()
  return s.keychain ? fromKeychain(s.keychain) : null
}

// Kept for the command-line tools.
export const listenNotesKey = () => key('listennotes')
export const KEYCHAIN_SERVICE = SERVICES.listennotes.keychain.service
export const KEYCHAIN_ACCOUNT = SERVICES.listennotes.keychain.account
