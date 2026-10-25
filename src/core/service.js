// The two things the page asks the farm for, built from the core modules:
//   find     — a link or title -> the feed, and a summary of the podcast to choose from
//   page     — a feed (and maybe an episode) -> page JSON, shown as a ghost to fork
//   update   — a podcast page on this site -> backup, then the episodes it lacks
//   search   — a feed and a term -> matching episodes, feed first, ListenNotes second
//   podcasts — a term -> a page of podcasts to import
// Every outside request goes through the public-only fetch guard.
import { findFeed, searchPodcasts } from './feedfinder.js'
import { fetchFeed, findEpisode } from './feed.js'
import { podcastPage, episodePage, candidatesPage, cleanImage } from './page.js'
import { guardedFetch } from './guard.js'
import { readPage, backupPage, newEpisodes, anchorFor, refreshEdits, itemsFor, audioOnPage } from './update.js'
import { searchFeed, searchListenNotes } from './search.js'

const publicFetch = guardedFetch()

// Feeds are big and change slowly: keep each for ten minutes.
const feeds = new Map()
async function feedFor(url) {
  const hit = feeds.get(url)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.feed
  const feed = await fetchFeed(url, { fetch: publicFetch })
  feeds.set(url, { at: Date.now(), feed })
  if (feeds.size > 50) feeds.delete(feeds.keys().next().value)
  return feed
}

const epKey = e => e.guid || e.audio?.url

export async function find({ input, title } = {}, { apiKey } = {}) {
  const found = await findFeed(input, { title, apiKey, fetch: publicFetch })
  if (!found.ok) return { ok: false, found }
  const feed = await feedFor(found.feedUrl)
  const match = found.episode ? findEpisode(feed, found.episode) : undefined
  return {
    ok: true,
    found: { ...found, steps: found.steps },
    podcast: {
      title: feed.title, author: feed.author, website: feed.website, image: cleanImage(feed.image),
      count: feed.episodes.length, newest: feed.episodes[0]?.published,
      episodes: feed.episodes.slice(0, 25).map(e => ({ key: epKey(e), title: e.title, published: e.published, duration: e.duration })),
    },
    episode: match ? { key: epKey(match), title: match.title } : undefined,
  }
}

// Only these facts from the finder are written onto a page.
const FOUND_KEYS = ['feedUrl', 'route', 'itunesId', 'listennotesId', 'movedFrom']
const pick = f => Object.fromEntries(FOUND_KEYS.filter(k => f?.[k] != null).map(k => [k, String(f[k]).slice(0, 500)]))

export async function page({ feedUrl, episode, found, recent } = {}) {
  const feed = await feedFor(feedUrl)
  const facts = { ...pick(found), feedUrl }
  if (episode) {
    const ep = feed.episodes.find(e => epKey(e) === episode) || findEpisode(feed, { guid: episode, title: episode })
    if (!ep) return { ok: false, error: 'that episode is not in the feed (any more)' }
    return { ok: true, page: await episodePage(feed, ep, { found: facts, fetch: publicFetch }) }
  }
  const n = Math.max(1, Math.min(50, +recent || 10))
  return { ok: true, page: await podcastPage(feed, { found: facts, recent: n, fetch: publicFetch }) }
}

// Update Recent. Reads the page from the site's own disk, backs it up into the
// page's assets folder, and answers with the audio items the feed has that the
// page lacks (newest first, at most `recent`) plus the count lines to refresh.
// The browser adds and edits through the wiki's journal; nothing here writes
// the page. No backup, no answer: the backup is the point.
export async function update({ siteDir, slug, feedUrl, recent } = {}) {
  const pageJson = readPage(siteDir, slug)
  if (!pageJson) return { ok: false, error: `no page ${slug} on this site; fork the page here first` }
  const feed = await feedFor(feedUrl)
  const { missing, take } = newEpisodes(pageJson, feed, { recent })
  const have = audioOnPage(pageJson).size
  const summary = { count: feed.episodes.length, newest: feed.episodes[0]?.published, have, missing: missing.length }
  if (!take.length) return { ok: true, added: [], edits: [], after: anchorFor(pageJson), feed: summary }
  const backup = backupPage(siteDir, slug)
  const added = await itemsFor(take, { fetch: publicFetch })
  const edits = refreshEdits(pageJson, feed, { listed: have + added.length })
  return { ok: true, backup, added, edits, after: anchorFor(pageJson), feed: summary }
}

// Search inside one podcast: the feed's items, then ListenNotes scoped to the
// podcast when the feed gives fewer than three hits and the ids are known.
export async function search({ feedUrl, q, listennotesId, limit } = {}, { apiKey } = {}) {
  const feed = await feedFor(feedUrl)
  const term = String(q || '').trim()
  const hits = searchFeed(feed, term, { limit: Math.max(1, Math.min(50, +limit || 20)) })
  let more = [], usage, source = 'feed'
  if (hits.length < 3 && listennotesId && apiKey) {
    const r = await searchListenNotes(feed, term, { listennotesId, apiKey, fetch: publicFetch })
    const seen = new Set(hits.map(h => h.key))
    more = r.hits.filter(h => !h.key || !seen.has(h.key))
    usage = r.usage
    source = 'feed+listennotes'
  }
  return { ok: true, q: term, podcast: feed.title, count: feed.episodes.length, source, hits: [...hits, ...more], usage }
}

// Find Podcasts: a term -> candidates and a page of them to import from.
export async function podcasts({ q, limit } = {}, { apiKey } = {}) {
  const term = String(q || '').trim()
  const r = await searchPodcasts(term, { apiKey, fetch: publicFetch, limit: Math.max(1, Math.min(25, +limit || 12)) })
  return { ok: true, ...r, page: candidatesPage(term, r.candidates, { sources: r.sources }) }
}
