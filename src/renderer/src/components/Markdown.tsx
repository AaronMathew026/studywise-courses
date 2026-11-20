import { memo, useEffect, useId, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import rehypeKatex from 'rehype-katex'
import { cx } from './ui'
import { remarkObsidian, NOTE_LINK } from './obsidianMarkdown'
import { parseFrontmatter } from '@shared/noteFormats'
import { api } from '../lib/api'
import { useStore, toast } from '../lib/store'

let mermaidReady: Promise<typeof import('mermaid').default> | null = null
function loadMermaid(dark: boolean) {
  if (!mermaidReady) mermaidReady = import('mermaid').then((m) => m.default)
  return mermaidReady.then((m) => {
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', fontFamily: 'Bricolage Grotesque Variable, sans-serif' })
    return m
  })
}

function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const dark = document.documentElement.classList.contains('dark')
    loadMermaid(dark)
      .then((m) => m.render(`m${id}${Date.now()}`, code))
      .then((r) => alive && (setSvg(r.svg), setErr(null)))
      .catch((e) => alive && setErr(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [code, id])
  if (err)
    return (
      <pre className="text-[0.85em]">
        <code>{code}</code>
      </pre>
    )
  if (!svg) return <div className="skeleton my-2 h-32" />
  return <div className="mermaid-box my-3 flex justify-center rounded-lg bg-surface-2/60 p-3" dangerouslySetInnerHTML={{ __html: svg }} />
}

/**
 * A diagram Claude drew as SVG. Shown as an <img> from a data URL, so nothing
 * inside it (scripts, event handlers, external loads) can run or reach the page.
 */
function SvgDiagram({ code }: { code: string }) {
  const [broken, setBroken] = useState(false)
  const src = useMemo(() => {
    let svg = code.trim().replace(/^<\?xml[^>]*>\s*/i, '')
    if (!/^<svg[\s>]/i.test(svg)) return null
    // An SVG loaded as an image needs its namespace.
    if (!/xmlns=/.test(svg.slice(0, svg.indexOf('>')))) svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }, [code])
  if (!src || broken)
    return (
      <pre className="text-[0.85em]">
        <code>{code}</code>
      </pre>
    )
  return (
    <div className="svg-box my-3 flex justify-center rounded-lg border border-line bg-white p-3">
      <img src={src} alt="Diagram" onError={() => setBroken(true)} className="h-auto max-h-[70vh] w-full max-w-[680px]" />
    </div>
  )
}

/** Open the note a [[link]] points at, by title. */
async function openNoteLink(href: string) {
  const title = decodeURIComponent(href.slice(NOTE_LINK.length)).trim().toLowerCase()
  const notes = await api.notes.list()
  const hit = notes.find((n) => n.title.trim().toLowerCase() === title)
  if (hit) useStore.getState().go({ name: 'notes', id: hit.id })
  else toast(`No note called “${decodeURIComponent(href.slice(NOTE_LINK.length))}” yet`, 'info')
}

/** Frontmatter properties (from Obsidian), shown as a small table instead of raw YAML. */
function Properties({ data }: { data: Record<string, string | string[]> }) {
  const rows = Object.entries(data)
  if (!rows.length) return null
  return (
    <dl className="note-props">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{Array.isArray(v) ? v.join(', ') : v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Markdown with GFM tables, KaTeX maths, Mermaid and SVG diagrams, and Obsidian's callouts, highlights, [[links]] and properties. */
export const Markdown = memo(function Markdown({ children, className, streaming }: { children: string; className?: string; streaming?: boolean }) {
  const { data, body } = useMemo(() => parseFrontmatter(children), [children])
  return (
    <div className={cx('md', className)}>
      <Properties data={data} />
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, [remarkMath, { singleDollarTextMath: true }], remarkObsidian]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
        urlTransform={(url) => (/^(https?:|studywise-file:|studywise-note:|data:image\/|#)/.test(url) ? url : '')}
        components={{
          code({ className: cls, children: kids, ...rest }) {
            const lang = /language-(\w+)/.exec(cls ?? '')?.[1]
            const text = String(kids ?? '').replace(/\n$/, '')
            if (lang === 'mermaid' && !streaming) return <Mermaid code={text} />
            if (lang === 'svg' && !streaming) return <SvgDiagram code={text} />
            return (
              <code className={cls} {...rest}>
                {kids}
              </code>
            )
          },
          pre({ children: kids }) {
            // Mermaid and SVG diagrams render their own box; avoid wrapping them in <pre>.
            const child = Array.isArray(kids) ? kids[0] : kids
            const cls = (child as { props?: { className?: string } })?.props?.className ?? ''
            if ((cls.includes('language-mermaid') || cls.includes('language-svg')) && !streaming) return <>{kids}</>
            return <pre>{kids}</pre>
          },
          a({ href, children: kids }) {
            if (href?.startsWith(NOTE_LINK))
              return (
                <a
                  href="#"
                  className="note-link"
                  onClick={(e) => {
                    e.preventDefault()
                    void openNoteLink(href)
                  }}
                >
                  {kids}
                </a>
              )
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {kids}
              </a>
            )
          },
          table({ children: kids }) {
            return (
              <div className="table-wrap">
                <table>{kids}</table>
              </div>
            )
          }
        }}
      >
        {body}
      </ReactMarkdown>
      {streaming && <span className="ml-0.5 inline-block h-[1.1em] w-[0.5ch] translate-y-[3px] animate-pulse rounded-sm bg-accent" />}
    </div>
  )
})
