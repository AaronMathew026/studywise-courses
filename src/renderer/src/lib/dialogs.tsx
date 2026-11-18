import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Button, Input, Modal, Select } from '../components/ui'

interface Ask {
  title: string
  label?: string
  initial?: string
  confirmText?: string
  danger?: boolean
  /** "confirm" shows only a message; "text" asks for a string; "choose" picks from options. */
  kind: 'text' | 'confirm' | 'choose'
  message?: string
  options?: { value: string; label: string }[]
  resolve: (v: string | null) => void
}

const useDialog = create<{ ask: Ask | null; set: (a: Ask | null) => void }>((set) => ({ ask: null, set: (ask) => set({ ask }) }))

export function askText(title: string, opts: { label?: string; initial?: string; confirmText?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => useDialog.getState().set({ title, kind: 'text', ...opts, resolve }))
}
export function confirmDialog(title: string, message?: string, opts: { confirmText?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => useDialog.getState().set({ title, kind: 'confirm', message, ...opts, resolve: (v) => resolve(v !== null) }))
}
export function chooseDialog(title: string, options: { value: string; label: string }[], opts: { label?: string; confirmText?: string; initial?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => useDialog.getState().set({ title, kind: 'choose', options, ...opts, resolve }))
}

export function DialogHost() {
  const ask = useDialog((s) => s.ask)
  const set = useDialog((s) => s.set)
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ask) {
      setValue(ask.initial ?? ask.options?.[0]?.value ?? '')
      setTimeout(() => ref.current?.select(), 30)
    }
  }, [ask])
  if (!ask) return null
  const close = (v: string | null) => {
    set(null)
    ask.resolve(v)
  }
  const ok = () => {
    if (ask.kind === 'text' && !value.trim()) return
    close(ask.kind === 'confirm' ? 'ok' : value.trim())
  }
  return (
    <Modal
      open
      onClose={() => close(null)}
      title={ask.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button variant={ask.danger ? 'danger' : 'primary'} onClick={ok}>
            {ask.confirmText ?? 'OK'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          ok()
        }}
        className="flex flex-col gap-3"
      >
        {ask.message && <p className="text-muted">{ask.message}</p>}
        {ask.kind === 'text' && <Input ref={ref} autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={ask.label} />}
        {ask.kind === 'choose' && (
          <Select autoFocus value={value} onChange={(e) => setValue(e.target.value)}>
            {ask.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
