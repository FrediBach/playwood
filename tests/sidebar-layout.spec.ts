import { test, expect, type Page } from '@playwright/test'

async function expectWorkspaceUsable(page: Page) {
  const workspace = page.getByRole('main', { name: '3D assembly workspace' })
  await expect(workspace).toBeVisible()
  await expect.poll(async () => (await workspace.boundingBox())?.width ?? 0).toBeGreaterThan(200)
  await expect(page.getByRole('button', { name: 'Studio', exact: true })).toBeInViewport()
  await expect(page.locator('canvas')).toBeVisible()
}

for (const width of [1600, 1440, 800, 390]) {
  test(`sidebars can close and reopen without losing the workspace at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/')
    const panels = page.getByRole('complementary', { name: 'Project panels' })
    const inspector = page.getByRole('complementary', { name: 'Panel inspector' })

    if (width <= 900) await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
    await page.getByRole('button', { name: 'Collapse panel list', exact: true }).click()
    await expect(panels).toBeHidden()
    await expectWorkspaceUsable(page)
    if (width <= 680) await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
    await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
    await expect(inspector).toBeHidden()
    await expectWorkspaceUsable(page)

    await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
    await expect(panels).toBeVisible()
    await expectWorkspaceUsable(page)
    // Close the overlay so it cannot cover the inspector opener on phones.
    if (width <= 900) await page.getByRole('button', { name: 'Collapse panel list', exact: true }).click()
    await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
    await expect(inspector).toBeVisible()
    await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Bottom shelf')
  })
}
