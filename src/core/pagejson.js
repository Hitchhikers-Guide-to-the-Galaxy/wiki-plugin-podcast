// Federated wiki page JSON, built in plain JS (no wiki DOM): ids, slugs,
// items and the create journal entry. Mirrors fedwiki-lib's conventions.
import { randomBytes } from 'node:crypto'

export const nid = () => randomBytes(8).toString('hex')

// wiki-client's asSlug: spaces to hyphens, drop anything else non-alphanumeric.
export const asSlug = title => String(title).replace(/\s/g, '-').replace(/[^A-Za-z0-9-]/g, '').toLowerCase()

export const markdown = text => ({ type: 'markdown', id: nid(), text })
export const audio = (url, caption) => ({ type: 'audio', id: nid(), text: `${url}\n${caption}` })
export const image = (url, caption) => ({ type: 'image', id: nid(), url, text: caption, caption })
export const assets = folder => ({ type: 'assets', id: nid(), text: folder })

// A podcast item in one of its modes: find (a link or title on the first
// line), feed (FEED url: Update Recent and search, on a podcast page) or
// import (IMPORT url: one Podcast page button, on a candidates page).
export function podcast({ input, feed, import: imp, title, recent, itunes, listennotes } = {}) {
  const lines = []
  if (imp) lines.push(`IMPORT ${imp}`)
  else if (feed) lines.push(`FEED ${feed}`)
  else if (input) lines.push(input)
  if (title) lines.push(`TITLE ${title}`)
  if (recent && recent !== 10) lines.push(`RECENT ${recent}`)
  if (itunes) lines.push(`ITUNES ${itunes}`)
  if (listennotes) lines.push(`LISTENNOTES ${listennotes}`)
  return { type: 'podcast', id: nid(), text: lines.join('\n') }
}

// Table plugin item: directives, a blank line, then a pipe table.
export function table(columns, rows, { caption, layout = 'table', fit = 'first' } = {}) {
  const cell = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const head = [caption != null && `CAPTION ${caption}`, layout && `LAYOUT ${layout}`, fit && `FIT ${fit}`].filter(Boolean)
  const lines = [`| ${columns.map(cell).join(' | ')} |`, `|${'---|'.repeat(columns.length)}`,
    ...rows.map(r => `| ${r.map(cell).join(' | ')} |`)]
  return { type: 'table', id: nid(), text: `${head.join('\n')}\n\n${lines.join('\n')}` }
}

export function page(title, story, { provenance, date = Date.now(), label } = {}) {
  const create = { type: 'create', item: { title, story: structuredClone(story) }, date }
  if (provenance) create.provenance = provenance
  // Journal meta (fedwiki-lib v1): who made this entry and why. wiki-client ignores it.
  create.meta = { v: 1, act: 'create', label: label || title, agent: { kind: 'tool', name: 'wiki-plugin-podcast' } }
  return { title, story, journal: [create] }
}
