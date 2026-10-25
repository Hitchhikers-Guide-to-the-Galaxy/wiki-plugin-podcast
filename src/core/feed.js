// Parse a podcast feed (RSS 2.0 with iTunes tags; Atom as a fallback) into
// plain data. No wiki here: page.js turns this into pages.
import { XMLParser } from 'fast-xml-parser'
import { plain, parseDuration } from './text.js'
import { getText } from './http.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  cdataPropName: false,          // CDATA becomes ordinary text
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  parseTagValue: false,          // keep "0012" as text
  isArray: name => ['item', 'entry', 'itunes:category', 'link', 'enclosure', 'media:content'].includes(name),
})

const text = v => v == null ? '' : typeof v === 'object' ? (v['#text'] ?? '') : String(v)
const first = v => Array.isArray(v) ? v[0] : v
const attr = (v, a) => first(v)?.[`@${a}`]

export function parseFeed(xml, { url } = {}) {
  const doc = parser.parse(xml)
  if (doc.rss?.channel) return fromRss(first(doc.rss.channel), url)
  if (doc.feed) return fromAtom(doc.feed, url)
  throw new Error('not an RSS or Atom feed')
}

function fromRss(c, url) {
  const image = attr(c['itunes:image'], 'href') || text(first(c.image)?.url) || undefined
  const links = (c.link || []).map(l => typeof l === 'object' ? (l['#text'] || l['@href']) : l).filter(Boolean)
  const website = links.find(l => /^https?:/.test(l) && l !== url)
  const categories = [...new Set((c['itunes:category'] || []).flatMap(cat =>
    [attr(cat, 'text'), ...[].concat(cat['itunes:category'] || []).map(s => attr(s, 'text'))]).filter(Boolean))]
  return {
    kind: 'rss',
    url,
    newFeedUrl: text(c['itunes:new-feed-url']) || undefined,
    title: plain(text(c.title)),
    description: text(c.description) || text(c['itunes:summary']),
    author: plain(text(c['itunes:author'])) || plain(text(c['itunes:owner']?.['itunes:name'])) || undefined,
    website,
    image,
    language: text(c.language) || undefined,
    categories,
    copyright: plain(text(c.copyright)) || undefined,
    episodes: (c.item || []).map(i => episodeFromRss(i, image)).filter(e => e.audio),
  }
}

function episodeFromRss(i, podcastImage) {
  const enc = (i.enclosure || []).find(e => /^audio\//i.test(e['@type'] || '') || /\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i.test(e['@url'] || ''))
    || (i['media:content'] || []).find(m => /^audio\//i.test(m['@type'] || ''))
  const guid = text(i.guid)
  const pub = Date.parse(text(i.pubDate))
  const links = (i.link || []).map(l => typeof l === 'object' ? (l['#text'] || l['@href']) : l).filter(Boolean)
  return {
    title: plain(text(i.title)) || plain(text(i['itunes:title'])),
    guid: guid || undefined,
    link: links[0] || (/^https?:/.test(guid) ? guid : undefined),
    published: Number.isFinite(pub) ? new Date(pub).toISOString() : undefined,
    duration: parseDuration(text(i['itunes:duration'])),
    season: text(i['itunes:season']) || undefined,
    number: text(i['itunes:episode']) || undefined,
    subtitle: plain(text(i['itunes:subtitle'])) || undefined,
    // The richest show notes win: content:encoded, then description, then the iTunes summary.
    notes: text(i['content:encoded']) || text(i.description) || text(i['itunes:summary']),
    image: attr(i['itunes:image'], 'href') || undefined,
    podcastImage,
    audio: enc ? { url: enc['@url'], type: enc['@type'] || undefined, bytes: +enc['@length'] || undefined } : undefined,
  }
}

function fromAtom(f, url) {
  const href = (links, rel) => (links || []).find(l => (l['@rel'] || 'alternate') === rel)?.['@href']
  return {
    kind: 'atom', url,
    title: plain(text(f.title)), description: text(f.subtitle), author: plain(text(f.author?.name)) || undefined,
    website: href(f.link, 'alternate'), image: text(f.logo) || text(f.icon) || undefined, categories: [],
    episodes: (f.entry || []).map(e => {
      const enc = (e.link || []).find(l => l['@rel'] === 'enclosure')
      const pub = Date.parse(text(e.published) || text(e.updated))
      return {
        title: plain(text(e.title)), guid: text(e.id) || undefined, link: href(e.link, 'alternate'),
        published: Number.isFinite(pub) ? new Date(pub).toISOString() : undefined,
        notes: text(e.content) || text(e.summary),
        audio: enc ? { url: enc['@href'], type: enc['@type'], bytes: +enc['@length'] || undefined } : undefined,
      }
    }).filter(e => e.audio),
  }
}

export async function fetchFeed(url, { fetch } = {}) {
  const r = await getText(url, { fetch })
  if (!r.ok) throw new Error(`feed answered HTTP ${r.status}`)
  const feed = parseFeed(r.text, { url })
  feed.finalUrl = r.url !== url ? r.url : undefined
  // Newest first, whatever order the feed uses.
  feed.episodes.sort((a, b) => (b.published || '').localeCompare(a.published || ''))
  return feed
}

// Pick an episode by guid, by audio URL, or by title (best effort).
export function findEpisode(feed, { guid, title, audio } = {}) {
  const eps = feed.episodes
  return (guid && eps.find(e => e.guid === guid || e.guid?.endsWith(guid)))
    || (audio && eps.find(e => e.audio?.url === audio))
    || (title && eps.find(e => e.title.toLowerCase() === String(title).toLowerCase()))
    || (title && eps.find(e => e.title.toLowerCase().includes(String(title).toLowerCase())))
}
