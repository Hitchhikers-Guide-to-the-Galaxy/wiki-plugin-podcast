// Searching inside one podcast. The feed's own items first: free, offline-safe,
// and the only source whose hits are sure to be on the page's feed. ListenNotes
// second, scoped to the podcast (ocid), when the feed turns up little: it
// indexes every episode a podcast ever had, including ones the feed has dropped.
import { plain } from './text.js'

const words = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)

export const epKey = e => e.guid || e.audio?.url

// A window of plain text around the first word that matches.
export function snippet(text, terms, width = 160) {
  const t = plain(text)
  const low = t.toLowerCase()
  let at = -1
  for (const w of terms) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i }
  if (at < 0) return t.slice(0, width)
  const start = Math.max(0, at - Math.floor(width / 3))
  const s = t.slice(start, start + width)
  return `${start ? '…' : ''}${s.trim()}${start + width < t.length ? '…' : ''}`
}

// Hits in the feed: every query word in the title scores highest, then any
// word in the title, then every word in the notes. Ties go to the newest.
export function searchFeed(feed, q, { limit = 20 } = {}) {
  const terms = words(q)
  if (!terms.length) return []
  const hits = []
  for (const e of feed.episodes) {
    const title = words(e.title).join(' ')
    const notes = words(e.notes || e.subtitle).join(' ')
    const inTitle = terms.filter(w => title.includes(w)).length
    const inNotes = terms.filter(w => notes.includes(w)).length
    let score = 0, where
    if (inTitle === terms.length) { score = 3; where = 'title' }
    else if (inNotes === terms.length) { score = inTitle ? 2 : 1; where = 'notes' }
    else if (inTitle) { score = 0.5 + 0.5 * inTitle / terms.length; where = 'title' }
    if (!score) continue
    hits.push({ key: epKey(e), title: e.title, published: e.published, duration: e.duration, where, score,
      snippet: where === 'notes' ? snippet(e.notes || e.subtitle, terms) : undefined })
  }
  return hits.sort((a, b) => b.score - a.score || String(b.published || '').localeCompare(String(a.published || ''))).slice(0, limit)
}

// ListenNotes episodes of one podcast matching q, mapped back onto the feed by
// guid or audio URL. Hits the feed no longer carries are listed, not buildable.
export async function searchListenNotes(feed, q, { listennotesId, apiKey, fetch, limit = 10 } = {}) {
  if (!apiKey || !listennotesId) return { hits: [], usage: undefined }
  const url = `https://listen-api.listennotes.com/api/v2/search?type=episode&ocid=${encodeURIComponent(listennotesId)}&only_in=title,description&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { headers: { 'X-ListenAPI-Key': apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw Object.assign(new Error(`ListenNotes answered HTTP ${res.status}`), { status: 502 })
  const json = await res.json()
  const usage = { used: res.headers.get('x-listenapi-usage'), quota: res.headers.get('x-listenapi-freequota') }
  const byGuid = new Map(feed.episodes.filter(e => e.guid).map(e => [e.guid, e]))
  const byAudio = new Map(feed.episodes.map(e => [String(e.audio?.url || '').replace(/^https?:\/\//, ''), e]))
  const hits = (json.results || []).slice(0, limit).map(r => {
    const ep = (r.guid_from_rss && byGuid.get(r.guid_from_rss)) || byAudio.get(String(r.audio || '').replace(/^https?:\/\//, ''))
    return {
      key: ep ? epKey(ep) : undefined, inFeed: !!ep, title: plain(r.title_original || r.title_highlighted),
      published: r.pub_date_ms ? new Date(r.pub_date_ms).toISOString() : undefined, duration: r.audio_length_sec,
      where: 'listennotes', snippet: plain(r.description_highlighted || r.description_original || '').slice(0, 160), listennotesId: r.id,
    }
  })
  return { hits, usage }
}
