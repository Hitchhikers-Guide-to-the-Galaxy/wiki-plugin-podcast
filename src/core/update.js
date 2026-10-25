// Keeping a podcast page current. The page's audio items say which episodes
// it already has; the feed says what exists; the difference is what to add.
// Pure data in and out, except backupPage, which copies the page file into
// the page's own assets folder before anything on the page changes. The
// browser applies the adds and edits through the wiki's own journal, so the
// page's history shows each new episode and the backup is there to rewind to.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { audio } from './pagejson.js'
import { cleanAudio, httpsAudio, episodeCaption } from './page.js'

const norm = u => String(u || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
const day = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''

// The audio URL an audio item plays: its first line.
export const audioUrl = item => item?.type === 'audio' ? String(item.text || '').split('\n')[0].trim() : null

// Every audio URL on the page, scheme and trailing slash dropped, so an http
// feed URL and the https copy the page plays count as the same episode.
export function audioOnPage(page) {
  const have = new Set()
  for (const it of page.story || []) { const u = audioUrl(it); if (u) have.add(norm(u)) }
  return have
}

// Feed episodes newer than the newest the page has, newest first: the feed is
// read newest first and stops at the first episode already on the page, so
// older episodes a page never listed stay unlisted (the page shows the newest
// N, not everything). A page with no audio yet gets the newest. `take` is the
// slice to add now, at most `recent`.
export function newEpisodes(page, feed, { recent = 10 } = {}) {
  const have = audioOnPage(page)
  const onPage = e => have.has(norm(e.audio.url)) || have.has(norm(cleanAudio(e.audio.url)))
  const missing = []
  for (const e of feed.episodes) {
    if (!e.audio?.url) continue
    if (have.size && onPage(e)) break
    missing.push(e)
  }
  return { missing, take: missing.slice(0, Math.max(1, Math.min(50, +recent || 10))) }
}

// Where new episodes go: right after the page's own podcast item (FEED mode),
// else after the Recent Episodes heading, else after the first item.
export function anchorFor(page) {
  const story = page.story || []
  const own = story.find(i => i.type === 'podcast' && /^FEED\s+\S/m.test(i.text || ''))
  if (own) return own.id
  const head = story.find(i => i.type === 'markdown' && /^#\s*Recent Episodes/m.test(i.text || ''))
  return head ? head.id : story[0]?.id ?? null
}

// The lines that say how many episodes there are: the Recent Episodes strap
// and the About table's counts. Returned as {id, text} edits, applied by the browser.
export function refreshEdits(page, feed, { listed, when = new Date() } = {}) {
  const edits = []
  const stamp = when.toISOString().slice(0, 10)
  for (const it of page.story || []) {
    if (it.type === 'markdown' && /^#\s*Recent Episodes/m.test(it.text || '')) {
      edits.push({ id: it.id, text: `# Recent Episodes\n> The newest ${listed} of ${feed.episodes.length}, playing straight from the feed. Updated ${stamp}.` })
    } else if (it.type === 'table' && /\|\s*Episodes in feed\s*\|/.test(it.text || '')) {
      const text = it.text
        .replace(/(\|\s*Episodes in feed\s*\|)[^|\n]*\|/, `$1 ${feed.episodes.length} |`)
        .replace(/(\|\s*Newest episode\s*\|)[^|\n]*\|/, `$1 ${day(feed.episodes[0]?.published)} |`)
      if (text !== it.text) edits.push({ id: it.id, text })
    }
  }
  return edits
}

// The audio items to add for the episodes taken, newest first.
export async function itemsFor(episodes, { fetch } = {}) {
  const urls = await httpsAudio(episodes.map(e => e.audio.url), { fetch })
  return episodes.map(ep => audio(urls.get(ep.audio.url), episodeCaption(ep)))
}

// A page's file in a site directory. Slugs are the wiki's own shape, nothing else.
export const SLUG = /^[a-z0-9][a-z0-9-]*$/
export function readPage(siteDir, slug) {
  if (!SLUG.test(slug)) throw Object.assign(new Error('that is not a page slug'), { status: 400 })
  const file = join(siteDir, 'pages', slug)
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8'))
}

// Copy the page file into assets/<slug>/backups/<slug>-<stamp>.json, so the
// backup travels with the page and shows in its assets. Returns the asset path.
export function backupPage(siteDir, slug, { when = new Date() } = {}) {
  if (!SLUG.test(slug)) throw Object.assign(new Error('that is not a page slug'), { status: 400 })
  const file = join(siteDir, 'pages', slug)
  const dir = join(siteDir, 'assets', slug, 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = when.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  let name = `${slug}-${stamp}.json`
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${slug}-${stamp}-${n}.json`  // two in one second
  writeFileSync(join(dir, name), readFileSync(file))
  return `assets/${slug}/backups/${name}`
}
