// handlers.js — the Podcast plugin's operations, mounted by the Farm plugin
// (node) or natively by sweet-server, beneath /system/api/podcast/.
// CommonJS (see sibling package.json); the work is done by the ESM modules in
// src/core, loaded with import().
//
//   find — a link or title -> the open feed + a podcast summary
//   page — a feed (and maybe an episode) -> page JSON for a ghost page
//
// Both are declared as writes in openapi.json: they reach the public internet
// and spend the ListenNotes quota, so only a private site's signed-in owner
// may call them, and the farm's MCP agent door never offers them.

const path = require('node:path')
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
  const [{ find }, { listenNotesKey }] = await Promise.all([core('service.js'), core('keys.js')])
  const r = await find({ input, title }, { apiKey: await listenNotesKey() })
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

module.exports = { find, page }
