import { expect, test, type Page } from '@playwright/test'
import { connectorSlide, getConnectorRail } from '../src/lib/connector-movement'
import { editConnectors, getPhysicalConnectors } from '../src/lib/connector-selection'
import { attachPanel, createPanel, resolvePanels } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const saved = (page: Page): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
const fractions = (project: Project) => getPhysicalConnectors(project).filter(piece => piece.type === '150').map(piece => {
  const rail = getConnectorRail(piece.connection, resolvePanels(project), project.connections)!
  return (rail.along[piece.index] + connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    - rail.lower) / (rail.upper - rail.lower)
})

test('synth shelf width scales custom connector spacing and survives undo and reload', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles('resources/library-3d/user-projects/three-tier-synth-shelf.json')
  await expect.poll(async () => (await saved(page))?.name).toBe('Three-tier synth shelf')
  await page.getByRole('button', { name: 'Deep floor base', exact: true }).click()
  const before = await saved(page)
  const width = page.getByLabel('Width', { exact: true })
  await width.fill('1200')
  await width.press('Enter')
  await expect.poll(async () => (await saved(page)).panels[0].width).toBe(1200)
  const after = await saved(page)
  const original = fractions(before)
  fractions(after).forEach((fraction, index) => expect(fraction).toBeCloseTo(original[index], 7))
  expect(after.connectorOverrides).not.toEqual(before.connectorOverrides)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(after)
  await page.reload()
  expect(await saved(page)).toEqual(after)
})


test('shrinking a shared joint after hardware removal survives undo, redo, and reload',async({page})=>{
  const parent=createPanel({name:'Base',width:200,height:200,position:[0,0,0]})
  const joint=attachPanel({version:1,name:'Hardware shrink',panels:[parent],connections:[]},parent.id,
    createPanel({name:'Branch',width:200,height:200}),{type:'t',side:'top',offset:0,inset:0,flip:false,color:'#ffffff',count:4})
  const source=editConnectors(joint,getPhysicalConnectors(joint).slice(1).map(piece=>piece.id),{removed:true,color:'#123456'})
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({name:'hardware.playwood.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))})
  await expect.poll(async()=>(await saved(page))?.name,{timeout:15000}).toBe(source.name)
  await page.getByRole('button',{name:'Select all',exact:true}).click()
  const before=await saved(page)
  const width=page.getByLabel('Width',{exact:true})
  await width.fill('100')
  await width.press('Enter')
  await expect.poll(async()=>(await saved(page)).panels.map(panel=>panel.width)).toEqual([100,100,100])
  const after=await saved(page)
  expect(getPhysicalConnectors(after)).toHaveLength(1)
  expect(after.connectorOverrides).toEqual(before.connectorOverrides)
  expect(after.connections).toEqual(before.connections)
  await page.getByRole('button',{name:'Undo (⌘/Ctrl Z)'}).click()
  await expect.poll(()=>saved(page)).toEqual(before)
  await page.getByRole('button',{name:'Redo (⌘/Ctrl Shift Z)'}).click()
  await expect.poll(()=>saved(page)).toEqual(after)
  await page.reload()
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  expect(await saved(page)).toEqual(after)
})
