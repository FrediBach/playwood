import { test, expect, type Page } from '@playwright/test'

async function openGuide(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Open building guide', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Build with confidence.' })).toBeVisible()
}

test('every building technique has four illustrated steps without another WebGL viewport', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openGuide(page)
  const guides = page.locator('[data-guide-id]')
  await expect(guides).toHaveCount(24)
  const ids = await guides.evaluateAll(elements => elements.map(element => element.getAttribute('data-guide-id')!))
  const article = page.getByRole('article')

  for (const id of ids) {
    await page.locator(`[data-guide-id="${id}"]`).click()
    await expect(page.locator(`[data-guide-id="${id}"]`)).toHaveAttribute('aria-current', 'page')
    await expect(article.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    await expect(article.getByRole('navigation', { name: 'Lesson steps' }).getByRole('button')).toHaveCount(4)
    for (let step = 1; step <= 4; step++) {
      await expect(article.getByRole('button', { name: new RegExp(`^Step ${step}:`) })).toHaveAttribute('aria-current', 'step')
      const illustration = article.locator('.guide-illustration svg[role="img"]')
      await expect(illustration).toBeVisible()
      await expect(illustration).toHaveAccessibleName(/\S+/)
      expect(await illustration.locator('polygon, path').count()).toBeGreaterThan(0)
      await expect(article.getByText('What you should see', { exact: true })).toBeVisible()
      if (step < 4) await article.getByRole('button', { name: 'Next step', exact: true }).click()
    }
    await expect(article.getByRole('button', { name: 'Read again', exact: true })).toBeVisible()
    await expect(article.getByText('Keep building', { exact: true })).toBeVisible()
  }
  await expect(page.locator('canvas')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('search, direct step selection, related guides and keyboard reference are usable', async ({ page }) => {
  await openGuide(page)
  const search = page.getByRole('searchbox', { name: 'Search guides' })
  await search.fill('auto-add')
  await expect(page.locator('[data-guide-id="auto-connect"]')).toBeVisible()
  await search.fill('no-such-furniture-technique-987')
  await expect(page.getByText('No matching techniques.', { exact: true })).toBeVisible()
  await expect(page.locator('[data-guide-id]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show all guides', exact: true }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('[data-guide-id]')).toHaveCount(24)

  await page.locator('[data-guide-id="attach"]').click()
  const image = page.locator('.guide-illustration svg[role="img"]')
  const before = await image.locator('polygon, path').evaluateAll(elements => elements.map(element => element.outerHTML).join(''))
  await page.getByRole('button', { name: /^Step 3:/ }).click()
  await expect(page.locator('#guide-step-title')).toBeFocused()
  expect(await image.locator('polygon, path').evaluateAll(elements => elements.map(element => element.outerHTML).join(''))).not.toBe(before)
  await page.getByRole('button', { name: /^Step 4:/ }).click()
  await page.locator('.guide-related button').first().click()
  await expect(page.getByRole('button', { name: /^Step 1:/ })).toHaveAttribute('aria-current', 'step')

  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'A little less clicking.' })).toBeVisible()
  await expect(page.getByText('Rotate selection 90°', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Learn the connector types' }).click()
  await expect(page.locator('[data-guide-id="angles"]')).toHaveAttribute('aria-current', 'page')
})

test('reading help preserves the project and resumes the last step after reopening', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('playwood-studio-project-v1'))).not.toBeNull()
  const project = await page.evaluate(() => localStorage.getItem('playwood-studio-project-v1'))
  const canvas = page.getByLabel('3D preview canvas', { exact: true })
  await page.getByRole('button', { name: 'Open building guide', exact: true }).click()
  await page.locator('[data-guide-id="close-hole"]').click()
  await page.getByRole('button', { name: /^Step 3:/ }).click()
  const stepTitle = await page.locator('#guide-step-title').textContent()
  // Even a canvas event must be ignored while the guide owns keyboard input.
  await canvas.dispatchEvent('keydown', { key: 'ArrowUp', bubbles: true })
  await canvas.dispatchEvent('keydown', { key: 'z', bubbles: true })
  await page.keyboard.press('Delete')
  await page.keyboard.press('ControlOrMeta+d')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('playwood-studio-project-v1'))).toBe(project)
  await page.getByRole('button', { name: 'Open building guide', exact: true }).click()
  await expect(page.locator('[data-guide-id="close-hole"]')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: /^Step 3:/ })).toHaveAttribute('aria-current', 'step')
  await expect(page.locator('#guide-step-title')).toHaveText(stepTitle!)
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('button', { name: 'Open building guide', exact: true })).toBeFocused()
})

for (const width of [390, 800]) {
  test(`guide navigation and lesson content fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await openGuide(page)
    const dialog = page.getByRole('dialog')
    await expect(page.getByRole('button', { name: 'Close dialog' })).toBeInViewport()
    if (width <= 760) {
      await page.getByRole('button', { name: 'Browse 24 techniques' }).click()
      await expect(page.getByRole('searchbox', { name: 'Search guides' })).toBeVisible()
    }
    await page.locator('[data-guide-id="attach"]').click()
    if (width <= 760) await expect(page.getByRole('button', { name: 'Browse 24 techniques' })).toHaveAttribute('aria-expanded', 'false')
    await page.getByRole('button', { name: /^Step 2:/ }).click()
    await expect(page.locator('.guide-illustration svg[role="img"]')).toBeVisible()
    await page.getByRole('button', { name: 'Next step', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Step 3:/ })).toHaveAttribute('aria-current', 'step')
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    expect(await page.locator('.guide-article').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
    await page.getByRole('button', { name: 'Close dialog' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  })
}
