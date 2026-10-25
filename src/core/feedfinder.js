// Feed finder: any podcast link (or a title) in, the podcast's open RSS feed out.
//
// The feed, not a ListenNotes or player link, gives reliable open access to the
// audio, so every route ends at a feed URL that has been fetched and checked to
// be a podcast feed. No wiki DOM here: callers (plugin server, CLI, tests)
// decide what to do with the result.
//
// Routes, tried by the shape of the input:
//   rss         a feed URL, used as it is
//   bbc         BBC programme / Sounds link -> brand pid -> podcasts.files.bbci.co.uk/<pid>.rss
//   apple       Apple Podcasts link -> iTunes lookup -> feedUrl
//   listennotes ListenNotes /c/ or /e/ link -> Listen API -> itunes_id -> iTunes lookup
//               ListenNotes /podcasts/<slug> link -> title from the slug -> search
//   page        any other page -> rel=alternate feeds, Apple links, known feed hosts -> pick by title
//   search      plain text -> iTunes search, then ListenNotes search
//
// ListenNotes pages themselves are never fetched: they answer scripts with a
// captcha (checked 2026-10-25), and the free Listen API hides the rss field.

import { getText, getJson } from './http.js'

const LISTEN_API = 'https://listen-api.listennotes.com/api/v2/'
const ITUNES = 'https://itunes.apple.com/'

// ── text helpers ─────────────────────────────────────────────────────────────

const decodeEntities = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const STOP = new Set(['the', 'a', 'an', 'podcast', 'show', 'from', 'with', 'and', 'of', 'radio'])
const words = s => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !STOP.has(w))

// 0..1: how well candidate title b matches wanted title a.
export function titleScore(a, b) {
  const A = new Set(words(a)), B = new Set(words(b))
  if (!A.size || !B.size) return 0
  let common = 0
  for (const w of A) if (B.has(w)) common++
  const recall = common / A.size, precision = common / B.size
  const exact = words(a).join(' ') === words(b).join(' ') ? 0.2 : 0
  return Math.min(1, 0.6 * recall + 0.4 * precision + exact)
}

// ── checking a feed ──────────────────────────────────────────────────────────

// Fetch a URL and say whether it is a podcast feed: an RSS/Atom document with
// audio enclosures. Returns { ok, url, finalUrl, title, episodes } or { ok:false, reason }.
export async function checkFeed(url, ctx) {
  let r
  try { r = await getText(url, { fetch: ctx.fetch }) } catch (e) { return { ok: false, url, reason: e.message } }
  if (!r.ok) return { ok: false, url, reason: `HTTP ${r.status}` }
  const head = r.text.slice(0, 2000)
  if (!/<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(head)) return { ok: false, url, reason: 'not a feed' }
  const channel = r.text.split(/<item[\s>]/i)[0]
  const t = channel.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const audio = (r.text.match(/<enclosure\b[^>]*>/gi) || [])
    .filter(e => /type=["']audio\//i.test(e) || /\.(mp3|m4a|aac|ogg|opus|wav)(\?|["'])/i.test(e)).length
  if (!audio) return { ok: false, url, reason: 'feed has no audio enclosures' }
  // Newest episode date: feeds that moved keep answering, but stop growing.
  const dates = [...r.text.matchAll(/<(?:pubDate|published|updated)>([^<]+)</gi)].slice(0, 40)
    .map(m => Date.parse(m[1].trim())).filter(Number.isFinite)
  const latest = dates.length ? new Date(Math.max(...dates)).toISOString() : undefined
  return { ok: true, url, finalUrl: r.url, title: t ? decodeEntities(t[1]).trim() : '', episodes: audio, latest }
}

const STALE_DAYS = 365
const isStale = iso => iso && (Date.now() - Date.parse(iso)) / 86400000 > STALE_DAYS

// ── the sources ──────────────────────────────────────────────────────────────

async function itunesLookup(id, ctx) {
  const { json } = await getJson(`${ITUNES}lookup?id=${encodeURIComponent(id)}&entity=podcast`, { fetch: ctx.fetch })
  const r = (json.results || []).find(x => x.feedUrl) || json.results?.[0]
  return r ? { itunesId: String(r.collectionId), title: r.collectionName, feedUrl: r.feedUrl } : null
}

async function itunesSearch(term, ctx) {
  const { json } = await getJson(`${ITUNES}search?media=podcast&entity=podcast&limit=10&term=${encodeURIComponent(term)}`, { fetch: ctx.fetch })
  return (json.results || []).filter(r => r.feedUrl)
    .map(r => ({ itunesId: String(r.collectionId), title: r.collectionName, feedUrl: r.feedUrl, author: r.artistName }))
}

async function listen(path, ctx) {
  if (!ctx.apiKey) throw new Error('no ListenNotes key')
  const { json, headers } = await getJson(LISTEN_API + path, { fetch: ctx.fetch, headers: { 'X-ListenAPI-Key': ctx.apiKey } })
  ctx.usage = { used: headers.get('x-listenapi-usage'), quota: headers.get('x-listenapi-freequota') }
  return json
}

// ── result building ──────────────────────────────────────────────────────────

function step(ctx, text) { ctx.steps.push(text) }

async function finish(ctx, route, feedUrl, extra = {}) {
  step(ctx, `check ${feedUrl}`)
  const feed = await checkFeed(feedUrl, ctx)
  if (!feed.ok) throw Object.assign(new Error(`${feedUrl}: ${feed.reason}`), { route })
  const result = {
    ok: true, route, feedUrl, finalUrl: feed.finalUrl !== feedUrl ? feed.finalUrl : undefined,
    feedTitle: feed.title, episodes: feed.episodes, latest: feed.latest, ...extra,
  }
  // A feed with nothing new for a year has often moved: look for the same
  // podcast by title and prefer a feed that is still growing.
  if (isStale(feed.latest) && !ctx.freshening && feed.title) {
    ctx.freshening = true
    const kept = { ambiguous: ctx.ambiguous, candidates: ctx.candidates }
    step(ctx, `latest episode ${feed.latest.slice(0, 10)}: looking for a newer feed`)
    try {
      const alt = await bySearch(feed.title, ctx, route)
      if (alt.ok && alt.latest > feed.latest && norm(alt.finalUrl || alt.feedUrl) !== norm(result.finalUrl || feedUrl)) {
        step(ctx, `newer feed ${alt.feedUrl} (latest ${alt.latest.slice(0, 10)})`)
        Object.assign(ctx, kept, { freshening: false })
        return { ...alt, ...extra, route: route + '+newer', movedFrom: feedUrl }
      }
    } catch { /* keep the stale one */ }
    Object.assign(ctx, kept, { freshening: false })
  }
  return result
}

const norm = u => (u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')

// From a podcast title, find the feed: iTunes search first (free), then
// ListenNotes search -> itunes_id -> lookup. Picks the best title match.
// `context` is a list of titles from where the link came from (the page's own
// podcasts, its title): they steer a generic title like "Leading" towards
// "The Rest Is Politics: Leading" rather than any podcast called Leading.
async function bySearch(term, ctx, route = 'search', extra = {}, context = []) {
  context = context.filter(Boolean)
  const terms = [term, ...context.slice(0, 2).map(c => `${c} ${term}`)]
  const seen = new Map()
  for (const q of terms) {
    step(ctx, `iTunes search "${q}"`)
    for (const h of await itunesSearch(q, ctx)) if (!seen.has(h.feedUrl)) seen.set(h.feedUrl, h)
  }
  const score = h => {
    const own = titleScore(term, h.title)
    if (!context.length) return own
    const near = Math.max(...context.map(c => Math.max(titleScore(c, h.title), titleScore(c, h.author || ''))))
    return 0.7 * own + 0.3 * near
  }
  const ranked = [...seen.values()].map(h => ({ ...h, score: score(h) })).sort((a, b) => b.score - a.score)
  let best = ranked[0]
  // Two different podcasts scoring about the same: say so, and list them.
  const exact = h => h && words(h.title).join(' ') === words(term).join(' ')
  if (ranked[1] && ranked[0].score - ranked[1].score < 0.1 && !(exact(ranked[0]) && !exact(ranked[1]))) {
    ctx.ambiguous = true
    ctx.candidates = ranked.slice(0, 5).map(h => ({ title: h.title, feedUrl: h.feedUrl, itunesId: h.itunesId, author: h.author, score: +h.score.toFixed(2) }))
  }
  // Weak or ambiguous: ask ListenNotes too. Its search ranks by relevance and
  // popularity, which breaks ties between podcasts with the same words in the title.
  if ((!best || best.score < 0.6 || ctx.ambiguous) && ctx.apiKey) {
    step(ctx, `ListenNotes search "${term}"`)
    const res = await listen(`search?type=podcast&only_in=title,author&q=${encodeURIComponent(term)}`, ctx)
    const lnHits = []
    for (const p of (res.results || []).slice(0, 5)) {
      if (!p.itunes_id) continue
      const look = await itunesLookup(p.itunes_id, ctx).catch(() => null)
      if (look?.feedUrl) lnHits.push({ ...look, listennotesId: p.id, score: score({ title: p.title_original }) })
    }
    const top = lnHits.find(h => h.score >= 0.6)
    if (top && (!best || ctx.ambiguous || top.score > best.score)) best = top
    if (ctx.ambiguous) {
      const all = new Map()
      for (const h of [...lnHits, ...ranked]) if (!all.has(h.feedUrl)) all.set(h.feedUrl, h)
      ctx.candidates = [...all.values()].slice(0, 6).map(h => ({ title: h.title, feedUrl: h.feedUrl, itunesId: h.itunesId, listennotesId: h.listennotesId, score: +h.score.toFixed(2) }))
    }
  }
  if (!best || best.score < 0.5) throw Object.assign(new Error(`no podcast titled like "${term}"`), { route })
  return finish(ctx, route, best.feedUrl, { title: best.title, itunesId: best.itunesId, listennotesId: best.listennotesId, matchScore: +best.score.toFixed(2), ...extra })
}

// ── routes ───────────────────────────────────────────────────────────────────

const BBC_PID = /bbc\.co\.uk\/(?:programmes|sounds\/(?:brand|series|play))\/([a-z0-9]{8})/i

async function routeBbc(url, ctx) {
  const pid = url.match(BBC_PID)[1]
  step(ctx, `BBC programme ${pid}`)
  const { json } = await getJson(`https://www.bbc.co.uk/programmes/${pid}.json`, { fetch: ctx.fetch })
  let p = json.programme, episode
  if (p.type === 'episode' || p.type === 'clip') episode = { title: p.title, pid: p.pid }
  // Walk up to the brand; try each level's podcast feed from the top down.
  const chain = []
  for (let q = p; q; q = q.parent?.programme) chain.unshift(q)
  for (const level of chain.filter(q => q.type === 'brand' || q.type === 'series')) {
    const feed = `https://podcasts.files.bbci.co.uk/${level.pid}.rss`
    const c = await checkFeed(feed, ctx)
    step(ctx, `${level.type} ${level.pid}: ${c.ok ? 'has a podcast feed' : c.reason}`)
    if (c.ok) return finish(ctx, 'bbc', feed, { title: level.title, bbcPid: level.pid, episode })
  }
  // No BBC podcast feed (not every programme is a podcast): try search by title.
  return bySearch(chain[0]?.title || p.title, ctx, 'bbc+search', { episode })
}

async function routeApple(url, ctx) {
  const id = url.match(/\/id(\d+)/)[1]
  step(ctx, `iTunes lookup ${id}`)
  const look = await itunesLookup(id, ctx)
  if (!look?.feedUrl) throw Object.assign(new Error(`Apple id ${id} has no public feed`), { route: 'apple' })
  return finish(ctx, 'apple', look.feedUrl, { title: look.title, itunesId: look.itunesId })
}

async function fromListenPodcast(pod, ctx, extra = {}) {
  const title = pod.title || pod.title_original
  if (pod.itunes_id) {
    step(ctx, `ListenNotes says itunes_id ${pod.itunes_id}`)
    const look = await itunesLookup(pod.itunes_id, ctx)
    if (look?.feedUrl) return finish(ctx, 'listennotes', look.feedUrl, { title, listennotesId: pod.id, itunesId: String(pod.itunes_id), ...extra })
  }
  return bySearch(title, ctx, 'listennotes+search', { listennotesId: pod.id, ...extra })
}

// Title words from a ListenNotes slug: "the-rest-is-politics-goalhanger-GQCVYfw6LKv"
// ends in an 11-character short id, which is not an API id; drop it.
const slugTitle = slug => slug.split('-').filter((w, i, a) => !(i === a.length - 1 && /^[A-Za-z0-9_]{11}$/.test(w) && /[A-Z0-9_]/.test(w))).join(' ')

async function routeListenNotes(url, ctx) {
  const u = new URL(url)
  let m
  if ((m = u.pathname.match(/^\/(?:c|podcasts?)\/([0-9a-f]{32})\/?$/))) {
    step(ctx, `ListenNotes podcast ${m[1]}`)
    return fromListenPodcast(await listen(`podcasts/${m[1]}?sort=recent_first`, ctx), ctx)
  }
  if ((m = u.pathname.match(/^\/(?:e|episodes?)\/([0-9a-f]{32})\/?$/))) {
    step(ctx, `ListenNotes episode ${m[1]}`)
    const ep = await listen(`episodes/${m[1]}`, ctx)
    const episode = { title: ep.title, guid: ep.guid_from_rss, listennotesId: ep.id }
    const pod = ep.podcast || {}
    // The episode's podcast block is short; fetch the podcast for its itunes_id when missing.
    const full = pod.itunes_id ? pod : await listen(`podcasts/${pod.id}?sort=recent_first`, ctx)
    return fromListenPodcast(full, ctx, { episode })
  }
  if ((m = u.pathname.match(/^\/podcasts\/([^/]+)(?:\/([^/]+))?\/?$/))) {
    const title = slugTitle(m[1])
    const episode = m[2] ? { title: slugTitle(m[2]) } : undefined
    step(ctx, `ListenNotes slug, title "${title}"`)
    return bySearch(ctx.title || title, ctx, 'listennotes+search', { episode })
  }
  throw Object.assign(new Error('a ListenNotes link this finder does not know'), { route: 'listennotes' })
}

// Feed hosts whose show pages map straight to a feed.
const SHOW_PAGE_FEEDS = [
  [/(?:play|shows)\.acast\.com\/(?:s\/)?([a-z0-9-]+)/i, m => `https://feeds.acast.com/public/shows/${m[1]}`],
  [/anchor\.fm\/([a-z0-9-]+)\/?$/i, m => `https://anchor.fm/s/${m[1]}/podcast/rss`],
]
const FEED_HOST = /^https?:\/\/(feeds?\.[^/]+|[^/]*(megaphone|simplecast|podbean|acast|libsyn|buzzsprout|art19|transistor|captivate|omny|spreaker|audioboom|soundcloud|anchor|podigee|redcircle)[^/]*)\/.*|\.(rss|xml)(\?|$)|\/feed\/?(podcast\/?)?$/i

async function routePage(url, ctx) {
  for (const [re, make] of SHOW_PAGE_FEEDS) {
    const m = url.match(re)
    if (m) {
      const c = await checkFeed(make(m), ctx)
      step(ctx, `show page -> ${make(m)}: ${c.ok ? 'feed' : c.reason}`)
      if (c.ok) return finish(ctx, 'page', make(m), { title: c.title })
    }
  }
  step(ctx, `fetch page ${url}`)
  let page = await getText(url, { fetch: ctx.fetch })
  // A link that turns out to be a feed already.
  if (/<rss[\s>]|<feed[\s>]/i.test(page.text.slice(0, 2000))) return finish(ctx, 'rss', url)
  // Podcast pages move; the site's home page usually still says where the podcast is.
  const home = new URL('/', page.url || url).href
  if (!page.ok && home !== url && home !== page.url) {
    step(ctx, `page answered HTTP ${page.status}; trying ${home}`)
    page = await getText(home, { fetch: ctx.fetch })
  }
  if (!page.ok) {
    if (ctx.title) return bySearch(ctx.title, ctx, 'page+search')
    throw Object.assign(new Error(`page answered HTTP ${page.status}`), { route: 'page' })
  }
  const html = page.text
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)
  const tt = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const pageTitle = decodeEntities((og?.[1] || tt?.[1] || '').trim())
  const want = ctx.title || pageTitle

  const abs = href => { try { return new URL(decodeEntities(href), page.url).href } catch { return null } }
  const feeds = new Set(), apple = new Set()
  for (const l of html.match(/<link\b[^>]*>/gi) || [])
    if (/rel=["']?alternate/i.test(l) && /(rss|atom)\+xml/i.test(l)) { const h = l.match(/href=["']([^"']+)/i); if (h) feeds.add(abs(h[1])) }
  for (const [, href] of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const h = abs(href)
    if (!h) continue
    if (/podcasts\.apple\.com\/.*\/id\d+/.test(h)) apple.add(h.match(/\/id(\d+)/)[1])
    else if (FEED_HOST.test(h)) feeds.add(h)
  }
  step(ctx, `page "${pageTitle}": ${feeds.size} feed link(s), ${apple.size} Apple link(s)`)

  const candidates = []
  for (const f of [...feeds].slice(0, 8)) {
    const c = await checkFeed(f, ctx)
    if (c.ok) candidates.push({ feedUrl: f, title: c.title, via: 'feed link' })
  }
  for (const id of [...apple].slice(0, 8)) {
    const look = await itunesLookup(id, ctx).catch(() => null)
    if (look?.feedUrl) candidates.push({ feedUrl: look.feedUrl, title: look.title, itunesId: look.itunesId, via: 'Apple link' })
  }
  const scored = candidates.map(c => ({ ...c, score: want ? titleScore(want, c.title) : 0 })).sort((a, b) => b.score - a.score)
  ctx.candidates = scored.map(c => ({ title: c.title, feedUrl: c.feedUrl, via: c.via, score: +c.score.toFixed(2) }))
  const best = scored[0]
  // One podcast on the page, or one that clearly matches the title we want.
  if (best && (scored.length === 1 || best.score >= 0.6) && !(ctx.title && best.score < 0.5)) {
    return finish(ctx, 'page', best.feedUrl, { title: best.title, itunesId: best.itunesId, via: best.via })
  }
  if (!want) throw Object.assign(new Error('page links to no podcast feed and has no title to search'), { route: 'page' })
  step(ctx, scored.length ? `${scored.length} podcasts on the page, none clearly "${want}"` : 'no feed on the page')
  // Search, steered by what the page is about: its own podcasts and its title.
  const siteName = pageTitle.split(/\s[|–—-]\s/).map(s => s.trim()).filter(Boolean)
  const context = ctx.title ? [...new Set([...scored.map(c => c.title), ...siteName])].filter(c => c !== want) : []
  return bySearch(want, ctx, 'page+search', {}, context)
}

// ── entry point ──────────────────────────────────────────────────────────────

export function classify(input) {
  const s = String(input || '').trim()
  if (!/^https?:\/\//i.test(s)) return s ? 'search' : 'empty'
  if (BBC_PID.test(s)) return 'bbc'
  if (/podcasts\.apple\.com\/.*\/id\d+/i.test(s) || /itunes\.apple\.com\/.*\/id\d+/i.test(s)) return 'apple'
  if (/^https?:\/\/(www\.)?listennotes\.com\//i.test(s)) return 'listennotes'
  if (FEED_HOST.test(s) && !/acast\.com\/s\//i.test(s)) return 'rss'
  return 'page'
}

// findFeed(input, { title, apiKey, fetch }) -> result
//   input  a link or a podcast title
//   title  optional hint, used when a page carries several podcasts
// Result: { ok, route, feedUrl, finalUrl?, feedTitle, episodes, title?, itunesId?,
//           listennotesId?, bbcPid?, episode?, steps, candidates?, usage? }
// or { ok:false, route, error, steps }.
export async function findFeed(input, { title, apiKey, fetch = globalThis.fetch } = {}) {
  const ctx = { title, apiKey, fetch, steps: [] }
  const kind = classify(input)
  const s = String(input || '').trim()
  try {
    let r
    switch (kind) {
      case 'empty': throw Object.assign(new Error('nothing to look up'), { route: 'empty' })
      case 'search': r = await bySearch(s, ctx); break
      case 'rss': {
        const c = await checkFeed(s, ctx)
        r = c.ok ? await finish(ctx, 'rss', s) : await routePage(s, ctx)
        break
      }
      case 'bbc': r = await routeBbc(s, ctx); break
      case 'apple': r = await routeApple(s, ctx); break
      case 'listennotes': r = await routeListenNotes(s, ctx); break
      default: r = await routePage(s, ctx)
    }
    return { input: s, ambiguous: ctx.ambiguous || undefined, candidates: ctx.candidates, ...r, steps: ctx.steps, usage: ctx.usage }
  } catch (e) {
    return { input: s, ok: false, route: e.route || kind, error: e.message, steps: ctx.steps, candidates: ctx.candidates, usage: ctx.usage }
  }
}
