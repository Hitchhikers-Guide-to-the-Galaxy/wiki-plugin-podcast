// The item's text DSL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/client/podcast.js'

test('item text: first line prefills, TITLE and RECENT are commands', () => {
  const base = { input: '', title: undefined, recent: undefined, feed: undefined, import: undefined, itunes: undefined, listennotes: undefined, mode: 'find' }
  assert.deepEqual(parse(''), base)
  assert.deepEqual(parse('https://www.bbc.co.uk/sounds/brand/b006r9xr\nRECENT 5'), { ...base, input: 'https://www.bbc.co.uk/sounds/brand/b006r9xr', recent: 5 })
  assert.deepEqual(parse('TITLE: Leading\nhttp://therestispolitics.com/'), { ...base, input: 'http://therestispolitics.com/', title: 'Leading' })
})

test('item text: FEED and IMPORT pick the mode, ids ride along', () => {
  const f = parse('FEED https://podcasts.files.bbci.co.uk/b006r9xr.rss\nTITLE Start the Week\nLISTENNOTES abc123')
  assert.equal(f.mode, 'feed'); assert.equal(f.feed, 'https://podcasts.files.bbci.co.uk/b006r9xr.rss'); assert.equal(f.listennotes, 'abc123')
  const i = parse('IMPORT https://feeds.megaphone.fm/GLT9190936013\nTITLE The Rest Is Politics\nITUNES 1611374685')
  assert.equal(i.mode, 'import'); assert.equal(i.import, 'https://feeds.megaphone.fm/GLT9190936013'); assert.equal(i.itunes, '1611374685')
})
