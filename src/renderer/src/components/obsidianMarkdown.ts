// Obsidian's Markdown extras, so notes from Obsidian (and Notion, converted on
// import) look right: > [!type] callouts (foldable with + or -), ==highlights==,
// [[links]] to other notes and %%comments%% (hidden).

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown>; url?: string }

export const NOTE_LINK = 'studywise-note:'

const CALLOUT = /^\[!([\w-]+)\]([+-])?[ \t]*([^\n]*)/

function calloutize(bq: Node): void {
  const first = bq.children?.[0]
  const text = first?.type === 'paragraph' ? first.children?.[0] : null
  if (!first || !text || text.type !== 'text' || !text.value) return
  const m = text.value.match(CALLOUT)
  if (!m) return
  const [, rawType, fold, rawTitle] = m
  const type = rawType.toLowerCase()
  text.value = text.value.slice(m[0].length).replace(/^\n/, '')
  // The marker's own line ends at the first line break.
  if (!text.value) {
    first.children!.shift()
    if (first.children![0]?.type === 'break') first.children!.shift()
  }
  if (!first.children!.length) bq.children!.shift()
  const title = rawTitle.trim() || type.charAt(0).toUpperCase() + type.slice(1)
  bq.data = { hName: fold ? 'details' : 'div', hProperties: { className: ['callout', `callout-${type}`], ...(fold === '+' ? { open: true } : {}) } }
  bq.children!.unshift({ type: 'paragraph', data: { hName: fold ? 'summary' : 'div', hProperties: { className: ['callout-title'] } }, children: [{ type: 'text', value: title }] })
}

const INLINE = /%%[\s\S]*?%%|==([^=\n]+?)==|\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g

function splitText(value: string): Node[] | null {
  if (!/%%|==|\[\[/.test(value)) return null
  const out: Node[] = []
  let last = 0
  for (const m of value.matchAll(INLINE)) {
    if (m.index! > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ type: 'highlight', data: { hName: 'mark' }, children: [{ type: 'text', value: m[1] }] })
    else if (m[2] !== undefined) {
      const target = m[2].trim()
      const label = (m[3] ?? target.replace(/#.*$/, '')).trim()
      out.push({ type: 'link', url: NOTE_LINK + encodeURIComponent(target.replace(/#.*$/, '')), children: [{ type: 'text', value: label }], data: { hProperties: { className: ['note-link'] } } })
    }
    last = m.index! + m[0].length
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function walk(node: Node): void {
  if (node.type === 'blockquote') calloutize(node)
  if (!node.children) return
  const next: Node[] = []
  for (const child of node.children) {
    // Text inside links keeps its brackets; code is never a 'text' node.
    const parts = child.type === 'text' && node.type !== 'link' ? splitText(child.value ?? '') : null
    if (parts) next.push(...parts)
    else {
      walk(child)
      next.push(child)
    }
  }
  node.children = next
}

/** remark plugin */
export function remarkObsidian() {
  return (tree: any) => walk(tree as Node)
}
