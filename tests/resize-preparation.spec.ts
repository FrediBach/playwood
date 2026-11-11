import { test, expect } from './browser-fixture'
import { synthStorageShelfProject } from '../src/lib/synth-storage-shelf'

test('complex arrow and range preparation runs off-thread while the page remains responsive', async ({ page }) => {
  await page.addInitScript(() => {
    type Job = { kind: string; startTicks: number; ticks?: number; finished?: boolean; stopped?: boolean }
    const state = { ticks: 0, jobs: [] as Job[] }
    Object.assign(window, { resizePreparationReport: state })
    setInterval(() => state.ticks++, 10)
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      job?: Job
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', () => {
          if (this.job) { this.job.finished = true; this.job.ticks = state.ticks - this.job.startTicks }
        })
      }
      postMessage(message: unknown, options?: StructuredSerializeOptions) {
        const request = message as { kind?: string }
        if (request.kind === 'handles' || request.kind === 'ranges') {
          this.job = { kind: request.kind, startTicks: state.ticks }
          state.jobs.push(this.job)
        }
        super.postMessage(message, options)
      }
      terminate() { if (this.job) this.job.stopped = true; super.terminate() }
    }
  })
  const source = synthStorageShelfProject()
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'complex.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) })
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!)?.name), { timeout: 15000 }).toBe(source.name)
  await page.getByRole('button', { name: source.panels[0].name, exact: true }).click()
  await expect(page.locator('[data-resize-handle="panel-width-positive"]')).toBeVisible({ timeout: 15000 })
  const report = () => page.evaluate(() => (window as unknown as { resizePreparationReport: { jobs: { kind: string; ticks?: number; finished?: boolean; stopped?: boolean }[] } }).resizePreparationReport.jobs)
  for (const kind of ['handles', 'ranges']) {
    await expect.poll(async () => (await report()).some(job => job.kind === kind && job.finished && job.stopped), { timeout: 15000 }).toBe(true)
    expect((await report()).find(job => job.kind === kind && job.finished)!.ticks).toBeGreaterThan(0)
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))).toEqual(source)
})
