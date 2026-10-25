// Where the ListenNotes key comes from, server side only. The browser never sees it.
// Order: LISTEN_API_KEY in the environment (Pi5 secrets file, systemd EnvironmentFile),
// then the macOS Keychain entry the laptop uses.
import { execFile } from 'node:child_process'

export const KEYCHAIN_SERVICE = 'podcastapi.com LISTEN_API_KEY'
export const KEYCHAIN_ACCOUNT = 'david'

export function listenNotesKey() {
  if (process.env.LISTEN_API_KEY) return Promise.resolve(process.env.LISTEN_API_KEY.trim())
  if (process.platform !== 'darwin') return Promise.resolve(null)
  return new Promise(resolve => {
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
      { timeout: 10000 }, (err, stdout) => resolve(err ? null : stdout.toString().trim() || null))
  })
}
