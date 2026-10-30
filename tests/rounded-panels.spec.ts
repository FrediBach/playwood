import { test, expect } from '@playwright/test'

test('corner radius edits persist and support undo', async ({ page }) => {
  await page.goto('/')
  await page.locator('.panel-list-select').first().click()
  const radius = page.getByRole('spinbutton', { name: 'Corner radius', exact: true })
  await expect(radius).toHaveValue('0')
  await radius.fill('60')
  await radius.press('Tab')
  await expect(radius).toHaveValue('60')
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(radius).toHaveValue('0')
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect(radius).toHaveValue('60')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await page.locator('.panel-list-select').first().click()
  await expect(radius).toHaveValue('60')
})
