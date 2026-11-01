import { expect, type Page } from '@playwright/test'

/** Open the inspector's named sections through the same controls as a user. */
export async function openInspectorSection(page: Page, ...titles: string[]) {
  for (const title of titles) {
    const summary = page.locator('.right-sidebar summary').and(page.getByLabel(title, { exact: true }))
    await expect(summary).toBeVisible()
    const details = summary.locator('..')
    if (!await details.evaluate(element => element.hasAttribute('open'))) await summary.click()
    await expect(details).toHaveAttribute('open', '')
  }
}
