// The item's text DSL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/client/podcast.js'

test('item text: first line prefills, TITLE and RECENT are commands', () => {
  assert.deepEqual(parse(''), { input: '', title: undefined, recent: undefined })
  assert.deepEqual(parse('https://www.bbc.co.uk/sounds/brand/b006r9xr\nRECENT 5'), { input: 'https://www.bbc.co.uk/sounds/brand/b006r9xr', title: undefined, recent: 5 })
  assert.deepEqual(parse('TITLE: Leading\nhttp://therestispolitics.com/'), { input: 'http://therestispolitics.com/', title: 'Leading', recent: undefined })
})
