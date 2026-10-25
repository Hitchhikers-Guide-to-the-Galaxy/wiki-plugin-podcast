// Small fetch helpers shared by the feed finder. No wiki DOM, no dependencies.

export const USER_AGENT = 'Mozilla/5.0 (compatible; wiki-plugin-podcast/0.0; +https://fed.wiki.org)'

// Fetch text with a timeout. Returns { ok, status, url (after redirects), type, text }.
export async function getText(url, { fetch = globalThis.fetch, headers = {}, timeout = 15000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  })
  // Decode as UTF-8 explicitly: the old LiveCode pages garbled text by
  // decoding twice, so be strict about doing it exactly once.
  const buf = new Uint8Array(await res.arrayBuffer())
  const text = new TextDecoder('utf-8').decode(buf)
  return { ok: res.ok, status: res.status, url: res.url || url, type: res.headers.get('content-type') || '', text, headers: res.headers }
}

export async function getJson(url, opts = {}) {
  const r = await getText(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } })
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status} from ${new URL(url).host}`)
    err.status = r.status
    throw err
  }
  return { json: JSON.parse(r.text), headers: r.headers }
}
