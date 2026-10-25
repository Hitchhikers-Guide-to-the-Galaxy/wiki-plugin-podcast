#!/usr/bin/env node
// feed-to-page <link or title> [--title "hint"] [--episode latest|N|guid] [--recent 10] [--out DIR]
// Finds the feed, builds the podcast page (and an episode page when the link
// names an episode, or --episode says which), and writes page JSON into
// DIR/pages/<slug>, or prints a summary when there is no --out.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findFeed } from '../src/core/feedfinder.js'
import { fetchFeed, findEpisode } from '../src/core/feed.js'
import { podcastPage, episodePage } from '../src/core/page.js'
import { asSlug } from '../src/core/pagejson.js'
import { listenNotesKey } from '../src/core/keys.js'

const argv = process.argv.slice(2)
const opt = name => { const i = argv.indexOf(`--${name}`); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v }
const title = opt('title'), which = opt('episode'), recent = +(opt('recent') || 10), out = opt('out')
const input = argv.join(' ')
if (!input) { console.error('usage: feed-to-page <link or title> [--title hint] [--episode latest|N|guid] [--recent 10] [--out DIR]'); process.exit(2) }

const found = await findFeed(input, { title, apiKey: await listenNotesKey() })
if (!found.ok) { console.error(`no feed: ${found.error}`); process.exit(1) }
if (found.ambiguous) console.error(`note: "${input}" is ambiguous; using ${found.feedTitle}. Others: ${found.candidates.map(c => c.title).join('; ')}`)
const feed = await fetchFeed(found.feedUrl)

const pages = [await podcastPage(feed, { found, recent })]
let ep
if (which === 'latest') ep = feed.episodes[0]
else if (/^\d+$/.test(which || '')) ep = feed.episodes[+which - 1]
else if (which) ep = findEpisode(feed, { guid: which, title: which })
else if (found.episode) ep = findEpisode(feed, found.episode)
if ((which || found.episode) && !ep) console.error('note: could not find that episode in the feed')
if (ep) pages.push(await episodePage(feed, ep, { found }))

for (const p of pages) {
  const slug = asSlug(p.title)
  if (out) {
    mkdirSync(join(out, 'pages'), { recursive: true })
    writeFileSync(join(out, 'pages', slug), JSON.stringify(p, null, 2))
  }
  console.log(`${out ? 'wrote' : 'built'} ${slug}: "${p.title}", ${p.story.length} items (${[...new Set(p.story.map(i => i.type))].join(', ')})`)
}
