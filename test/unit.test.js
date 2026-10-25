// Offline tests: link shapes and title matching.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, titleScore } from '../src/core/feedfinder.js'

test('classify picks a route from the link shape', () => {
  const cases = {
    'https://feeds.megaphone.fm/GLT9190936013': 'rss',
    'https://lexfridman.com/feed/podcast/': 'rss',
    'https://podcasts.files.bbci.co.uk/b006r9xr.rss': 'rss',
    'https://www.bbc.co.uk/programmes/b006r9xr': 'bbc',
    'https://www.bbc.co.uk/sounds/play/m00331n6': 'bbc',
    'https://podcasts.apple.com/gb/podcast/the-rest-is-politics/id1611374685': 'apple',
    'https://www.listennotes.com/c/462763fd25314c158e469fb089686ede/': 'listennotes',
    'https://play.acast.com/s/theeconomistbabbage/babbage-ledtime-1': 'page',
    'https://freakonomics.com': 'page',
    'Planet Critical': 'search',
    '': 'empty',
  }
  for (const [input, want] of Object.entries(cases)) assert.equal(classify(input), want, input)
})

test('titleScore prefers the right podcast', () => {
  assert.ok(titleScore('Planet: Critical', 'Planet: Critical') > 0.9)
  assert.ok(titleScore('Freakonomics Radio', 'Freakonomics Radio') > titleScore('Freakonomics Radio', 'No Stupid Questions'))
  assert.ok(titleScore('The Rest Is Politics', 'The Rest Is Politics: Leading') < titleScore('The Rest Is Politics', 'The Rest Is Politics'))
  assert.ok(titleScore('Leading', 'The Rest Is Politics: Leading') >= 0.6)
  assert.equal(titleScore('', 'anything'), 0)
})
