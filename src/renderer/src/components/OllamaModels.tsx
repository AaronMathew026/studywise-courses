import { useEffect, useState } from 'react'
import type { OllamaModel } from '@shared/types'
import { api, errorText } from '../lib/api'

/** Saved (starred) models first, then everything else the server lists. */
export function OllamaModelOptions({ models, saved, current }: { models: OllamaModel[]; saved: string[]; current?: string }) {
  const names = models.map((m) => m.name)
  const savedList = saved.filter(Boolean)
  const rest = names.filter((n) => !savedList.includes(n))
  const extra = current && !names.includes(current) && !savedList.includes(current) ? [current] : []
  return (
    <>
      {extra.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      {savedList.length > 0 && (
        <optgroup label="Saved models">
          {savedList.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </optgroup>
      )}
      {rest.length > 0 && (
        <optgroup label={savedList.length ? 'All models' : 'Models'}>
          {rest.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </optgroup>
      )}
    </>
  )
}

/** The server's model list (cached in the main process for 10 minutes). */
export function useOllamaModels(enabled: boolean) {
  const [models, setModels] = useState<OllamaModel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = async (refresh = false) => {
    setLoading(true)
    try {
      setModels(await api.ollama.models({ refresh }))
      setError(null)
    } catch (e) {
      setError(errorText(e))
      setModels((m) => m ?? [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (enabled) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
  return { models, error, loading, load }
}
