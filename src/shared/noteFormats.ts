// Notion and Obsidian Markdown, in and out.
//
// Notes are stored in one flavour: GitHub Markdown plus the Obsidian extras the
// note view renders ([[links]], ==highlights==, > [!type] callouts, %%comments%%,
// $maths$, ```mermaid / ```svg). Imports from either app are converted into it;
// exports convert out of it into what each app reads natively.

export interface Frontmatter {
  data: Record<string, string | string[]>
  body: string
}

/** Leading `---` YAML block, read for simple `key: value` and list properties. */
export function parseFrontmatter(md: string): Frontmatter {
  const m = md.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!m) return { data: {}, body: md }
  const data: Record<string, string | string[]> = {}
  let listKey: string | null = null
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && listKey) {
      const cur = data[listKey]
      data[listKey] = [...(Array.isArray(cur) ? cur : cur ? [cur] : []), unquote(item[1])]
      continue
    }
    const kv = line.match(/^([\w][\w -]*?)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1].trim().toLowerCase()
    const raw = kv[2].trim()
    listKey = raw === '' ? key : null
    if (raw.startsWith('[') && raw.endsWith(']')) data[key] = raw.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean)
    else data[key] = unquote(raw)
  }
  return { data, body: md.slice(m[0].length) }
}

const unquote = (s: string) => s.replace(/^["']|["']$/g, '')
const yamlValue = (v: string) => (/^[\w .,()/&+-]*$/.test(v) && !/^\d+$/.test(v) && v.trim() === v ? v : JSON.stringify(v))

/** Splits Markdown into fenced code blocks (left alone) and the text between them. */
function eachOutsideCode(md: string, fn: (text: string) => string): string {
  return md
    .split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join('')
}

const NOTION_ID = /\s+[0-9a-f]{32}$/i
/** "Page%20Name%20abc…123.md" → "Page Name" */
export function notionPageName(href: string): string {
  const file = decodeURIComponent(href.split('/').pop() ?? href).replace(/\.md$/i, '')
  return file.replace(NOTION_ID, '').trim()
}

export interface ImportOptions {
  /** Turn an image reference (a relative path, or an Obsidian embed name) into a URL the app can show. Null if it can't be found. */
  resolveImage?: (ref: string) => string | null
}

/**
 * Notion and Obsidian Markdown → how notes are stored. Safe on plain Markdown
 * too: each rule only matches its own app's syntax.
 */
export function importMarkdown(md: string, opts: ImportOptions = {}): string {
  let out = md.replace(/\r\n?/g, '\n')
  const img = (ref: string, alt: string) => {
    const url = opts.resolveImage?.(ref)
    return url ? `![${alt}](${url})` : `![${alt}](${ref})`
  }
  out = eachOutsideCode(out, (t) =>
    t
      // Notion toggles: <details><summary>Title</summary>body</details> → foldable callout.
      .replace(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g, (_, title: string, body: string) => callout('note', stripTags(title).trim(), body.trim(), '-'))
      // Notion callouts: <aside>💡 text</aside> → callout.
      .replace(/<aside>([\s\S]*?)<\/aside>/g, (_, body: string) => {
        const text = stripTags(body).trim()
        const icon = text.match(/^(\p{Extended_Pictographic}️?)\s*/u)
        return callout(icon ? calloutTypeForEmoji(icon[1]) : 'note', '', icon ? text.slice(icon[0].length) : text)
      })
      // Obsidian image embeds: ![[photo.png]] or ![[photo.png|300]]
      .replace(/!\[\[([^\]|#]+\.(?:png|jpe?g|gif|webp|svg|bmp))(?:\|[^\]]*)?\]\]/gi, (_, ref: string) => img(ref.trim(), ''))
      // Notion links to other pages: [Text](Other%20Page%20<id>.md) → [[Other Page|Text]]
      .replace(/(?<!!)\[([^\]]+)\]\(((?:[^)\s]*\/)?[^)\s]*?(?:%20|\s)?[0-9a-f]{32}\.md)\)/gi, (_, text: string, href: string) => {
        const name = notionPageName(href)
        return name === text ? `[[${name}]]` : `[[${name}|${text}]]`
      })
      // Relative image paths (Notion puts them in a folder named after the page).
      .replace(/!\[([^\]]*)\]\((?!https?:|data:|studywise-file:)([^)\s]+)\)/g, (_, alt: string, ref: string) => img(decodeURIComponent(ref), alt))
  )
  return out.replace(/\n{4,}/g, '\n\n\n')
}

const stripTags = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')

function callout(type: string, title: string, body: string, fold = ''): string {
  const lines = body.split('\n').map((l) => (l.trim() ? `> ${l}` : '>'))
  return `\n> [!${type}]${fold}${title ? ` ${title}` : ''}\n${lines.join('\n')}\n`
}

function calloutTypeForEmoji(e: string): string {
  if (/[⚠❗‼🚨]/u.test(e)) return 'warning'
  if (/[💡✨⭐]/u.test(e)) return 'tip'
  if (/[❓🤔]/u.test(e)) return 'question'
  if (/[✅]/u.test(e)) return 'success'
  if (/[❌🛑]/u.test(e)) return 'danger'
  if (/[📌📝ℹ]/u.test(e)) return 'info'
  return 'note'
}

// ---------------------------------------------------------------------------
// Export

export interface ExportNote {
  title: string
  module: string
  type: string
  week: string
  content: string
}

export interface ExportFile {
  /** Path relative to the exported note's folder. */
  path: string
  /** Text contents (svg), or null when the file is copied from `source`. */
  text: string | null
  /** For copied files: the app's own URL for the image. */
  source: string | null
}

export interface ExportResult {
  markdown: string
  /** Images and drawn diagrams the note needs next to it. */
  files: ExportFile[]
}

const ATTACH_DIR = 'attachments'
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'note'

/** Pull images and drawn SVG diagrams out into files the other app can show. */
function collectFiles(md: string, title: string, embed: (path: string, alt: string) => string): ExportResult {
  const files: ExportFile[] = []
  let n = 0
  let out = md.replace(/^```svg[ \t]*\n([\s\S]*?)\n```[ \t]*$/gm, (_, svg: string) => {
    const path = `${ATTACH_DIR}/${slug(title)}-diagram-${++n}.svg`
    let text = svg.trim()
    if (!/xmlns=/.test(text.slice(0, text.indexOf('>')))) text = text.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
    files.push({ path, text, source: null })
    return embed(path, 'Diagram')
  })
  out = eachOutsideCode(out, (t) =>
    t.replace(/!\[([^\]]*)\]\((studywise-file:\/\/[^)\s]+)\)/g, (_, alt: string, url: string) => {
      const path = `${ATTACH_DIR}/${url.split('/').pop()}`
      if (!files.some((f) => f.path === path)) files.push({ path, text: null, source: url })
      return embed(path, alt)
    })
  )
  return { markdown: out, files }
}

/** Obsidian: properties in frontmatter, everything else is native, images as ![[embeds]]. */
export function exportObsidian(note: ExportNote): ExportResult {
  const { data, body } = parseFrontmatter(note.content)
  const props: Record<string, string | string[]> = { ...data }
  if (note.module) props.module = note.module
  if (note.type) props.type = note.type
  if (note.week) props.week = note.week
  const { markdown, files } = collectFiles(body.trim(), note.title, (path) => `![[${path.split('/').pop()}]]`)
  const fm = Object.keys(props).length
    ? `---\n${Object.entries(props)
        .map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${yamlValue(x)}`).join('\n')}` : `${k}: ${yamlValue(v)}`))
        .join('\n')}\n---\n\n`
    : ''
  return { markdown: `${fm}${markdown}\n`, files }
}

const NOTION_ICONS: Record<string, string> = { tip: '💡', hint: '💡', important: '❗', warning: '⚠️', caution: '⚠️', danger: '🛑', error: '🛑', bug: '🐛', question: '❓', faq: '❓', help: '❓', success: '✅', check: '✅', done: '✅', example: '📌', quote: '💬', info: 'ℹ️', todo: '☑️', abstract: '📋', summary: '📋', tldr: '📋' }

/**
 * Notion's Markdown import: title as the first heading, properties as lines,
 * callouts as quotes with an icon, no highlights, comments or [[links]], images
 * as relative paths (import the .zip with its attachments folder).
 */
export function exportNotion(note: ExportNote): ExportResult {
  const { data, body } = parseFrontmatter(note.content)
  const { markdown, files } = collectFiles(body.trim(), note.title, (path, alt) => `![${alt}](${path.split('/').map(encodeURIComponent).join('/')})`)
  const text = eachOutsideCode(markdown, (t) =>
    t
      // Callouts → quote with the type's icon and a bold title.
      .replace(/^>\s*\[!(\w+)\][+-]?[ \t]*(.*)$/gm, (_, type: string, title: string) => {
        const icon = NOTION_ICONS[type.toLowerCase()] ?? '📝'
        const label = title.trim() || type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()
        return `> ${icon} **${label}**`
      })
      .replace(/%%[\s\S]*?%%/g, '')
      .replace(/==([^=\n]+)==/g, '**$1**')
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]|#]+)(?:#([^\]|]*))?\]\]/g, (_, page: string, heading?: string) => (heading ? `${page.trim()} › ${heading.trim()}` : page.trim()))
  )
  const props = [
    note.module && `Module: ${note.module}`,
    note.type && `Type: ${note.type}`,
    note.week && `Week: ${note.week}`,
    ...Object.entries(data)
      .filter(([k]) => !['module', 'type', 'week', 'title'].includes(k))
      .map(([k, v]) => `${k.charAt(0).toUpperCase()}${k.slice(1)}: ${Array.isArray(v) ? v.join(', ') : v}`)
  ].filter(Boolean)
  return { markdown: `# ${note.title}\n\n${props.length ? `${props.join('\n')}\n\n` : ''}${text.replace(/\n{3,}/g, '\n\n').trim()}\n`, files }
}
