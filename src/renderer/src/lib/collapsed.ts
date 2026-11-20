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

// ---------------------------------------------------------------------------
// Nested folders (notes can have folders inside folders).

type TreeFolder = { id: string; name: string; parent_id: string | null }

/** Folders depth-first, each level by name. A folder whose parent is gone counts as top-level. */
export function folderTree<F extends TreeFolder>(folders: F[]): { folder: F; depth: number }[] {
  const ids = new Set(folders.map((f) => f.id))
  const kids = new Map<string | null, F[]>()
  for (const f of folders) {
    const p = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null
    kids.set(p, [...(kids.get(p) ?? []), f])
  }
  const out: { folder: F; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const f of (kids.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))) {
      out.push({ folder: f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** The folder and everything inside it. */
export function withSubfolders(folders: TreeFolder[], id: string): Set<string> {
  const out = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
    }
  }
  return out
}

/** "Physics › Week 3" */
export function folderPath(folders: TreeFolder[], id: string): string {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const names: string[] = []
  for (let f = byId.get(id); f && names.length < 20; f = f.parent_id ? byId.get(f.parent_id) : undefined) names.unshift(f.name)
  return names.join(' › ')
}

export interface TreeGroup<T> extends FolderGroup<T> {
  depth: number
  /** Folder ids above this one, so collapsing a parent hides it. */
  ancestors: string[]
  /** Items in this folder and the folders inside it. */
  total: number
}

/** Items under their folders in tree order (folders with nothing in them, even deep down, are left out), then loose items. */
export function groupByFolderTree<T extends { folder_id: string | null }>(items: T[], folders: TreeFolder[]): TreeGroup<T>[] {
  const tree = folderTree(folders)
  const known = new Set(folders.map((f) => f.id))
  const direct = new Map<string, T[]>()
  for (const i of items) if (i.folder_id && known.has(i.folder_id)) direct.set(i.folder_id, [...(direct.get(i.folder_id) ?? []), i])
  const groups: TreeGroup<T>[] = []
  const stack: string[] = []
  for (const { folder, depth } of tree) {
    stack.length = depth
    const total = [...withSubfolders(folders, folder.id)].reduce((n, id) => n + (direct.get(id)?.length ?? 0), 0)
    if (total) groups.push({ folder, items: direct.get(folder.id) ?? [], depth, ancestors: [...stack], total })
    stack.push(folder.id)
  }
  const loose = items.filter((i) => !i.folder_id || !known.has(i.folder_id))
  if (loose.length) groups.push({ folder: null, items: loose, depth: 0, ancestors: [], total: loose.length })
  return groups
}

/** Items grouped by folder in folder order, then the ones in no folder. Empty folders are left out. */
export function groupByFolder<T extends { folder_id: string | null }>(items: T[], folders: { id: string; name: string }[]): FolderGroup<T>[] {
  const known = new Set(folders.map((f) => f.id))
  const groups: FolderGroup<T>[] = folders.map((f) => ({ folder: f, items: items.filter((i) => i.folder_id === f.id) })).filter((g) => g.items.length)
  const loose = items.filter((i) => !i.folder_id || !known.has(i.folder_id))
  if (loose.length) groups.push({ folder: null, items: loose })
  return groups
}
