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
    const panels = page.locator('aside[aria-label="Project panels"]')
    const inspector = page.locator('aside[aria-label="Inspector"]')

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
    if(width>900)await expectWorkspaceUsable(page)
    // Close the overlay so it cannot cover the inspector opener on phones.
    if (width <= 900) await page.getByRole('button', { name: 'Collapse panel list', exact: true }).click()
    await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
    await expect(inspector).toBeVisible()
    await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Bottom shelf')
  })
}

for(const [width,name,open,close] of [
  [390,'Inspector','Open inspector','Collapse inspector'],
  [390,'Project panels','Open panel list','Collapse panel list'],
  [800,'Project panels','Open panel list','Collapse panel list'],
] as const) {
  test(`${name} drawer has a keyboard lifecycle at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:844})
    await page.goto('/')
    const opener=page.getByRole('button',{name:open,exact:true})
    await opener.focus()
    await page.keyboard.press('Enter')
    const drawer=page.getByRole('dialog',{name,exact:true})
    await expect(drawer).toBeVisible()
    await expect.poll(()=>drawer.evaluate(node=>node.contains(document.activeElement))).toBe(true)
    expect(await page.locator('main').evaluate(node=>node.inert)).toBe(true)
    const first=drawer.locator('button').first()
    await first.focus()
    await page.keyboard.press('Shift+Tab')
    await expect.poll(()=>drawer.evaluate(node=>node.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Tab')
    await expect(first).toBeFocused()
    for(let index=0;index<12;index++) {
      await page.keyboard.press('Tab')
      await expect.poll(()=>drawer.evaluate(node=>node.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await page.locator('main').evaluate(node=>node.inert)).toBe(false)
    await page.keyboard.press('Enter')
    await page.getByRole('button',{name:close,exact:true}).click()
    await expect(opener).toBeFocused()
    // Closing did not clear the selected panel.
    if(name==='Inspector') {
      await page.keyboard.press('Enter')
      await expect(page.getByLabel('Panel name',{exact:true})).toHaveValue('Bottom shelf')
    }
  })
}

test('nested filter and project dialogs cancel before the phone drawer',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.goto('/')
  await page.getByRole('button',{name:'Open panel list',exact:true}).click()
  const drawer=page.getByRole('dialog',{name:'Project panels',exact:true})
  await page.getByRole('button',{name:'Filter panels',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'Filter panels',exact:true})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeVisible()
  await expect(page.getByRole('button',{name:'Filter panels',exact:true})).toBeFocused()
  await drawer.getByRole('button',{name:'Add a panel',exact:false}).click()
  await expect(page.getByRole('dialog',{name:'Bring your own panel.',exact:true})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog',{name:'Bring your own panel.',exact:true})).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await expect.poll(()=>drawer.evaluate(node=>node.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'Open panel list',exact:true})).toBeFocused()
})

test('attachment cancellation precedes closing and desktop resizing releases the trap',async({page})=>{
  await page.setViewportSize({width:390,height:844})
  await page.goto('/')
  await page.getByRole('button',{name:'Open inspector',exact:true}).click()
  const drawer=page.getByRole('dialog',{name:'Inspector',exact:true})
  await drawer.getByRole('button',{name:'Attach a panel',exact:true}).click()
  await expect(page.getByRole('button',{name:'Cancel preview',exact:true})).toBeVisible()
  await page.getByLabel('Width',{exact:true}).focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'Cancel preview',exact:true})).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await expect(page.getByLabel('Panel name',{exact:true})).toHaveValue('Bottom shelf')
  await page.setViewportSize({width:1200,height:844})
  await expect(page.getByRole('complementary',{name:'Inspector',exact:true})).toBeVisible()
  expect(await page.locator('main').evaluate(node=>node.inert)).toBe(false)
  await page.locator('canvas').focus()
  await expect(page.locator('canvas')).toBeFocused()
})
