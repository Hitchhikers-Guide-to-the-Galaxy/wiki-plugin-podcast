// handlers.js — the Podcast plugin's operations, mounted by the Farm plugin
// (node) or natively by sweet-server, beneath /system/api/podcast/.
// CommonJS (see sibling package.json); the work is done by the ESM modules in
// src/core, loaded with import().
//
//   find     — a link or title -> the open feed + a podcast summary
//   page     — a feed (and maybe an episode) -> page JSON for a ghost page
//   update   — a podcast page on the origin site -> backup + the episodes it lacks
//   search   — a feed and a term -> matching episodes
//   podcasts — a term -> a page of podcasts to import
//
// All are declared as writes in openapi.json: they reach the public internet
// and spend the ListenNotes quota, so only a private site's signed-in owner
// may call them, and the farm's MCP agent door never offers them. Update also
// declares the origin and farmRoot context: it reads the page from the site's
// own disk and writes the backup beside it, and only there.

const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const problem = (status, message) => Object.assign(new Error(message), { status })
const log = (...a) => console.log('[podcast]', ...a)
const core = rel => import(pathToFileURL(path.join(__dirname, '..', 'src', 'core', rel)).href)

// A person looks up a few podcasts a minute; this stops a runaway loop.
let stamps = []
const pace = () => {
  const now = Date.now()
  stamps = stamps.filter(t => now - t < 60000)
  if (stamps.length >= 30) throw problem(429, 'Too many podcast lookups in a minute. Wait a moment.')
  stamps.push(now)
}

const text = (v, max, what) => {
  const s = String(v ?? '').trim()
  if (s.length > max) throw problem(400, `${what} is too long.`)
  return s
}

const find = async args => {
  pace()
  const input = text(args.input, 2000, 'The link or title')
  if (!input) throw problem(400, 'Paste a podcast link, or type a title.')
  const title = text(args.title, 200, 'The title') || undefined
  const [{ find }, { key }] = await Promise.all([core('service.js'), core('keys.js')])
  const r = await find({ input, title }, { apiKey: await key('listennotes') })
  log(`find ${input.slice(0, 80)}: ${r.ok ? r.found.route + ' ' + r.found.feedUrl : r.found.error}`)
  return r
}

const page = async args => {
  pace()
  const feedUrl = text(args.feedUrl, 2000, 'The feed')
  if (!/^https?:\/\//i.test(feedUrl)) throw problem(400, 'That is not a feed link.')
  const episode = text(args.episode, 2000, 'The episode') || undefined
  const { page } = await core('service.js')
  const r = await page({ feedUrl, episode, found: args.found, recent: args.recent })
  log(`page ${feedUrl}${episode ? ' episode ' + episode.slice(0, 60) : ''}: ${r.ok ? r.page.title : r.error}`)
  if (!r.ok) throw problem(404, r.error)
  return r
}

// The origin site's directory under the farm root, as the farm supplied them.
// Both come from the farm, never the caller; the checks are against drift
// between farms (a port suffix, a single-site root), not against people.
const siteDirOf = ({ origin, farmRoot }) => {
  if (!origin || !farmRoot) throw problem(500, 'the farm did not say which site this is')
  const names = [String(origin), String(origin).replace(/:\d+$/, '')]
  for (const n of names) {
    const dir = path.join(farmRoot, n)
    if (path.dirname(dir) === path.resolve(farmRoot) && fs.existsSync(path.join(dir, 'pages'))) return dir
  }
  if (names.includes(path.basename(farmRoot)) && fs.existsSync(path.join(farmRoot, 'pages'))) return farmRoot
  throw problem(500, `no site directory for ${origin} under the farm root`)
}

const update = async args => {
  pace()
  const slug = text(args.slug, 200, 'The page slug')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw problem(400, 'That is not a page slug.')
  const feedUrl = text(args.feedUrl, 2000, 'The feed')
  if (!/^https?:\/\//i.test(feedUrl)) throw problem(400, 'That is not a feed link.')
  const siteDir = siteDirOf(args)
  const { update } = await core('service.js')
  const r = await update({ siteDir, slug, feedUrl, recent: args.recent })
  log(`update ${args.origin}/${slug} from ${feedUrl}: ${r.ok ? `${r.added.length} new of ${r.feed.missing} missing${r.backup ? ', backup ' + r.backup : ''}` : r.error}`)
  if (!r.ok) throw problem(404, r.error)
  return r
}

const search = async args => {
  pace()
  const feedUrl = text(args.feedUrl, 2000, 'The feed')
  if (!/^https?:\/\//i.test(feedUrl)) throw problem(400, 'That is not a feed link.')
  const q = text(args.q, 200, 'The search')
  if (!q) throw problem(400, 'Type a word or two to search for.')
  const listennotesId = text(args.listennotesId, 64, 'The ListenNotes id') || undefined
  const [{ search }, { key }] = await Promise.all([core('service.js'), core('keys.js')])
  const r = await search({ feedUrl, q, listennotesId, limit: args.limit }, { apiKey: await key('listennotes') })
  log(`search "${q}" in ${feedUrl}: ${r.hits.length} hits (${r.source})`)
  return r
}

const podcasts = async args => {
  pace()
  const q = text(args.q, 200, 'The search')
  if (!q) throw problem(400, 'Type a podcast title or a word or two to search for.')
  const [{ podcasts }, { key }] = await Promise.all([core('service.js'), core('keys.js')])
  const r = await podcasts({ q, limit: args.limit }, { apiKey: await key('listennotes') })
  log(`podcasts "${q}": ${r.candidates.length} candidates (${r.sources.join(', ')})`)
  return r
}

module.exports = { find, page, update, search, podcasts }
