import { useCallback, useState } from 'react'

const KEY = 'sw.collapsedFolders'

function read(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Which folders are collapsed in grouped lists. Remembered across launches; shared by decks and notes (folder ids are unique). */
export function useCollapsedFolders(): { isCollapsed: (id: string) => boolean; toggle: (id: string) => void } {
  const [set, setSet] = useState(read)
  const toggle = useCallback((id: string) => {
    setSet((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]))
      } catch {
        /* storage unavailable: still works for this session */
      }
      return next
    })
  }, [])
  return { isCollapsed: (id) => set.has(id), toggle }
}

export interface FolderGroup<T> {
  /** null for items not in any folder. */
  folder: { id: string; name: string } | null
  items: T[]
}

/** Items grouped by folder in folder order, then the ones in no folder. Empty folders are left out. */
export function groupByFolder<T extends { folder_id: string | null }>(items: T[], folders: { id: string; name: string }[]): FolderGroup<T>[] {
  const known = new Set(folders.map((f) => f.id))
  const groups: FolderGroup<T>[] = folders.map((f) => ({ folder: f, items: items.filter((i) => i.folder_id === f.id) })).filter((g) => g.items.length)
  const loose = items.filter((i) => !i.folder_id || !known.has(i.folder_id))
  if (loose.length) groups.push({ folder: null, items: loose })
  return groups
}
