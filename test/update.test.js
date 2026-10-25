// Offline tests: Update Recent, search inside a podcast, and the candidates page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseFeed } from '../src/core/feed.js'
import { podcastPage, candidatesPage } from '../src/core/page.js'
import { newEpisodes, anchorFor, refreshEdits, itemsFor, audioOnPage, backupPage, readPage } from '../src/core/update.js'
import { searchFeed, snippet } from '../src/core/search.js'

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const noFetch = async () => { throw new Error('no network in unit tests') }
const feed = () => parseFeed(fixture('start-the-week.rss'), { url: 'https://podcasts.files.bbci.co.uk/b006r9xr.rss' })

test('update: a page that lacks the newest episodes gets exactly those, newest first', async () => {
  const f = feed()
  const page = await podcastPage(f, { found: { route: 'bbc', feedUrl: f.url }, fetch: noFetch })
  assert.deepEqual(newEpisodes(page, f).missing, [], 'a fresh page lacks nothing')
  // Take the two newest audio items off the page: the "before" state.
  const audios = page.story.filter(i => i.type === 'audio')
  page.story = page.story.filter(i => i !== audios[0] && i !== audios[1])
  assert.equal(audioOnPage(page).size, 1)
  const { missing, take } = newEpisodes(page, f)
  assert.deepEqual(missing.map(e => e.title), f.episodes.slice(0, 2).map(e => e.title))
  assert.equal(take.length, 2)
  assert.equal(newEpisodes(page, f, { recent: 1 }).take.length, 1, 'recent caps one update')
  // Older episodes a page never listed are not "new": the walk stops at the first one on the page.
  const older = { ...f, episodes: [...f.episodes, { title: 'Ancient', audio: { url: 'https://x/old.mp3' }, published: '2001-01-01T00:00:00.000Z' }] }
  assert.deepEqual(newEpisodes(page, older).missing.map(e => e.title), f.episodes.slice(0, 2).map(e => e.title))
  // The page's own podcast item is where they go.
  assert.equal(anchorFor(page), page.story.find(i => i.type === 'podcast').id)
  // Items to add, same shape as the page's audio items; http feed audio cleaned to https.
  const items = await itemsFor(take, { fetch: noFetch })
  assert.equal(items.length, 2)
  for (const it of items) { assert.equal(it.type, 'audio'); assert.match(it.text, /^https:\/\/open\.live\.bbc\.co\.uk\/.*audio-nondrm-download\/proto\/https\//) }
  assert.match(items[0].text, /Napoleon’s marshals/)
  // The count lines: the strap always, the About table when its counts changed.
  assert.equal(refreshEdits(page, f, { listed: 3 }).length, 1, 'same feed, same table')
  const edits = refreshEdits(page, older, { listed: 3, when: new Date('2026-10-25T12:00:00Z') })
  assert.equal(edits.length, 2)
  assert.equal(edits[0].text, '# Recent Episodes\n> The newest 3 of 4, playing straight from the feed. Updated 2026-10-25.')
  assert.match(edits[1].text, /\| Episodes in feed \| 4 \|/)
  assert.match(edits[1].text, /\| Newest episode \| 19 Oct 2026 \|/)
})

test('update: a page with no audio at all gets the newest episodes', () => {
  const f = feed()
  const page = { story: [{ type: 'markdown', id: 'a', text: 'x' }, { type: 'markdown', id: 'b', text: '# Recent Episodes' }] }
  assert.equal(newEpisodes(page, f).take.length, 3)
  assert.equal(anchorFor(page), 'b', 'after the heading when the page has no podcast item')
  assert.deepEqual(refreshEdits(page, f, { listed: 3 }).map(e => e.id), ['b'])
})

test('update: the page is copied into its assets folder before anything changes', () => {
  const site = mkdtempSync(join(tmpdir(), 'podcast-site-'))
  mkdirSync(join(site, 'pages'))
  writeFileSync(join(site, 'pages', 'start-the-week'), JSON.stringify({ title: 'Start the Week', story: [], journal: [] }))
  const rel = backupPage(site, 'start-the-week', { when: new Date('2026-10-25T12:34:56Z') })
  assert.equal(rel, 'assets/start-the-week/backups/start-the-week-2026-10-25T12-34-56.json')
  assert.deepEqual(readdirSync(join(site, 'assets', 'start-the-week', 'backups')), ['start-the-week-2026-10-25T12-34-56.json'])
  assert.deepEqual(JSON.parse(readFileSync(join(site, rel), 'utf8')), readPage(site, 'start-the-week'))
  assert.equal(readPage(site, 'no-such-page'), null)
  assert.throws(() => readPage(site, '../etc/passwd'), /not a page slug/)
  assert.throws(() => backupPage(site, 'Start the Week'), /not a page slug/)
})

test('search: title hits rank above notes hits, newest first among equals', () => {
  const f = feed()
  const hits = searchFeed(f, 'Napoleon')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].where, 'title')
  assert.equal(hits[0].key, 'urn:bbc:podcast:m00331n6')
  const notes = searchFeed(f, 'weekly discussion')
  assert.equal(notes.length, 3, 'every episode says it in the notes')
  assert.equal(notes[0].where, 'notes')
  assert.equal(notes[0].title, f.episodes[0].title, 'newest first among equals')
  assert.ok(notes[0].snippet.toLowerCase().includes('weekly discussion'))
  assert.equal(searchFeed(f, 'Ronson unravelling')[0].where, 'title')
  assert.deepEqual(searchFeed(f, ''), [])
  assert.deepEqual(searchFeed(f, 'zzzz no such word'), [])
  assert.equal(snippet('one two three four five', ['four'], 12).includes('four'), true)
})

test('candidates page: one card and one import item per podcast, then a table', () => {
  const page = candidatesPage('Planet Critical', [
    { title: 'Planet: Critical', author: 'Rachel Donald', feedUrl: 'https://feeds.example.org/pc', itunesId: '1', count: 200, latest: '2026-10-20T00:00:00Z', genre: 'Science', score: 1 },
    { title: 'Critical Planet', feedUrl: 'https://feeds.example.org/cp', score: 0.8 },
  ], { when: new Date('2026-10-25T12:00:00Z') })
  assert.equal(page.title, 'Podcasts: Planet Critical')
  assert.deepEqual(page.story.map(i => i.type), ['markdown', 'markdown', 'podcast', 'markdown', 'podcast', 'markdown', 'table'])
  assert.match(page.story[0].text, /^2 podcasts match “Planet Critical” in Apple Podcasts, searched 2026-10-25\./)
  assert.match(page.story[1].text, /^\*\*Planet: Critical\*\* — by Rachel Donald, 200 episodes, newest 20 Oct 2026, Science\. \[https:\/\/podcasts\.apple\.com\/podcast\/id1 apple\] \[https:\/\/feeds\.example\.org\/pc rss\]$/)
  assert.equal(page.story[2].text, 'IMPORT https://feeds.example.org/pc\nTITLE Planet: Critical\nITUNES 1')
  assert.equal(page.story[4].text, 'IMPORT https://feeds.example.org/cp\nTITLE Critical Planet')
  assert.match(page.story[6].text, /\| Planet: Critical \| Rachel Donald \| 200 \| 20 Oct 2026 \| Science \| 1\.00 \|/)
  assert.equal(page.journal[0].type, 'create')
  const none = candidatesPage('zzz', [])
  assert.match(none.story[0].text, /^No podcast matches “zzz”/)
  assert.equal(none.story.length, 1)
})
