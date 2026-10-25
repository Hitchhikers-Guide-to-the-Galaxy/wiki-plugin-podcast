// Feed -> wiki pages. A podcast page (about the show, recent episodes playing
// straight from the feed, a table of what the feed says) and an episode page
// (show notes, the audio, where it came from). Plain data in, page JSON out.
import { markdown, audio, image, table, page, podcast } from './pagejson.js'
import { htmlToParagraphs, lead, minutes, plain } from './text.js'

const day = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
const host = u => { try { return new URL(u).host.replace(/^www\./, '') } catch { return u } }
const ext = (u, label) => u ? `[${u} ${label || host(u)}]` : ''
const MAX_NOTES = 30

// BBC feeds point audio at a download link that redirects through a plain-http
// tracking host. The BBC's own download link (the one the LiveCode tools used)
// goes straight to its https CDN: better for playing, and for archiving later.
export function cleanAudio(u) {
  return String(u).replace(/^https?:(\/\/open\.live\.bbc\.co\.uk\/mediaselector\/\d+\/redir\/version\/[\d.]+\/mediaset\/)audio-nondrm-download-rss\/proto\/https?\//,
    'https:$1audio-nondrm-download/proto/https/')
}

// BBC artwork comes at 3000x3000 over http; ask for a page-sized copy over https.
export function cleanImage(u) {
  return u && String(u).replace(/^http:(\/\/ichef\.bbci\.co\.uk\/images\/ic\/)\d+x\d+\//, 'https:$1640x640/')
}

// Some feeds still list http:// audio; an https wiki page may refuse to play it.
// Upgrade when the same URL answers over https (checked once per host).
export async function httpsAudio(urls, { fetch = globalThis.fetch } = {}) {
  const ok = new Map()
  const out = new Map()
  for (const raw of urls) {
    const u = cleanAudio(raw)
    if (u !== raw) { out.set(raw, u); continue }
    if (!/^http:\/\//i.test(u)) { out.set(u, u); continue }
    const h = host(u)
    if (!ok.has(h)) {
      const s = 'https://' + u.slice(7)
      try {
        const r = await fetch(s, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) })
        ok.set(h, r.ok)
      } catch { ok.set(h, false) }
    }
    out.set(u, ok.get(h) ? 'https://' + u.slice(7) : u)
  }
  return out
}

export function episodeCaption(ep, { withLink = true } = {}) {
  const bits = [day(ep.published), minutes(ep.duration)].filter(Boolean).join(', ')
  const link = withLink && ep.link ? ` ${ext(ep.link, 'web')}` : ''
  return `${ep.title}${bits ? ` — ${bits}` : ''}${link}`
}

// found: the feed finder's result (route, ids), recorded on the page.
export async function podcastPage(feed, { found = {}, recent = 10, fetch } = {}) {
  const feedUrl = found.feedUrl || feed.url
  const paras = htmlToParagraphs(feed.description)
  const first = paras[0] ? lead(paras[0], 400) : `${feed.title} is a podcast`
  const opener = `${/[.!?…]$/.test(first) ? first : first + '.'} ${ext(feedUrl, 'rss')}${feed.website ? ' ' + ext(feed.website, 'web') : ''}`
  const eps = feed.episodes.slice(0, recent)
  const urls = await httpsAudio(eps.map(e => e.audio.url), { fetch })

  const story = [markdown(opener)]
  if (feed.image) story.push(image(cleanImage(feed.image), `${feed.title}${feed.author ? ' by ' + feed.author : ''}. Artwork from the feed.`))
  for (const p of paras.slice(paras[0] && lead(paras[0], 400) === plain(paras[0]) ? 1 : 0, 8)) story.push(markdown(p))
  story.push(markdown(`# Recent Episodes\n> The newest ${eps.length} of ${feed.episodes.length}, playing straight from the feed.`))
  // The page's own podcast item: Update Recent adds what the feed has gained
  // since, right under this item; the search box finds an episode in the feed.
  story.push(podcast({ feed: feedUrl, title: feed.title, recent, listennotes: found.listennotesId }))
  for (const ep of eps) story.push(audio(urls.get(ep.audio.url), episodeCaption(ep)))
  story.push(markdown('# About\n> What the feed says about itself.'))
  story.push(table(['Field', 'Value'], [
    ['Feed', ext(feedUrl, host(feedUrl))],
    found.movedFrom && ['Old feed', `${ext(found.movedFrom, host(found.movedFrom))} (no longer updated)`],
    feed.website && ['Website', ext(feed.website)],
    feed.author && ['Author', feed.author],
    feed.categories?.length && ['Categories', feed.categories.join(', ')],
    feed.language && ['Language', feed.language],
    ['Episodes in feed', feed.episodes.length],
    feed.episodes[0] && ['Newest episode', day(feed.episodes[0].published)],
    feed.episodes.length && ['Oldest episode', day(feed.episodes.at(-1).published)],
    found.itunesId && ['Apple Podcasts', ext(`https://podcasts.apple.com/podcast/id${found.itunesId}`, found.itunesId)],
    found.listennotesId && ['ListenNotes', ext(`https://www.listennotes.com/c/${found.listennotesId}/`, found.listennotesId)],
    found.route && ['Found by', `feed finder, ${found.route} route`],
    feed.copyright && ['Copyright', feed.copyright],
  ].filter(Boolean), { caption: 'off' }))

  return page(feed.title, story, {
    provenance: `Built by wiki-plugin-podcast from ${feedUrl} on ${new Date().toISOString().slice(0, 10)}.`,
    label: `Podcast page from its feed`,
  })
}

export async function episodePage(feed, ep, { found = {}, fetch } = {}) {
  const feedUrl = found.feedUrl || feed.url
  const paras = htmlToParagraphs(ep.notes)
  const [url] = (await httpsAudio([ep.audio.url], { fetch })).values()
  const opener = `${paras[0] || ep.subtitle || ep.title} From [[${feed.title}]].`

  const story = [markdown(opener), audio(url, episodeCaption(ep, { withLink: false }))]
  if (ep.image && ep.image !== feed.image) story.push(image(cleanImage(ep.image), `${ep.title}. Episode artwork from the feed.`))
  for (const p of paras.slice(1, MAX_NOTES)) story.push(markdown(p))
  if (paras.length > MAX_NOTES) story.push(markdown(`*The show notes go on; ${paras.length - MAX_NOTES} more paragraphs are in the feed.*`))
  story.push(markdown('# Episode\n> Where this came from.'))
  story.push(table(['Field', 'Value'], [
    ['Podcast', `[[${feed.title}]]`],
    ep.published && ['Published', day(ep.published)],
    ep.duration && ['Length', minutes(ep.duration)],
    (ep.season || ep.number) && ['Season, episode', [ep.season, ep.number].filter(Boolean).join(', ')],
    ['Audio file', ext(url, host(url))],
    ep.audio.bytes && ['Size', `${Math.round(ep.audio.bytes / 1e6)} MB`],
    ep.link && ['Web page', ext(ep.link)],
    ['Feed', ext(feedUrl, host(feedUrl))],
    ep.guid && ['Feed id (guid)', ep.guid],
  ].filter(Boolean), { caption: 'off' }))

  return page(ep.title, story, {
    provenance: `Built by wiki-plugin-podcast from ${feedUrl} (episode ${ep.guid || ep.audio.url}) on ${new Date().toISOString().slice(0, 10)}.`,
    label: 'Episode page from its feed',
  })
}

// A page of podcasts to choose from, built from a directory search: one
// card and one import item per candidate, so the reader presses Podcast page
// on the one they mean and gets its page as a ghost, built from the open feed.
export function candidatesPage(term, candidates, { sources = ['Apple Podcasts'], when = new Date() } = {}) {
  const stamp = when.toISOString().slice(0, 10)
  const n = candidates.length
  const opener = n
    ? `${n} podcast${n === 1 ? '' : 's'} match “${term}” in ${sources.join(' and ')}, searched ${stamp}. Each Podcast page button builds that podcast's page from its open feed as a ghost page: fork it to keep it.`
    : `No podcast matches “${term}” in ${sources.join(' and ')}, searched ${stamp}. Try another spelling, or paste a link to the podcast instead.`
  const story = [markdown(opener)]
  for (const c of candidates) {
    const bits = [c.author && `by ${c.author}`, c.count && `${c.count} episodes`, c.latest && `newest ${day(c.latest)}`, c.genre].filter(Boolean).join(', ')
    const links = [c.itunesId && ext(`https://podcasts.apple.com/podcast/id${c.itunesId}`, 'apple'), ext(c.feedUrl, 'rss')].filter(Boolean).join(' ')
    story.push(markdown(`**${c.title}**${bits ? ' — ' + bits : ''}. ${links}`))
    story.push(podcast({ import: c.feedUrl, title: c.title, itunes: c.itunesId, listennotes: c.listennotesId }))
  }
  if (n) {
    story.push(markdown('# Candidates\n> The same podcasts as a table.'))
    story.push(table(['Podcast', 'Author', 'Episodes', 'Newest', 'Genre', 'Match'], candidates.map(c => [
      c.title, c.author || '', c.count || '', c.latest ? day(c.latest) : '', c.genre || '', c.score != null ? c.score.toFixed(2) : '',
    ]), { caption: 'off' }))
  }
  return page(`Podcasts: ${term}`, story, {
    provenance: `Built by wiki-plugin-podcast from a podcast search for “${term}” on ${stamp}.`,
    label: 'Podcast candidates from a search',
  })
}
