import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { extname, basename, join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'

export const SUPPORTED_SOURCE_EXT = ['.pdf', '.docx', '.pptx', '.txt', '.md', '.markdown']

/** Claude's Read tool handles PDFs directly; beyond this size we fall back to text. */
const MAX_PDF_CHUNK_BYTES = 25 * 1024 * 1024
export const PAGES_PER_CHUNK = 8

export interface SourceChunk {
  /** A PDF file Claude should read (copied into the temp cwd), if any. */
  file?: string
  /** Text for the prompt when we can't send the file itself. */
  text?: string
  label: string
  /** "cover only pages X–Y" instruction for chunked PDFs */
  partInfo?: string
}

export async function pdfPageCount(file: string): Promise<number> {
  const doc = await PDFDocument.load(readFileSync(file), { ignoreEncryption: true, updateMetadata: false })
  return doc.getPageCount()
}

/** Split a PDF into ≈8-page PDFs so each call sees the real pages (images, tables). */
export async function splitPdf(file: string, outDir: string, pagesPerChunk = PAGES_PER_CHUNK): Promise<{ file: string; from: number; to: number; total: number }[]> {
  const src = await PDFDocument.load(readFileSync(file), { ignoreEncryption: true, updateMetadata: false })
  const total = src.getPageCount()
  if (total <= pagesPerChunk) return [{ file, from: 1, to: total, total }]
  mkdirSync(outDir, { recursive: true })
  const out: { file: string; from: number; to: number; total: number }[] = []
  const stem = basename(file, extname(file)).replace(/[^\w.-]+/g, '_')
  for (let start = 0; start < total; start += pagesPerChunk) {
    const end = Math.min(total, start + pagesPerChunk)
    const doc = await PDFDocument.create()
    const pages = await doc.copyPages(src, Array.from({ length: end - start }, (_, i) => start + i))
    pages.forEach((p) => doc.addPage(p))
    const p = join(outDir, `${stem}_p${start + 1}-${end}.pdf`)
    writeFileSync(p, await doc.save())
    out.push({ file: p, from: start + 1, to: end, total })
  }
  return out
}

export async function extractPdfText(file: string): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: readFileSync(file) })
  try {
    const r = await parser.getText()
    return r.text
  } finally {
    await parser.destroy()
  }
}

export async function extractDocxText(file: string): Promise<string> {
  const mammoth = await import('mammoth')
  const r = await mammoth.extractRawText({ path: file })
  return r.value
}

export async function extractPptxText(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(file))
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml/)![1]) - Number(b.match(/(\d+)\.xml/)![1]))
  const out: string[] = []
  for (const [i, name] of slides.entries()) {
    const xml = await zip.files[name].async('string')
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(''))
    const notesName = name.replace('slides/slide', 'notesSlides/notesSlide')
    let notes = ''
    if (zip.files[notesName]) {
      const nx = await zip.files[notesName].async('string')
      notes = [...nx.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(' ')
    }
    out.push(`## Slide ${i + 1}\n${paras.filter((p) => p.trim()).join('\n')}${notes.trim() ? `\n\nSpeaker notes: ${notes.trim()}` : ''}`)
  }
  return out.join('\n\n')
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

export async function extractText(file: string): Promise<string> {
  const ext = extname(file).toLowerCase()
  if (ext === '.pdf') return extractPdfText(file)
  if (ext === '.docx') return extractDocxText(file)
  if (ext === '.pptx') return extractPptxText(file)
  return readFileSync(file, 'utf8')
}

/**
 * Turn source files into chunks for AI calls. PDFs go to Claude as files
 * (split by page range); everything else, or huge PDFs, become text.
 */
export async function prepareSources(files: string[], workDir: string): Promise<SourceChunk[]> {
  const chunks: SourceChunk[] = []
  for (const f of files) {
    const ext = extname(f).toLowerCase()
    const name = basename(f)
    if (ext === '.pdf') {
      let parts: Awaited<ReturnType<typeof splitPdf>> | null = null
      try {
        parts = await splitPdf(f, join(workDir, 'chunks'))
      } catch {
        parts = null
      }
      if (parts && parts.every((p) => statSync(p.file).size <= MAX_PDF_CHUNK_BYTES)) {
        for (const p of parts) {
          chunks.push({
            file: p.file,
            label: parts.length > 1 ? `${name} pages ${p.from}–${p.to}` : name,
            partInfo: parts.length > 1 ? `This file is pages ${p.from}–${p.to} of a ${p.total}-page document. Cover only pages ${p.from}–${p.to}.` : undefined
          })
        }
        continue
      }
      // Too big (or unreadable by pdf-lib): fall back to extracted text.
      const text = await extractPdfText(f)
      chunks.push(...textChunks(text, name))
      continue
    }
    const text = await extractText(f)
    chunks.push(...textChunks(text, name))
  }
  return chunks
}

/** Split long text on paragraph boundaries (~24k chars per chunk). */
export function textChunks(text: string, label: string, size = 24000): SourceChunk[] {
  if (text.length <= size) return [{ text, label }]
  const paras = text.split(/\n{2,}/)
  const out: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && cur.length + p.length > size) {
      out.push(cur)
      cur = ''
    }
    cur += (cur ? '\n\n' : '') + p
  }
  if (cur) out.push(cur)
  return out.map((t, i) => ({ text: t, label: `${label} part ${i + 1}/${out.length}`, partInfo: `This is part ${i + 1} of ${out.length} of the source. Cover only this part.` }))
}
