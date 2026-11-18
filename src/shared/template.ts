/** Replace {{name}} placeholders. Unknown variables become empty strings. */
export function renderTemplate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k]
    if (v === undefined || v === null) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    return JSON.stringify(v, null, 2)
  })
}

export function templateVariables(tpl: string): string[] {
  const out = new Set<string>()
  for (const m of tpl.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) out.add(m[1])
  return [...out]
}
