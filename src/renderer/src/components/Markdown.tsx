import { memo, useEffect, useId, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import rehypeKatex from 'rehype-katex'
import { cx } from './ui'

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

/** Markdown with GFM tables, KaTeX maths and Mermaid diagrams. */
export const Markdown = memo(function Markdown({ children, className, streaming }: { children: string; className?: string; streaming?: boolean }) {
  return (
    <div className={cx('md', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
        urlTransform={(url) => (/^(https?:|studywise-file:|data:image\/|#)/.test(url) ? url : '')}
        components={{
          code({ className: cls, children: kids, ...rest }) {
            const lang = /language-(\w+)/.exec(cls ?? '')?.[1]
            const text = String(kids ?? '').replace(/\n$/, '')
            if (lang === 'mermaid' && !streaming) return <Mermaid code={text} />
            return (
              <code className={cls} {...rest}>
                {kids}
              </code>
            )
          },
          pre({ children: kids }) {
            // Mermaid renders its own box; avoid wrapping it in <pre>.
            const child = Array.isArray(kids) ? kids[0] : kids
            const isMermaid = (child as { props?: { className?: string } })?.props?.className?.includes('language-mermaid')
            if (isMermaid && !streaming) return <>{kids}</>
            return <pre>{kids}</pre>
          },
          a({ href, children: kids }) {
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
        {children}
      </ReactMarkdown>
      {streaming && <span className="ml-0.5 inline-block h-[1.1em] w-[0.5ch] translate-y-[3px] animate-pulse rounded-sm bg-accent" />}
    </div>
  )
})
