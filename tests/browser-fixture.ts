import { test as base } from '@playwright/test'

export { expect, type Page } from '@playwright/test'

// Scene helpers discover Vite's existing modules through Resource Timing entries.
// Keep startup requests available instead of importing a second Fiber instance.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => performance.setResourceTimingBufferSize(2000))
    await use(page)
  },
})
