// Live test: every route, on the eight podcasts of the old Podcast Index
// (podcast.anarchive.earth). Uses the network and ~12 ListenNotes requests.
// Writes test/results.json, which the Feed Finder Demo page is built from.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { findFeed } from '../src/core/feedfinder.js'
import { listenNotesKey } from '../src/core/keys.js'

const podcasts = JSON.parse(readFileSync(new URL('./podcasts.json', import.meta.url)))
const apiKey = await listenNotesKey()
const results = []

const inputsFor = p => [
  { how: 'ListenNotes link', input: `https://www.listennotes.com/c/${p.listennotesId}/` },
  { how: 'website + title', input: p.website, title: p.title },
  { how: 'title only', input: p.title },
  { how: 'old feed URL', input: p.oldRss },
  ...p.extra.map(input => ({ how: 'extra link', input })),
]

for (const p of podcasts) {
  for (const c of inputsFor(p)) {
    test(`${p.title} — ${c.how}: ${c.input}`, async () => {
      const r = await findFeed(c.input, { title: c.title, apiKey })
      // Right = the same feed the ListenNotes id leads to (redirects allowed).
      const right = r.ok && isExpected(r, p)
      const offered = !right && r.ambiguous && (r.candidates || []).some(x => isExpected({ feedUrl: x.feedUrl }, p))
      const verdict = right ? 'right' : offered ? 'ambiguous' : r.ok ? 'WRONG' : 'FAILED'
      results.push({ podcast: p.title, slug: p.slug, how: c.how, input: c.input, verdict, ok: r.ok, route: r.route,
        feedUrl: r.feedUrl, finalUrl: r.finalUrl, movedFrom: r.movedFrom, feedTitle: r.feedTitle, episodes: r.episodes,
        latest: r.latest, episode: r.episode, sameAsOld: r.ok ? sameFeed(r.feedUrl, p.oldRss) : null,
        candidates: r.ambiguous ? r.candidates : undefined, error: r.error, steps: r.steps })
      assert.ok(r.ok, `no feed: ${r.error}\n  ${r.steps.join('\n  ')}`)
      assert.ok(right || offered, `found "${r.feedTitle}" ${r.feedUrl}, wanted ${p.feed}\n  ${r.steps.join('\n  ')}`)
    })
  }
}

const norm = u => (u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
function sameFeed(a, b) { return norm(a) === norm(b) }
function isExpected(r, p) {
  const want = [p.feed, p.feedFinal].filter(Boolean).map(norm)
  return [r.feedUrl, r.finalUrl].filter(Boolean).map(norm).some(u => want.includes(u))
}

after(() => writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2)))
