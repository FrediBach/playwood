import { expect, test } from '@playwright/test'
import { createPanel } from '../src/lib/model'
import type { Project } from '../src/lib/types'
const key = 'playwood-studio-project-v1'
const project: Project = { version: 1, name: 'Equal sizes', connections: [], panels: [500,510,520].map((width,i) => createPanel({id:`p${i}`,name:`Board ${i+1}`,width,height:300,position:[i*1000,500,0]})) }
for (const width of [1440,390]) test(`equal sizes review, cancellation, history and persistence at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:1000})
  await page.addInitScript(({key,project}) => { if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify(project)) },{key,project})
  await page.goto('/')
  const canvas = page.getByLabel('3D preview canvas',{exact:true})
  const open = async () => { await canvas.focus(); await page.keyboard.press('Shift+F10') }
  await open()
  await expect(page.getByRole('menuitem',{name:'Make sizes equal',exact:true})).toHaveAttribute('aria-disabled','true')
  await page.keyboard.press('Escape')
  await canvas.focus(); await page.keyboard.press('ControlOrMeta+a')
  await open(); await page.getByRole('menuitem',{name:'Make sizes equal',exact:true}).click()
  await expect(page.getByRole('table',{name:'Selected panel sizes'})).toContainText('520')
  await page.getByRole('radio',{name:'510 mm',exact:true}).check()
  await page.keyboard.press('Escape')
  const sizes = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).panels.map((p: {width:number}) => p.width),key)
  expect(await sizes()).toEqual([500,510,520])
  await open(); await page.getByRole('menuitem',{name:'Make sizes equal',exact:true}).click()
  await page.getByRole('radio',{name:'510 mm',exact:true}).check()
  const input = page.getByRole('spinbutton',{name:'Shared width',exact:true})
  await expect(input).toHaveValue('510')
  await input.fill('515.25')
  await input.press('Enter')
  await expect(page.getByRole('radio',{name:'510 mm',exact:true})).not.toBeChecked()
  await expect(page.getByRole('table',{name:'Affected panel sizes and positions'})).toContainText('515.25')
  await page.getByRole('button',{name:'Apply equal sizes',exact:true}).click()
  await expect.poll(sizes).toEqual([515.25,515.25,515.25])
  await canvas.focus(); await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(sizes).toEqual([500,510,520])
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(sizes).toEqual([515.25,515.25,515.25])
  await page.reload(); expect(await sizes()).toEqual([515.25,515.25,515.25])
})
