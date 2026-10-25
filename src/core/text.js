// Turning feed HTML into wiki text. Feeds carry show notes as HTML; wiki pages
// want short markdown paragraphs, one per item, with links in wiki form.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', pound: '£', euro: '€', copy: '©' }

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
}

// Plain text, one line: for titles and captions.
export function plain(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

// A link in the wiki's own form, safe inside a markdown item.
const wikiLink = (href, text) => {
  const t = plain(text) || href
  return /^https?:\/\//i.test(href) ? `[${href} ${t.replace(/[[\]]/g, '')}]` : t
}

// HTML show notes -> list of markdown paragraphs (strings). Lists stay lists,
// links become [url text], bold/italic survive, everything else is dropped.
export function htmlToParagraphs(html) {
  let s = String(html ?? '')
  if (!/<[a-z][^>]*>/i.test(s)) {
    // Already plain text: paragraphs are blank-line separated.
    return decodeEntities(s).split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  }
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => wikiLink(decodeEntities(h), t))
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => t.trim() ? `**${t.trim()}**` : '')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => t.trim() ? `*${t.trim()}*` : '')
    .replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|ul|ol|h[1-6]|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(s)
    .split(/\n\s*\n/)
    .map(p => p.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n'))
    .filter(p => p && !/^[-–—\s.]+$/.test(p))
}

// First sentence or two, up to about n characters, for an opening line.
export function lead(text, n = 320) {
  const t = plain(text)
  if (t.length <= n) return t
  const cut = t.slice(0, n)
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return stop > n / 3 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…'
}

// Seconds -> "42 min" / "1 h 05 min".
export function minutes(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return ''
  const m = Math.round(sec / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

// itunes:duration is "3600", "60:00" or "1:00:00".
export function parseDuration(d) {
  if (d == null || d === '') return undefined
  const parts = String(d).trim().split(':').map(Number)
  if (parts.some(n => !Number.isFinite(n))) return undefined
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}
