// A fetch that only reaches the public internet.
//
// The podcast plugin fetches links that people paste into a page. Run on a
// farm, that would let a link reach things only the farm machine can see:
// itself, the home network, the tailnet. So every hop (redirects included) is
// checked: http(s) only, and the host must resolve to public addresses only.
// DNS can still change between the check and the request (rebinding); for an
// owner-only tool on a private farm that risk is accepted and noted here.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const v4 = a => a.split('.').map(Number)
function privateV4(a) {
  const [x, y] = v4(a)
  return x === 0 || x === 10 || x === 127 || x >= 224 ||
    (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) ||
    (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127) ||  // 100.64/10: CGNAT and the tailnet
    (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19))
}
function privateV6(a) {
  const s = a.toLowerCase()
  if (s === '::' || s === '::1') return true
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return privateV4(mapped[1])
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith('fd7a:115c:a1e0')  // ULA, link-local, multicast, tailnet
}
export const isPrivateAddress = a => isIP(a) === 4 ? privateV4(a) : isIP(a) === 6 ? privateV6(a) : true

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|lan|home|ts\.net|private\.fish)$/i

export async function checkUrl(raw) {
  let u
  try { u = new URL(raw) } catch { throw Object.assign(new Error('not a link'), { status: 400 }) }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error(`only http and https links (${u.protocol})`), { status: 400 })
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (BLOCKED_NAMES.test(host)) throw Object.assign(new Error(`${host} is a private name`), { status: 403 })
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
  if (!addrs.length) throw Object.assign(new Error(`${host} does not resolve`), { status: 400 })
  const bad = addrs.find(a => isPrivateAddress(a.address))
  if (bad) throw Object.assign(new Error(`${host} points at a private address`), { status: 403 })
  return u
}

export function guardedFetch(base = globalThis.fetch, { maxHops = 6 } = {}) {
  return async function fetchPublic(url, opts = {}) {
    let current = String(url)
    for (let hop = 0; hop <= maxHops; hop++) {
      await checkUrl(current)
      const res = await base(current, { ...opts, redirect: 'manual' })
      const loc = res.status >= 300 && res.status < 400 && res.headers.get('location')
      if (!loc) {
        // Keep the final URL visible to callers, as redirect:'follow' would.
        if (res.url !== current) Object.defineProperty(res, 'url', { value: current })
        return res
      }
      current = new URL(loc, current).href
    }
    throw Object.assign(new Error('too many redirects'), { status: 502 })
  }
}
