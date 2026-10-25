// The podcast item, in one of three modes, chosen by its text:
//
//   find    (default)  paste or drop a podcast link, or type a title: the farm
//                      finds the open feed, then Podcast page and episode
//                      buttons open ghost pages to fork. Find podcasts opens a
//                      page of candidates for a title instead.
//   feed    FEED url   the item a built podcast page carries under its Recent
//                      Episodes heading: Update Recent backs the page up and
//                      adds the episodes the feed has gained, right under this
//                      item; the search box finds an episode in this podcast.
//   import  IMPORT url one card on a candidates page: Podcast page builds the
//                      podcast's page from that feed as a ghost.
//   archive ARCHIVE url the item an episode page carries under its audio:
//                      Archive the audio keeps a copy in the page's assets
//                      folder (with where it came from) and points the audio
//                      item at it, keeping a link to the original.
//
// Item text (fedwiki DSL, all optional):
//   a link or title on the first line   prefills the box (find mode)
//   FEED <feed url>                     feed mode
//   IMPORT <feed url>                   import mode
//   TITLE <podcast title>               hint for pages that carry several podcasts; the card title
//   RECENT <n>                          episodes on the podcast page, and per update (default 10)
//   ITUNES <id>, LISTENNOTES <id>       directory ids, recorded on the page and used for scoped search
//   EPISODE <key>                       archive mode: the episode's guid (or audio URL) in the feed
//   ARCHIVED <url>                      archive mode: written by the item once the copy is kept

const API = '/system/api/podcast'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const day = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const mins = s => s ? `${Math.round(s / 60)} min` : ''
const host = u => { try { return new URL(u).host.replace(/^www\./, '') } catch { return u } }

export function parse(text) {
  const out = { input: '', title: undefined, recent: undefined, feed: undefined, import: undefined, itunes: undefined, listennotes: undefined, archive: undefined, episode: undefined, archived: undefined }
  for (const line of String(text || '').split('\n').map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^([A-Z]+):?\s+(.*)$/)
    if (m && m[1] === 'TITLE') out.title = m[2]
    else if (m && m[1] === 'RECENT') out.recent = parseInt(m[2], 10) || undefined
    else if (m && m[1] === 'FEED') out.feed = m[2]
    else if (m && m[1] === 'IMPORT') out.import = m[2]
    else if (m && m[1] === 'ITUNES') out.itunes = m[2]
    else if (m && m[1] === 'LISTENNOTES') out.listennotes = m[2]
    else if (m && m[1] === 'ARCHIVE') out.archive = m[2]
    else if (m && m[1] === 'EPISODE') out.episode = m[2]
    else if (m && m[1] === 'ARCHIVED') out.archived = m[2]
    else if (!out.input) out.input = line
  }
  out.mode = out.archive ? 'archive' : out.import ? 'import' : out.feed ? 'feed' : 'find'
  return out
}

async function call(op, body) {
  const r = await fetch(`${API}/${op}.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body),
  })
  let data = {}
  try { data = await r.json() } catch { /* not json */ }
  if (r.status === 401 || r.status === 403) throw new Error('Sign in as this site\'s owner to look podcasts up. The podcast box works only for the owner, and only on a private site.')
  if (r.status === 404 && !data.error && !data.message) throw new Error(`This farm has no podcast ${op} operation. Is wiki-plugin-podcast installed here, and the farm restarted since?`)
  if (!r.ok) throw new Error(data.error || data.message || `The farm answered ${r.status}.`)
  return data
}

const STYLE = `
.podcast-item{border:1px solid #ddd;border-radius:6px;padding:10px;background:#fafaf7}
.podcast-item .pc-row{display:flex;gap:6px;align-items:center}
.podcast-item .pc-row+.pc-row{margin-top:6px}
.podcast-item input{flex:1;min-width:0;padding:5px 7px;border:1px solid #bbb;border-radius:4px;font:inherit}
.podcast-item button{padding:4px 10px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;font:inherit;white-space:nowrap}
.podcast-item button:disabled{opacity:.5;cursor:wait}
.podcast-item.pc-over{outline:2px dashed #4a7;background:#f0f8f0}
.podcast-item .pc-status{color:#666;font-size:85%;margin-top:6px;min-height:1em}
.podcast-item .pc-status.pc-error{color:#b33}
.podcast-item .pc-card{display:flex;gap:10px;margin-top:8px;align-items:flex-start}
.podcast-item .pc-card img{width:72px;height:72px;object-fit:cover;border-radius:4px}
.podcast-item .pc-title{font-weight:bold;flex:1}
.podcast-item .pc-meta{color:#666;font-size:85%}
.podcast-item ul{margin:8px 0 0;padding:0;list-style:none}
.podcast-item li{display:flex;gap:6px;align-items:baseline;padding:2px 0;border-top:1px solid #eee;font-size:90%}
.podcast-item li span{flex:1}
.podcast-item li span small{display:block;color:#777;font-size:90%}
.podcast-item li em{color:#888;font-style:normal;font-size:85%;white-space:nowrap}
.podcast-item li button{padding:1px 6px;font-size:85%}
.podcast-item .pc-mark{background:#fff6d6}
.podcast-item.pc-feed .pc-update{font-weight:bold}
`

const ensureStyle = () => {
  if (!document.getElementById('podcast-plugin-style')) {
    const s = document.createElement('style'); s.id = 'podcast-plugin-style'; s.textContent = STYLE; document.head.appendChild(s)
  }
}

export const emit = (div, item) => {
  const o = parse(item.text)
  ensureStyle()
  if (o.mode === 'feed') {
    div.html(`<div class="podcast-item pc-feed">
      <div class="pc-row"><button class="pc-update">Update Recent</button><span class="pc-meta">adds what the feed has gained since, after backing this page up</span></div>
      <div class="pc-row"><input class="pc-q" type="text" placeholder="Search this podcast"><button class="pc-search">Search</button></div>
      <div class="pc-status"></div>
      <div class="pc-result"></div>
    </div>`)
  } else if (o.mode === 'archive') {
    div.html(`<div class="podcast-item pc-archive">
      <div class="pc-row">${o.archived
        ? `<span class="pc-meta">The audio above plays from this page's own copy, <a href="${esc(o.archived)}" target="_blank" rel="noopener">${esc(o.archived.split('/').pop())}</a>.</span>`
        : `<button class="pc-keep">Archive the audio</button><span class="pc-meta">keeps a copy in this page's assets folder, with where it came from, and plays from it</span>`}</div>
      <div class="pc-status"></div>
    </div>`)
  } else if (o.mode === 'import') {
    div.html(`<div class="podcast-item pc-import">
      <div class="pc-row"><span class="pc-title">${esc(o.title || host(o.import))}</span><button class="pc-pod">Podcast page</button></div>
      <div class="pc-status"></div>
    </div>`)
  } else {
    div.html(`<div class="podcast-item pc-find">
      <div class="pc-row">
        <input class="pc-input" type="text" value="${esc(o.input)}" placeholder="Paste or drop a podcast link, or type a title">
        <button class="pc-find">Find</button>
        <button class="pc-more" title="A page of podcasts matching the title, to pick from">Find podcasts</button>
      </div>
      <div class="pc-status"></div>
      <div class="pc-result"></div>
    </div>`)
  }
}

// ── the wiki's own journal: add and edit, as wiki-plugin-plan does it ────────

// The wiki server applies each action with an unserialised read-modify-write
// of the page file: one put at a time, ajaxComplete signals the landing.
function putAndWait($page, action) {
  return new Promise(resolve => {
    const fallback = setTimeout(() => { $(document).off('ajaxComplete', handler); resolve() }, 3000)
    const handler = (e, xhr, settings) => {
      if ((settings.url || '').includes('/action')) { clearTimeout(fallback); $(document).off('ajaxComplete', handler); resolve() }
    }
    $(document).on('ajaxComplete', handler)
    wiki.pageHandler.put($page, action)
  })
}

// Render one item into its div with its own plugin when the page has loaded
// it (audio, markdown and table always have, on a podcast page). wiki.doPlugin
// would re-emit every item to the right of it, this one included, and lose
// the status line that says what the update did.
function render($div, item) {
  const p = window.plugins && window.plugins[item.type]
  $div.data('item', item).empty()
  if (p && p.emit) { p.emit($div, item); if (p.bind) p.bind($div, item) } else wiki.doPlugin($div, item)
}

// Add one item after `afterId`, in the DOM and on the server: the add the wiki journals.
async function addItem($page, afterId, item) {
  const $story = $page.find('.story:first')
  const $anchor = afterId ? $story.children(`.item[data-id="${afterId}"]`) : $()
  const $new = $('<div />', { class: `item ${item.type}`, 'data-id': item.id }).data('pageElement', $page)
  if ($anchor.length) $anchor.after($new)
  else $story.append($new)
  render($new, item)
  await putAndWait($page, { type: 'add', id: item.id, item, after: afterId })
}

// Change one item's text, re-render it, and journal the edit.
async function editItem($page, { id, text }) {
  const $it = $page.find('.story:first').children(`.item[data-id="${id}"]`)
  if (!$it.length) return
  const item = { ...$it.data('item'), text }
  render($it, item)
  await putAndWait($page, { type: 'edit', id, item })
}

const localPage = $page => $page.length && !$page.hasClass('ghost') && !$page.hasClass('remote') && !$page.hasClass('local') && !$page.data('site')

// ── the item ─────────────────────────────────────────────────────────────────

export const bind = (div, item) => {
  const opts = parse(item.text)
  const box = div.find('.podcast-item')[0]
  const statusEl = div.find('.pc-status')[0]
  const resultEl = div.find('.pc-result')[0]
  let last = null

  const status = (msg, error) => { statusEl.textContent = msg || ''; statusEl.classList.toggle('pc-error', !!error) }
  const busy = on => { for (const b of box.querySelectorAll('button')) b.disabled = on }
  const $page = () => div.parents('.page')

  // A ghost page to the right of this one: a podcast page, an episode page, or candidates.
  const show = (page, what) => {
    wiki.showResult(wiki.newPage(page), { $page: $page() })
    status(`Opened “${page.title}” as a ghost page${what ? ' ' + what : ''}. Fork it to keep it.`)
  }

  async function ghost({ feedUrl, episodeKey, found, what }) {
    busy(true); status(episodeKey ? 'Building the episode page…' : 'Building the podcast page…')
    try {
      const r = await call('page', { feedUrl, episode: episodeKey, found, recent: opts.recent })
      show(r.page, what)
    } catch (e) { status(e.message, true) } finally { busy(false) }
  }

  const episodeList = (eps, mark) => eps.map(e => `<li class="${mark === e.key ? 'pc-mark' : ''}">
      <span>${esc(e.title)}${e.snippet ? `<small>${esc(e.snippet)}</small>` : ''}</span>
      <em>${esc([day(e.published), mins(e.duration), e.where === 'listennotes' && !e.inFeed ? 'not in the feed' : ''].filter(Boolean).join(', '))}</em>
      ${e.key ? `<button class="pc-ep" data-key="${esc(e.key)}">page</button>` : ''}</li>`).join('')

  // find mode ----------------------------------------------------------------
  function showFound(r) {
    last = r
    const f = r.found, p = r.podcast
    const how = `${f.route} route${f.movedFrom ? '; the old feed stopped, this is the live one' : ''}`
    const eps = episodeList(p.episodes.slice(0, 10), r.episode?.key)
    const others = f.ambiguous && f.candidates?.length
      ? `<div class="pc-meta" style="margin-top:8px">“${esc(f.input)}” could be several podcasts. Not this one?</div><ul>${f.candidates
          .filter(c => c.feedUrl !== f.feedUrl).slice(0, 5)
          .map(c => `<li><span>${esc(c.title)}</span><button class="pc-use" data-feed="${esc(c.feedUrl)}">use</button></li>`).join('')}</ul>`
      : ''
    const named = r.episode && !p.episodes.slice(0, 10).some(e => e.key === r.episode.key)
      ? `<div style="margin-top:8px"><button class="pc-ep" data-key="${esc(r.episode.key)}">Episode page: ${esc(r.episode.title)}</button></div>` : ''
    resultEl.innerHTML = `<div class="pc-card">
        ${p.image ? `<img src="${esc(p.image)}" alt="">` : ''}
        <div><div class="pc-title">${esc(p.title)}</div>
          <div class="pc-meta">${esc(p.author || '')}${p.author ? ' · ' : ''}${p.count} episodes · <a href="${esc(f.feedUrl)}" target="_blank" rel="noopener">${esc(host(f.feedUrl))}</a></div>
          <div class="pc-meta">found by the ${esc(how)}</div>
          <div style="margin-top:6px"><button class="pc-pod">Podcast page</button></div></div>
      </div>${named}${others}<ul>${eps}</ul>`
    status(r.episode ? `Found the podcast and the episode “${r.episode.title}”.` : 'Found the podcast.')
  }

  async function find(input, title) {
    const inputEl = div.find('.pc-input')[0]
    input = (input ?? inputEl.value).trim()
    if (!input) { status('Paste a podcast link, or type a title.', true); return }
    inputEl.value = input
    busy(true); resultEl.innerHTML = ''; status('Looking for the open feed…')
    try {
      const r = await call('find', { input, title: title ?? opts.title })
      if (!r.ok) { status(`No feed found: ${r.found?.error || 'unknown reason'}.`, true); return }
      showFound(r)
    } catch (e) { status(e.message, true) } finally { busy(false) }
  }

  async function findPodcasts() {
    const q = div.find('.pc-input')[0].value.trim()
    if (!q) { status('Type a podcast title to look for.', true); return }
    busy(true); resultEl.innerHTML = ''; status('Searching the podcast directories…')
    try {
      const r = await call('podcasts', { q })
      show(r.page, `with ${r.candidates.length} podcast${r.candidates.length === 1 ? '' : 's'} to pick from`)
    } catch (e) { status(e.message, true) } finally { busy(false) }
  }

  // feed mode ----------------------------------------------------------------
  async function update() {
    const $p = $page()
    if (!localPage($p)) { status('Fork this page to this site first: Update Recent edits the page here.', true); return }
    const slug = $p.attr('id')
    busy(true); resultEl.innerHTML = ''; status('Backing the page up and re-reading the feed…')
    try {
      const r = await call('update', { slug, feedUrl: opts.feed, recent: opts.recent })
      if (!r.added.length) { status(`Nothing new: the feed has ${r.feed.count} episodes and this page already has the newest.`); return }
      status(`Adding ${r.added.length} new episode${r.added.length === 1 ? '' : 's'}…`)
      // Oldest first, each right after this item, so the newest ends on top.
      for (const it of [...r.added].reverse()) await addItem($p, item.id, it)
      for (const e of r.edits) await editItem($p, e)
      const left = r.feed.missing - r.added.length
      status(`Added ${r.added.length} new episode${r.added.length === 1 ? '' : 's'}${left > 0 ? ` (${left} older ones not added)` : ''}. The page was backed up first to ${r.backup}.`)
    } catch (e) { status(e.message, true) } finally { busy(false) }
  }

  // archive mode -------------------------------------------------------------
  async function keep() {
    const $p = $page()
    if (!localPage($p)) { status('Fork this page to this site first: the copy is kept in its assets folder.', true); return }
    const slug = $p.attr('id')
    busy(true); status('Downloading the audio… a long episode takes a minute or two.')
    try {
      const r = await call('archive', { slug, feedUrl: opts.archive, episode: opts.episode })
      // The audio item to repoint: the one playing this episode's audio, else the first on the page.
      const $items = $p.find('.story:first').children('.item.audio')
      let $audio = $items.filter((i, el) => String($(el).data('item')?.text || '').split('\n')[0] === r.original)
      if (!$audio.length) $audio = $items.first()
      if ($audio.length) {
        const a = $audio.data('item')
        const [, ...caption] = String(a.text || '').split('\n')
        const mb = Math.round(r.size / 1e6)
        const text = `${r.url}\n${caption.join(' ').trim()} — archived copy, ${mb} MB; [${r.original} original]`
        await editItem($p, { id: a.id, text })
      }
      const mine = String(item.text || '').split('\n').filter(l => !/^ARCHIVED\b/.test(l)).concat(`ARCHIVED ${r.url}`).join('\n')
      await editItem($p, { id: item.id, text: mine })
    } catch (e) { status(e.message, true); busy(false) }
  }

  async function search() {
    const q = div.find('.pc-q')[0].value.trim()
    if (!q) { status('Type a word or two to look for in this podcast.', true); return }
    busy(true); resultEl.innerHTML = ''; status('Searching the feed…')
    try {
      const r = await call('search', { feedUrl: opts.feed, q, listennotesId: opts.listennotes })
      if (!r.hits.length) { status(`Nothing in ${r.count} episodes matches “${q}”.`); return }
      resultEl.innerHTML = `<ul>${episodeList(r.hits)}</ul>`
      status(`${r.hits.length} episode${r.hits.length === 1 ? '' : 's'} match “${q}”${r.source === 'feed+listennotes' ? ', from the feed and ListenNotes' : ''}.`)
    } catch (e) { status(e.message, true) } finally { busy(false) }
  }

  const found = () => last ? last.found : { feedUrl: opts.feed || opts.import, route: opts.mode === 'import' ? 'find podcasts' : undefined, itunesId: opts.itunes, listennotesId: opts.listennotes }

  box.addEventListener('click', e => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.classList.contains('pc-find')) find()
    else if (b.classList.contains('pc-more')) findPodcasts()
    else if (b.classList.contains('pc-update')) update()
    else if (b.classList.contains('pc-keep')) keep()
    else if (b.classList.contains('pc-search')) search()
    else if (b.classList.contains('pc-pod')) ghost({ feedUrl: found().feedUrl, found: found() })
    else if (b.classList.contains('pc-ep')) ghost({ feedUrl: found().feedUrl, found: found(), episodeKey: b.dataset.key })
    else if (b.classList.contains('pc-use')) find(b.dataset.feed)
  })
  for (const sel of ['.pc-input', '.pc-q']) {
    const el = div.find(sel)[0]
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sel === '.pc-q' ? search() : find() } })
  }

  if (opts.mode === 'find') {
    // Dropping a link (from another tab, a page, the address bar) looks it up at once.
    // Stop the event here so the wiki does not also turn the drop into a new item.
    box.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); box.classList.add('pc-over') })
    box.addEventListener('dragleave', () => box.classList.remove('pc-over'))
    box.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); box.classList.remove('pc-over')
      const dt = e.dataTransfer
      const link = (dt.getData('text/uri-list') || '').split('\n').find(l => l && !l.startsWith('#')) || dt.getData('text/plain')
      if (link) find(link.trim())
    })
  }

  // Double-click outside the controls edits the item's text, as usual.
  div.on('dblclick', e => { if (!e.target.closest('input,button,a,li')) wiki.textEditor(div, item) })
}

if (typeof window !== 'undefined') {
  window.plugins = window.plugins || {}
  window.plugins.podcast = { emit, bind }
}
