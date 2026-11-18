/** Tiny promise semaphore so we never run more than N claude processes at once. */
export class Semaphore {
  private active = 0
  private waiters: (() => void)[] = []
  constructor(private limit: number) {}

  setLimit(n: number): void {
    this.limit = Math.max(1, n)
    this.pump()
  }

  get running(): number {
    return this.active
  }
  get waiting(): number {
    return this.waiters.length
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal)
    try {
      return await fn()
    } finally {
      this.active--
      this.pump()
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (this.active < this.limit) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener('abort', onAbort)
        this.active++
        resolve()
      }
      const onAbort = () => {
        this.waiters = this.waiters.filter((w) => w !== go)
        reject(Object.assign(new Error('Cancelled'), { kind: 'cancelled' }))
      }
      signal?.addEventListener('abort', onAbort)
      this.waiters.push(go)
    })
  }

  private pump(): void {
    while (this.active < this.limit && this.waiters.length > 0) this.waiters.shift()!()
  }
}
