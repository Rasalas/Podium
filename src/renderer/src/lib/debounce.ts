/** Debounced saver for one text value that belongs to one slide. Flush before switching slides. */
export function createDebouncedSave<T>(save: (target: T, value: string) => Promise<unknown>, delay = 600) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { target: T, value: string } | undefined
  async function flush() {
    clearTimeout(timer)
    timer = undefined
    const job = pending
    pending = undefined
    if (job)
      await save(job.target, job.value)
  }
  return {
    schedule(target: T, value: string) {
      pending = { target, value }
      clearTimeout(timer)
      timer = setTimeout(() => void flush(), delay)
    },
    flush,
    get pending() {
      return Boolean(pending)
    },
    cancel() {
      clearTimeout(timer)
      pending = undefined
    },
  }
}
