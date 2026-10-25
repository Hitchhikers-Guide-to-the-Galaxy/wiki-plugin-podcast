// The podcast item: paste or drop a podcast link (or type a title), and the
// farm finds the podcast's open feed. Then open the podcast page, or any
// recent episode's page, as a ghost page to fork.
//
// Item text (fedwiki DSL, all optional):
//   a link or title on the first line   prefills the box
//   TITLE <podcast title>               hint for pages that carry several podcasts
//   RECENT <n>                          episodes listed on the podcast page (default 10)

const API = '/system/api/podcast'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const day = iso => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const mins = s => s ? `${Math.round(s / 60)} min` : ''
const host = u => { try { return new URL(u).host.replace(/^www\./, '') } catch { return u } }

export function parse(text) {
  const out = { input: '', title: undefined, recent: undefined }
  for (const line of String(text || '').split('\n').map(l => l.trim()).filter(Boolean)) {
    const m = line.match(/^([A-Z]+):?\s+(.*)$/)
    if (m && m[1] === 'TITLE') out.title = m[2]
    else if (m && m[1] === 'RECENT') out.recent = parseInt(m[2], 10) || undefined
    else if (!out.input) out.input = line
  }
  return out
}

async function call(op, body) {
  const r = await fetch(`${API}/${op}.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body),
  })
  let data = {}
  try { data = await r.json() } catch { /* not json */ }
  if (r.status === 401 || r.status === 403) throw new Error(data.error || data.message || 'Sign in as this site\'s owner to look podcasts up (and only on a private site).')
  if (r.status === 404 && !data.error && !data.message) throw new Error('This farm has no podcast service. Is wiki-plugin-podcast installed here?')
  if (!r.ok) throw new Error(data.error || data.message || `The farm answered ${r.status}.`)
  return data
}

const STYLE = `
.podcast-item{border:1px solid #ddd;border-radius:6px;padding:10px;background:#fafaf7}
.podcast-item .pc-row{display:flex;gap:6px}
.podcast-item input{flex:1;min-width:0;padding:5px 7px;border:1px solid #bbb;border-radius:4px;font:inherit}
.podcast-item button{padding:4px 10px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;font:inherit}
.podcast-item button:disabled{opacity:.5;cursor:wait}
.podcast-item.pc-over{outline:2px dashed #4a7;background:#f0f8f0}
.podcast-item .pc-status{color:#666;font-size:85%;margin-top:6px;min-height:1em}
.podcast-item .pc-status.pc-error{color:#b33}
.podcast-item .pc-card{display:flex;gap:10px;margin-top:8px;align-items:flex-start}
.podcast-item .pc-card img{width:72px;height:72px;object-fit:cover;border-radius:4px}
.podcast-item .pc-title{font-weight:bold}
.podcast-item .pc-meta{color:#666;font-size:85%}
.podcast-item ul{margin:8px 0 0;padding:0;list-style:none}
.podcast-item li{display:flex;gap:6px;align-items:baseline;padding:2px 0;border-top:1px solid #eee;font-size:90%}
.podcast-item li span{flex:1}
.podcast-item li em{color:#888;font-style:normal;font-size:85%;white-space:nowrap}
.podcast-item li button{padding:1px 6px;font-size:85%}
.podcast-item .pc-mark{background:#fff6d6}
`

export const emit = (div, item) => {
  const { input } = parse(item.text)
  if (!document.getElementById('podcast-plugin-style')) {
    const s = document.createElement('style'); s.id = 'podcast-plugin-style'; s.textContent = STYLE; document.head.appendChild(s)
  }
  div.html(`<div class="podcast-item">
    <div class="pc-row">
      <input class="pc-input" type="text" value="${esc(input)}" placeholder="Paste or drop a podcast link, or type a title">
      <button class="pc-find">Find</button>
    </div>
    <div class="pc-status"></div>
    <div class="pc-result"></div>
  </div>`)
}

export const bind = (div, item) => {
  const opts = parse(item.text)
  const box = div.find('.podcast-item')[0]
  const inputEl = div.find('.pc-input')[0]
  const findBtn = div.find('.pc-find')[0]
  const statusEl = div.find('.pc-status')[0]
  const resultEl = div.find('.pc-result')[0]
  let last = null

  const status = (msg, error) => { statusEl.textContent = msg || ''; statusEl.classList.toggle('pc-error', !!error) }
  const busy = on => { for (const b of box.querySelectorAll('button')) b.disabled = on }

  async function ghost(episodeKey) {
    if (!last) return
    busy(true); status(episodeKey ? 'Building the episode page…' : 'Building the podcast page…')
    try {
      const r = await call('page', { feedUrl: last.found.feedUrl, episode: episodeKey, found: last.found, recent: opts.recent })
      const $page = div.parents('.page')
      wiki.showResult(wiki.newPage(r.page), { $page })
      status(`Opened “${r.page.title}” as a ghost page. Fork it to keep it.`)
    } catch (e) { status(e.message, true) } finally { busy(false) }
  }

  function show(r) {
    last = r
    const f = r.found, p = r.podcast
    const how = `${f.route} route${f.movedFrom ? '; the old feed stopped, this is the live one' : ''}`
    const eps = p.episodes.slice(0, 10).map(e => `<li class="${r.episode?.key === e.key ? 'pc-mark' : ''}">
        <span>${esc(e.title)}</span><em>${esc([day(e.published), mins(e.duration)].filter(Boolean).join(', '))}</em>
        <button class="pc-ep" data-key="${esc(e.key)}">page</button></li>`).join('')
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
    input = (input ?? inputEl.value).trim()
    if (!input) { status('Paste a podcast link, or type a title.', true); return }
    inputEl.value = input
    busy(true); resultEl.innerHTML = ''; status('Looking for the open feed…')
    try {
      const r = await call('find', { input, title: title ?? opts.title })
      if (!r.ok) { status(`No feed found: ${r.found?.error || 'unknown reason'}.`, true); return }
      show(r)
    } catch (e) { status(e.message, true) } finally { busy(false) }
  }

  findBtn.addEventListener('click', () => find())
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find() } })
  resultEl.addEventListener('click', e => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.classList.contains('pc-pod')) ghost()
    else if (b.classList.contains('pc-ep')) ghost(b.dataset.key)
    else if (b.classList.contains('pc-use')) find(b.dataset.feed)
  })

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

  // Double-click outside the controls edits the item's text, as usual.
  div.on('dblclick', e => { if (!e.target.closest('input,button,a,li')) wiki.textEditor(div, item) })
}

if (typeof window !== 'undefined') {
  window.plugins = window.plugins || {}
  window.plugins.podcast = { emit, bind }
}
