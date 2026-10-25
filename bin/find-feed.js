#!/usr/bin/env node
// find-feed <link or title> [--title "Podcast title"] [--json]
// Prints the open RSS feed for a podcast link, and how it was found.
import { findFeed } from '../src/core/feedfinder.js'
import { listenNotesKey } from '../src/core/keys.js'

const args = process.argv.slice(2)
const json = args.includes('--json')
const ti = args.indexOf('--title')
const title = ti >= 0 ? args[ti + 1] : undefined
const input = args.filter((a, i) => a !== '--json' && (ti < 0 || (i !== ti && i !== ti + 1))).join(' ')
if (!input) {
  console.error('usage: find-feed <link or title> [--title "Podcast title"] [--json]')
  process.exit(2)
}
const r = await findFeed(input, { title, apiKey: await listenNotesKey() })
if (json) console.log(JSON.stringify(r, null, 2))
else {
  for (const s of r.steps) console.log('  ·', s)
  if (r.ok) {
    console.log(`${r.route}: ${r.feedUrl}${r.finalUrl ? `  (now ${r.finalUrl})` : ''}`)
    console.log(`  "${r.feedTitle}", ${r.episodes} episodes${r.episode ? `; episode "${r.episode.title}"` : ''}`)
  } else console.log(`no feed (${r.route}): ${r.error}`)
  if (r.usage?.used) console.log(`  ListenNotes: ${r.usage.used} of ${r.usage.quota} used this month`)
}
process.exit(r.ok ? 0 : 1)
