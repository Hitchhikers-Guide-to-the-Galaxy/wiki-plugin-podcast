// Offline tests: feed parsing and page building, on saved feeds.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseFeed, findEpisode } from '../src/core/feed.js'
import { podcastPage, episodePage, cleanAudio, cleanImage } from '../src/core/page.js'
import { htmlToParagraphs, parseDuration, minutes } from '../src/core/text.js'
import { asSlug } from '../src/core/pagejson.js'

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const noFetch = async () => { throw new Error('no network in unit tests') }
const okFetch = async () => ({ ok: true })
// Signs of text decoded twice (the old LiveCode pages showed ‚Äô for ’).
const GARBLED = /â€|‚Ä|Ã[\u0080-¿]|Â /
const allText = page => JSON.stringify(page.story)

test('parses the BBC feed', () => {
  const f = parseFeed(fixture('start-the-week.rss'), { url: 'https://podcasts.files.bbci.co.uk/b006r9xr.rss' })
  assert.equal(f.title, 'Start the Week')
  assert.equal(f.author, 'BBC Radio 4')
  assert.equal(f.website, 'http://www.bbc.co.uk/programmes/b006r9xr')
  assert.deepEqual(f.categories, ['Society & Culture'])
  assert.equal(f.episodes.length, 3)
  const e = f.episodes[0]
  assert.equal(e.title, 'Napoleon’s marshals and President Trump’s civil servants')
  assert.equal(e.guid, 'urn:bbc:podcast:m00331n6')
  assert.equal(e.duration, 2545)
  assert.match(e.audio.url, /p0phg723\.mp3$/)
})

test('parses the tricky feed: entities, CDATA, nested categories, content:encoded', () => {
  const f = parseFeed(fixture('tricky.rss'))
  assert.equal(f.title, 'Café & Société — “Talks”')
  assert.equal(f.author, 'Zoë Ångström')
  assert.deepEqual(f.categories, ['Society & Culture', 'Philosophy'])
  assert.equal(f.episodes.length, 2, 'the item without audio is dropped')
  assert.equal(f.episodes[0].title, 'Épisode 2: “Naïve” questions')
  assert.equal(f.episodes[0].duration, 3723)
  assert.match(f.episodes[0].notes, /<strong>naïve<\/strong>/, 'content:encoded wins over description')
  assert.equal(findEpisode(f, { guid: 'ep-1' }).title, 'Episode 1')
})

test('show notes become wiki paragraphs with wiki links and lists', () => {
  const ps = htmlToParagraphs('<p>We ask <strong>naïve</strong> questions.</p><ul><li>One</li><li>Two &amp; three</li></ul><p>More at <a href="https://example.org/ep2">the episode page</a>.</p>')
  assert.deepEqual(ps, ['We ask **naïve** questions.', '- One\n- Two & three', 'More at [https://example.org/ep2 the episode page].'])
  assert.deepEqual(htmlToParagraphs('Plain one.\n\nPlain two.'), ['Plain one.', 'Plain two.'])
  assert.equal(parseDuration('1:02:03'), 3723)
  assert.equal(minutes(2545), '42 min')
  assert.equal(minutes(3723), '1 h 02 min')
})

test('BBC audio and artwork are cleaned to https', () => {
  assert.equal(cleanAudio('http://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download-rss/proto/http/vpid/p0phg723.mp3'),
    'https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download/proto/https/vpid/p0phg723.mp3')
  assert.equal(cleanAudio('https://cdn.example.org/a.mp3'), 'https://cdn.example.org/a.mp3')
  assert.equal(cleanImage('http://ichef.bbci.co.uk/images/ic/3000x3000/p0m1x9q3.jpg'), 'https://ichef.bbci.co.uk/images/ic/640x640/p0m1x9q3.jpg')
})

test('podcast page: opener with feed link, artwork, recent episodes, about table', async () => {
  const f = parseFeed(fixture('start-the-week.rss'), { url: 'https://podcasts.files.bbci.co.uk/b006r9xr.rss' })
  const p = await podcastPage(f, { found: { route: 'bbc', feedUrl: f.url }, fetch: noFetch })
  assert.equal(p.title, 'Start the Week')
  assert.deepEqual(p.story.map(i => i.type), ['markdown', 'image', 'markdown', 'podcast', 'audio', 'audio', 'audio', 'markdown', 'table'])
  assert.equal(p.story[3].text, 'FEED https://podcasts.files.bbci.co.uk/b006r9xr.rss\nTITLE Start the Week', 'the page carries its own Update Recent and search item')
  assert.match(p.story[0].text, /^Weekly discussion programme, setting the cultural agenda every Monday\. \[https:\/\/podcasts\.files\.bbci\.co\.uk\/b006r9xr\.rss rss\]/)
  for (const a of p.story.filter(i => i.type === 'audio')) assert.match(a.text, /^https:\/\/open\.live\.bbc\.co\.uk\/.*\/audio-nondrm-download\/proto\/https\//)
  assert.match(p.story.at(-1).text, /\| Found by \| feed finder, bbc route \|/)
  assert.ok(p.story.every(i => /^[0-9a-f]{16}$/.test(i.id)))
  assert.equal(new Set(p.story.map(i => i.id)).size, p.story.length)
  assert.equal(p.journal.length, 1)
  assert.equal(p.journal[0].type, 'create')
  assert.deepEqual(p.journal[0].item.story, p.story)
  assert.doesNotMatch(allText(p), GARBLED)
})

test('episode page: notes, audio, link back to the podcast, no garbling', async () => {
  const f = parseFeed(fixture('tricky.rss'), { url: 'https://example.org/feed.xml' })
  const p = await episodePage(f, f.episodes[0], { fetch: okFetch })
  assert.equal(p.title, 'Épisode 2: “Naïve” questions')
  assert.equal(asSlug(p.title), 'pisode-2-nave-questions')
  assert.match(p.story[0].text, /^We ask \*\*naïve\*\* questions\. From \[\[Café & Société — “Talks”\]\]\.$/)
  assert.match(p.story[1].text, /^https:\/\/cdn\.example\.org\/ep2\.mp3\n/, 'http audio upgraded when https answers')
  assert.ok(p.story.some(i => i.text === '- One\n- Two & three'))
  assert.match(p.story.at(-1).text, /\| Length \| 1 h 02 min \|/)
  assert.doesNotMatch(allText(p), GARBLED)
})
