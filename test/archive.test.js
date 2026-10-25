// Archiving: the copy, the anarchive sidecar, the symlink onto an archive drive. No network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { archiveAudio, fileName, SIDECAR } from '../src/core/archive.js'

const bytes = Buffer.from('ID3 fake mp3 bytes '.repeat(1000))
const fakeFetch = (type = 'audio/mpeg') => async url => new Response(bytes, { status: 200, headers: { 'content-type': type, 'content-length': String(bytes.length) } })
const site = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'podcast-site-')); fs.mkdirSync(path.join(d, 'pages')); return d }

test('file names are ascii, hyphenated, colon-free, with the right extension', () => {
  assert.equal(fileName('Napoleon’s marshals: and President Trump’s civil servants', 'audio/mpeg'), 'napoleon-s-marshals-and-president-trump-s-civil-servants.mp3')
  assert.equal(fileName('Épisode 2', 'audio/x-m4a'), 'episode-2.m4a')
  assert.equal(fileName('', 'application/octet-stream', 'https://x/a.ogg?t=1'), 'episode.ogg')
})

test('archives into the page assets folder with an anarchive sidecar entry', async () => {
  const dir = site()
  const r = await archiveAudio({ siteDir: dir, slug: 'ep', url: 'https://cdn.example.org/ep.mp3', fetch: fakeFetch(), root: null,
    meta: { title: 'Ep One', caption: 'Ep One — Show', licence: '(C) Show', from: 'http://cdn.example.org/ep.mp3', feed: 'https://x/feed', guid: 'g1' } })
  assert.equal(r.url, '/assets/ep/ep-one.mp3')
  assert.equal(r.size, bytes.length)
  assert.equal(r.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(fs.readFileSync(path.join(dir, 'assets/ep/ep-one.mp3')), bytes)
  const side = JSON.parse(fs.readFileSync(path.join(dir, 'assets/ep', SIDECAR)))
  const e = side['ep-one.mp3']
  assert.equal(e.sha256, r.sha256); assert.equal(e.from, 'http://cdn.example.org/ep.mp3'); assert.equal(e.licence, '(C) Show')
  assert.equal(e.podcast.guid, 'g1'); assert.equal(e.pin, null)
  assert.ok(!fs.existsSync(path.join(dir, 'assets/ep/ep-one.mp3.part')))
})

test('with an archive root, the bytes go there and the page folder holds a symlink', async () => {
  const dir = site(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'podcast-archive-'))
  const r = await archiveAudio({ siteDir: dir, slug: 'ep', url: 'https://cdn.example.org/ep.mp3', fetch: fakeFetch(), root, meta: { title: 'Ep One' } })
  const link = path.join(dir, 'assets/ep/ep-one.mp3')
  assert.ok(fs.lstatSync(link).isSymbolicLink())
  assert.equal(fs.readlinkSync(link), path.join(root, path.basename(dir), 'ep', 'ep-one.mp3'))
  assert.deepEqual(fs.readFileSync(link), bytes)
  assert.equal(r.stored, path.join(root, path.basename(dir), 'ep', 'ep-one.mp3'))
  assert.ok(fs.existsSync(path.join(dir, 'assets/ep', SIDECAR)), 'the sidecar stays beside the name the page uses')
})

test('refuses what is not audio', async () => {
  await assert.rejects(archiveAudio({ siteDir: site(), slug: 'ep', url: 'https://x/page', fetch: fakeFetch('text/html'), root: null, meta: { title: 'x' } }), /not audio/)
})
