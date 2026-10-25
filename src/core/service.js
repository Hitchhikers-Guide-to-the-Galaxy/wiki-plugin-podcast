// The two things the page asks the farm for, built from the core modules:
//   find  — a link or title -> the feed, and a summary of the podcast to choose from
//   page  — a feed (and maybe an episode) -> page JSON, shown as a ghost to fork
// Every outside request goes through the public-only fetch guard.
import { findFeed } from './feedfinder.js'
import { fetchFeed, findEpisode } from './feed.js'
import { podcastPage, episodePage, cleanImage } from './page.js'
import { guardedFetch } from './guard.js'

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
