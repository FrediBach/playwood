import { test, expect, type Page } from '@playwright/test'
import { createPanel } from '../src/lib/model'
import type { Panel } from '../src/lib/types'

async function importPanels(page:Page, panels:Panel[]) {
  await page.goto('/')
  await page.getByRole('button',{name:'Export project',exact:true}).click()
  await page.getByLabel('Import project file').setInputFiles({name:'selection.playwood.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,name:'Selection test',panels,connections:[]}))})
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

test('modifier and checkbox selections edit shared values in one undo step',async({page})=>{
  await page.goto('/')
  await page.locator('.panel-list-select').nth(1).click({modifiers:['Shift']})
  await expect(page.getByRole('heading',{name:'2 panels selected'})).toBeVisible()
  await expect(page.getByLabel('Width',{exact:true})).toBeDisabled()
  await expect(page.getByLabel('Width',{exact:true})).toHaveAttribute('placeholder','Mixed')
  await expect(page.getByLabel('Height',{exact:true})).toBeEnabled()
  await expect(page.getByLabel('Panel name')).toBeDisabled()
  await expect(page.getByRole('button',{name:'Attach',exact:true})).toBeDisabled()
  await page.getByLabel('Thickness',{exact:true}).fill('19')
  await page.getByLabel('Thickness',{exact:true}).press('Tab')
  await page.getByRole('button',{name:'Undo (⌘/Ctrl Z)'}).click()
  await expect(page.getByLabel('Thickness',{exact:true})).toHaveValue('18')
  await page.getByRole('button',{name:'Redo (⌘/Ctrl Shift Z)'}).click()
  await expect(page.getByLabel('Thickness',{exact:true})).toHaveValue('19')
  await page.screenshot({path:'test-results/studio-multiselect.png'})
  for(const index of [0,1]) {
    await page.locator('.panel-list-select').nth(index).click()
    await expect(page.getByLabel('Thickness',{exact:true})).toHaveValue('19')
  }
  await page.locator('.panel-list-select').nth(2).click()
  await expect(page.getByLabel('Thickness',{exact:true})).toHaveValue('18')
  await page.getByRole('checkbox',{name:'Select Bottom shelf',exact:true}).check()
  await expect(page.getByRole('heading',{name:'2 panels selected'})).toBeVisible()
  await expect(page.getByLabel('Thickness',{exact:true})).toBeDisabled()
  await page.getByRole('checkbox',{name:'Select Bottom shelf',exact:true}).uncheck()
  await expect(page.getByLabel('Panel name')).toHaveValue('Right side')
})

test('mixed finishes, surfaces and spacing remain unchanged during common edits',async({page})=>{
  const panels=[
    createPanel({name:'Warm panel',width:600,color:'#bc6c50',pattern:'pegboard',holeSpacing:40,position:[-400,400,0]}),
    createPanel({name:'Cool panel',width:800,color:'#778b99',pattern:'pegboard',holeSpacing:60,position:[400,400,0]}),
    createPanel({name:'Solid panel',width:600,color:'#e8e5db',pattern:'solid',position:[0,1000,0]}),
  ]
  await importPanels(page,panels)
  await page.locator('.panel-list-select').nth(1).click({modifiers:['ControlOrMeta']})
  await expect(page.getByLabel('Custom finish color')).toBeDisabled()
  await expect(page.getByRole('button',{name:'Chalk finish'})).toBeDisabled()
  await expect(page.getByLabel('Spacing',{exact:true})).toBeDisabled()
  await page.getByLabel('Material',{exact:true}).selectOption('oak')
  await page.getByLabel('Height',{exact:true}).fill('400')
  await page.getByLabel('Height',{exact:true}).press('Tab')
  for(const [index,color,pitch] of [[0,'#bc6c50','40'],[1,'#778b99','60']] as const) {
    await page.locator('.panel-list-select').nth(index).click()
    await expect(page.getByLabel('Custom finish color')).toHaveValue(color)
    await expect(page.getByLabel('Spacing',{exact:true})).toHaveValue(pitch)
    await expect(page.getByLabel('Material',{exact:true})).toHaveValue('oak')
    await expect(page.getByLabel('Height',{exact:true})).toHaveValue('400')
  }
  await page.locator('.panel-list-select').nth(2).click({modifiers:['Shift']})
  await expect(page.getByRole('button',{name:'Solid',exact:true})).toBeDisabled()
  await expect(page.getByRole('button',{name:'Pegboard',exact:true})).toBeDisabled()
  await expect(page.getByLabel('Material',{exact:true})).toBeDisabled()
})

test('3D multi-selection and common free-placement axes work',async({page})=>{
  await importPanels(page,[createPanel({name:'Left board',width:400,height:400,position:[-300,400,0]}),createPanel({name:'Right board',width:400,height:400,position:[300,400,0]})])
  await page.getByRole('combobox',{name:'Camera view'}).selectOption('front')
  await page.getByRole('button',{name:'Fit assembly (F)'}).click()
  const canvas=page.locator('canvas')
  await expect.poll(()=>canvas.evaluate(canvas=>(canvas as HTMLCanvasElement).toDataURL().length)).toBeGreaterThan(10000)
  const box=(await canvas.boundingBox())!
  await canvas.click({position:{x:box.width*.7,y:box.height*.5}})
  await expect(page.getByLabel('Panel name')).toHaveValue('Right board')
  await canvas.click({position:{x:box.width*.3,y:box.height*.5},modifiers:['Shift']})
  await expect(page.getByRole('heading',{name:'2 panels selected'})).toBeVisible()
  await expect(page.getByLabel('Position X',{exact:true})).toBeDisabled()
  await expect(page.getByLabel('Position Y',{exact:true})).toBeEnabled()
  await page.getByLabel('Position Y',{exact:true}).fill('500')
  await page.getByLabel('Position Y',{exact:true}).press('Tab')
  for(const [index,x] of [[0,'-300'],[1,'300']] as const) {
    await page.locator('.panel-list-select').nth(index).click()
    await expect(page.getByLabel('Position X',{exact:true})).toHaveValue(x)
    await expect(page.getByLabel('Position Y',{exact:true})).toHaveValue('500')
  }
  await page.getByRole('button',{name:'Select all',exact:true}).click()
  await page.getByRole('button',{name:'Duplicate 2',exact:true}).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(4)
  await expect(page.getByRole('heading',{name:'2 panels selected'})).toBeVisible()
  await page.getByRole('button',{name:'Delete selected panels',exact:true}).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(2)
  await expect(page.locator('.panel-list-row.selected')).toHaveCount(0)
})
