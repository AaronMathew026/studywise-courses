import { api, errorText } from './api'
import { chooseDialog, confirmDialog } from './dialogs'
import { toast, useStore } from './store'

/**
 * Add a week someone shared (a .studyweek file): say what's in it, ask where it
 * goes (one of your courses, or a new one), import it and open that course.
 * With `courseId` it goes straight into that course after a confirm.
 */
export async function importSharedWeek(opts: { file?: string; courseId?: string } = {}): Promise<void> {
  try {
    const p = await api.courses.previewWeek(opts.file ? { file: opts.file } : undefined)
    if (!p) return
    const what = `${p.written} of ${p.topics} topic${p.topics === 1 ? '' : 's'} written, ${p.cards} recall card${p.cards === 1 ? '' : 's'}, ${p.files.length} file${p.files.length === 1 ? '' : 's'}. Nothing is generated, so it costs no tokens.`
    let courseId: string | null = opts.courseId ?? null
    if (opts.courseId) {
      if (!(await confirmDialog(`Add “${p.week}” to this course?`, `From ${p.course}: ${what}`, { confirmText: 'Add week' }))) return
    } else {
      const courses = await api.courses.list()
      const same = courses.find((c) => c.name.trim().toLowerCase() === p.course.trim().toLowerCase())
      const choice = await chooseDialog(
        `Add “${p.week}” from ${p.course}`,
        [{ value: '', label: `A new course called “${p.course}”` }, ...courses.map((c) => ({ value: c.id, label: `Add to ${c.name}` }))],
        { message: what, confirmText: 'Add week', initial: same?.id ?? '' }
      )
      if (choice === null) return
      courseId = choice || null
    }
    const r = await api.courses.importWeek({ file: p.file, courseId })
    toast(`Added ${p.week}: ${r.topics} topic${r.topics === 1 ? '' : 's'} and ${r.cards} card${r.cards === 1 ? '' : 's'}`, 'good')
    useStore.getState().bump()
    useStore.getState().go({ name: 'course', id: r.courseId })
  } catch (e) {
    toast(errorText(e), 'bad')
  }
}

/** Save one week as a .studyweek file to send to someone. */
export async function shareWeek(weekId: string): Promise<void> {
  try {
    const r = await api.courses.exportWeek({ weekId })
    if (r) toast(`Saved ${r.week} (${r.written} written topic${r.written === 1 ? '' : 's'}). Send the file; they add it with “Add a shared week”.`, 'good')
  } catch (e) {
    toast(errorText(e), 'bad')
  }
}
