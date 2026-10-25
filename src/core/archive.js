// Keep a copy of an episode's audio in its page's assets folder, recording
// where it came from in wiki-plugin-anarchive's sidecar (_anarchive.json), so
// the copy travels with the folder when the page is forked and says what it is.
//
// Only audio David cites or clips is archived (his answer on the plan), one
// episode at a time, from the page's own button. The download goes through the
// public-only fetch guard, stops at a size cap, and refuses when the disk is
// nearly full: the Pi5's card holds every wiki.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const SIDECAR = '_anarchive.json'
export const MAX_BYTES = 400 * 1024 * 1024   // a long episode at high bitrate
export const MIN_FREE = 1024 * 1024 * 1024   // leave at least 1 GB on the disk

const EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav' }

// lowercase-hyphen, ASCII only, no colons (the Pi5's media disk is exFAT), short.
export function fileName(title, type, url) {
  const base = String(title || 'episode').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'episode'
  const fromType = EXT[String(type || '').split(';')[0].trim().toLowerCase()]
  const fromUrl = (String(url || '').match(/\.(mp3|m4a|aac|ogg|opus|wav)(\?|$)/i) || [])[1]
  return `${base}.${(fromType || fromUrl || 'mp3').toLowerCase()}`
}

const readSidecar = dir => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir, SIDECAR), 'utf8'))
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {}
  } catch { return {} }
}
const writeSidecar = (dir, data) => {
  const target = path.join(dir, SIDECAR), tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, target)
}

const freeBytes = dir => {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize } catch { return Infinity }
}

// Where the bytes go. By default the page's own assets folder. With
// PODCAST_ARCHIVE_ROOT set (on the Pi5: a folder on the X9 drive, outside the
// public farm's tree so nothing publishes it), the audio is stored at
// <root>/<site>/<slug>/<file> and the page's assets folder holds a symlink to
// it, so the page still names it /assets/<slug>/<file>. The sidecar always
// stays in the page's assets folder, beside the name the page uses.
export const archiveRoot = () => (process.env.PODCAST_ARCHIVE_ROOT || '').trim() || null

// Download `url` for `<siteDir>/assets/<slug>/` and record it.
// meta: { title, caption, licence, from, feed, guid, link, by }
// Returns { file, url (site-relative), size, sha256, existed, stored }.
export async function archiveAudio({ siteDir, slug, url, meta = {}, fetch, root = archiveRoot() }) {
  const dir = path.join(siteDir, 'assets', slug)
  fs.mkdirSync(dir, { recursive: true })
  const store = root ? path.join(root, path.basename(siteDir), slug) : dir
  fs.mkdirSync(store, { recursive: true })
  if (freeBytes(store) < MIN_FREE) throw Object.assign(new Error(`${store} has less than 1 GB free; not archiving`), { status: 507 })

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wiki-plugin-podcast; +https://fed.wiki.org)' } })
  if (!res.ok) throw Object.assign(new Error(`the audio answered HTTP ${res.status}`), { status: 502 })
  const type = res.headers.get('content-type') || ''
  if (!/^audio\/|^application\/octet-stream/i.test(type)) throw Object.assign(new Error(`that is not audio (${type || 'no type'})`), { status: 415 })
  const declared = +res.headers.get('content-length') || 0
  if (declared > MAX_BYTES) throw Object.assign(new Error(`the audio is ${Math.round(declared / 1e6)} MB, over the ${MAX_BYTES / 1e6} MB cap`), { status: 413 })

  const name = fileName(meta.title, type, res.url || url)
  const final = path.join(store, name)
  const part = `${final}.part`
  const hash = createHash('sha256')
  let size = 0
  const out = fs.createWriteStream(part)
  try {
    for await (const chunk of res.body) {
      size += chunk.length
      if (size > MAX_BYTES) throw Object.assign(new Error(`the audio passed the ${MAX_BYTES / 1e6} MB cap`), { status: 413 })
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r))
    }
    await new Promise((resolve, reject) => out.end(err => err ? reject(err) : resolve()))
  } catch (e) {
    out.destroy(); fs.rmSync(part, { force: true }); throw e
  }
  const sha256 = hash.digest('hex')
  const existed = fs.existsSync(final)
  fs.renameSync(part, final)
  if (store !== dir) {
    // The page's name for it: a symlink in its assets folder (on the SD card) to the copy on the archive drive.
    const link = path.join(dir, name)
    fs.rmSync(link, { force: true })
    fs.symlinkSync(final, link)
  }

  // The anarchive sidecar entry: its own fields first, then the podcast's.
  const data = readSidecar(dir)
  data[name] = {
    ...(data[name] || {}),
    sha256, size, added: Date.now(), by: meta.by || null,
    from: meta.from || url,
    caption: meta.caption || '',
    licence: meta.licence || '',
    pin: null,
    podcast: { feed: meta.feed || null, guid: meta.guid || null, link: meta.link || null, fetched: res.url || url, type, stored: final, archivedBy: 'wiki-plugin-podcast' },
  }
  writeSidecar(dir, data)
  return { file: name, url: `/assets/${slug}/${name}`, size, sha256, existed, stored: final }
}
