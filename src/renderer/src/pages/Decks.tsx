import { useEffect, useMemo, useState } from 'react'
import { Folder as FolderIcon, FolderPlus, Plus, Layers, MoreHorizontal, Upload, Search, Trash2, Pencil, FolderInput } from 'lucide-react'
import type { Deck, Folder } from '@shared/types'
import { useStore, toast } from '../lib/store'
import { api, errorText } from '../lib/api'
import { runCommand, useCommands } from '../lib/commands'
import { askText, confirmDialog, chooseDialog } from '../lib/dialogs'
import { Shell, PageTitle } from '../components/Shell'
import { Button, Card, Empty, Input, Menu, MenuItem, Pill, ProgressBar, cx } from '../components/ui'

type DeckRow = Deck & { card_count: number; due_count: number }

export function Decks({ folderId }: { folderId: string | null }) {
  const go = useStore((s) => s.go)
  const version = useStore((s) => s.version)
  const rail = useStore((s) => s.rail)
  const [decks, setDecks] = useState<DeckRow[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)

  const load = () => {
    void api.decks.list().then(setDecks)
    void api.folders.list({ kind: 'deck' }).then(setFolders)
  }
  useEffect(load, [version])

  const shown = useMemo(
    () => decks.filter((d) => (folderId ? d.folder_id === folderId : true) && d.name.toLowerCase().includes(q.toLowerCase())),
    [decks, folderId, q]
  )
  const folder = folders.find((f) => f.id === folderId)

  const renameDeck = async (d: DeckRow) => {
    const name = await askText('Rename deck', { initial: d.name, confirmText: 'Rename' })
    if (name) await api.decks.update({ id: d.id, patch: { name } }).then(load)
  }
  const moveDeck = async (d: DeckRow) => {
    const v = await chooseDialog('Move to folder', [{ value: '', label: 'No folder' }, ...folders.map((f) => ({ value: f.id, label: f.name }))], { initial: d.folder_id ?? '', confirmText: 'Move' })
    if (v !== null) await api.decks.update({ id: d.id, patch: { folder_id: v || null } }).then(load)
  }
  const deleteDeck = async (d: DeckRow) => {
    if (await confirmDialog(`Delete “${d.name}”?`, `${d.card_count} cards will be deleted. This can’t be undone.`, { confirmText: 'Delete', danger: true })) {
      await api.decks.delete({ id: d.id })
      toast('Deck deleted', 'good')
      load()
    }
  }

  useCommands(
    {
      'list.down': () => setSel((s) => Math.min(shown.length - 1, s + 1)),
      'list.up': () => setSel((s) => Math.max(0, s - 1)),
      'list.open': () => shown[sel] && go({ name: 'deck', id: shown[sel].id }),
      'item.rename': () => shown[sel] && renameDeck(shown[sel]),
      'list.delete': () => shown[sel] && deleteDeck(shown[sel]),
      'go.nextDeck': () => setSel((s) => Math.min(shown.length - 1, s + 1)),
      'go.prevDeck': () => setSel((s) => Math.max(0, s - 1))
    },
    [shown, sel]
  )

  return (
    <div className="flex min-h-full">
      <aside className={cx('shrink-0 overflow-hidden border-r border-line transition-[width,opacity] duration-500 ease-out-soft max-md:hidden', rail ? 'w-[248px] opacity-100' : 'w-0 opacity-0')}>
        <div className="flex w-[248px] flex-col gap-1 p-4">
          <div className="mb-1 flex items-center justify-between px-2 text-[0.75rem] font-semibold text-muted">
            Folders
            <button onClick={() => runCommand('folder.new')} className="rounded-full p-1 hover:bg-surface-2" title="New folder (⇧⌥⌘N)">
              <FolderPlus className="size-4" />
            </button>
          </div>
          <RailItem active={!folderId} onClick={() => go({ name: 'decks' })} icon={<Layers className="size-4" />} label="All decks" count={decks.length} />
          {folders.map((f) => (
            <RailItem
              key={f.id}
              active={folderId === f.id}
              onClick={() => go({ name: 'decks', folderId: f.id })}
              icon={<FolderIcon className="size-4" />}
              label={f.name}
              count={decks.filter((d) => d.folder_id === f.id).length}
              onRename={async () => {
                const name = await askText('Rename folder', { initial: f.name })
                if (name) await api.folders.rename({ id: f.id, name }).then(load)
              }}
              onDelete={async () => {
                if (await confirmDialog(`Delete folder “${f.name}”?`, 'Decks inside are kept.', { danger: true, confirmText: 'Delete' })) {
                  await api.folders.delete({ id: f.id })
                  go({ name: 'decks' })
                  load()
                }
              }}
            />
          ))}
        </div>
      </aside>
      <Shell className="flex-1">
        <PageTitle
          eyebrow="Library"
          title={folder?.name ?? 'Decks'}
          actions={
            <>
              <Button icon={<Upload className="size-4" />} onClick={() => runCommand('io.importDeck')} kbd="io.importDeck">
                Import
              </Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => runCommand('deck.new')}>
                New deck
              </Button>
            </>
          }
        />
        <div className="relative mb-5">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter decks…" className="pl-10" />
        </div>
        {shown.length === 0 ? (
          <Empty icon={<Layers className="size-6" />} title={decks.length ? 'No decks match' : 'No decks yet'}>
            {decks.length ? 'Try another filter.' : 'Create a deck, import a StudySmarter export, or drop a PDF to generate flashcards with AI.'}
            {!decks.length && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => runCommand('gen.cards')}>
                  Generate with AI
                </Button>
                <Button onClick={() => runCommand('deck.new')}>New deck</Button>
              </div>
            )}
          </Empty>
        ) : (
          <div className="stagger grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
            {shown.map((d, i) => (
              <Card key={d.id} onClick={() => go({ name: 'deck', id: d.id })} className={cx('group relative flex min-h-[170px] flex-col', i === sel && 'ring-2 ring-accent/60')}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-accent">
                    <Layers className="size-5" />
                  </span>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Menu
                      trigger={(toggle) => (
                        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Deck menu">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      )}
                    >
                      {(close) => (
                        <>
                          <MenuItem icon={<Pencil className="size-4" />} onClick={() => (close(), renameDeck(d))}>
                            Rename
                          </MenuItem>
                          <MenuItem icon={<FolderInput className="size-4" />} onClick={() => (close(), moveDeck(d))}>
                            Move to folder
                          </MenuItem>
                          <MenuItem icon={<Trash2 className="size-4" />} danger onClick={() => (close(), deleteDeck(d))}>
                            Delete
                          </MenuItem>
                        </>
                      )}
                    </Menu>
                  </div>
                </div>
                <div className="mt-auto pt-4">
                  <div className="truncate text-[1.1rem] font-semibold">{d.name}</div>
                  <div className="mt-1 flex items-center gap-2 text-[0.85rem] text-muted">
                    {d.card_count} cards {d.due_count > 0 && <Pill tone="accent">{d.due_count} due</Pill>}
                  </div>
                  <ProgressBar value={d.card_count ? 1 - d.due_count / d.card_count : 0} className="mt-3 h-1.5" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </Shell>
    </div>
  )
}

export function RailItem({
  active,
  onClick,
  icon,
  label,
  count,
  onRename,
  onDelete
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count?: number
  onRename?: () => void
  onDelete?: () => void
}) {
  return (
    <div className={cx('group flex items-center rounded-full transition-colors duration-300', active ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[0.92rem] font-medium">
        <span className={active ? 'text-accent' : 'text-muted'}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count !== undefined && <span className="text-[0.8rem] text-muted">{count}</span>}
      </button>
      {(onRename || onDelete) && (
        <span className="hidden pr-1 group-hover:flex">
          {onRename && (
            <button onClick={onRename} className="rounded-full p-1.5 text-muted hover:text-ink" aria-label="Rename">
              <Pencil className="size-3.5" />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="rounded-full p-1.5 text-muted hover:text-bad" aria-label="Delete">
              <Trash2 className="size-3.5" />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

export function errorToast(e: unknown) {
  toast(errorText(e), 'bad')
}
