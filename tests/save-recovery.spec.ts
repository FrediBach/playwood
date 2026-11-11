import { test, expect } from '@playwright/test'

const key='playwood-studio-project-v1'
for(const bytes of ['{broken json', JSON.stringify({version:1,panels:[],connections:'invalid'})]) {
  test(`preserves unreadable startup save: ${bytes}`,async({page})=>{
    await page.addInitScript(({key,bytes})=>{
      if(!sessionStorage.getItem('recovery-seeded')) {localStorage.setItem(key,bytes);sessionStorage.setItem('recovery-seeded','true')}
    },{key,bytes})
    await page.goto('/')
    await expect(page.getByRole('alert')).toContainText('Your browser save could not be opened.')
    await page.waitForTimeout(700)
    expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(bytes)
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')))
    expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(bytes)
    const download=page.waitForEvent('download')
    await page.getByRole('button',{name:'Download original save'}).click()
    const stream=await (await download).createReadStream()
    const chunks:Buffer[]=[]
    for await(const chunk of stream!) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toBe(bytes)
    await page.getByRole('button',{name:'Reset browser save'}).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(({key,bytes})=>Object.keys(localStorage).some(k=>k.startsWith(`${key}-recovery-`)&&localStorage.getItem(k)===bytes),{key,bytes})).toBe(true)
    await page.reload()
    await expect(page.locator('.panel-list-row').first()).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
}
