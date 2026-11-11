import {test,expect} from '@playwright/test'

test('adding panel 201 is rejected and the 200-panel project survives reload',async({page})=>{
  const project={version:1,name:'At the limit',panels:Array.from({length:200},(_,i)=>({id:`panel-${i}`,name:`Panel ${i+1}`,width:100,height:100,thickness:18,material:'birch',color:'#d9bd8c',pattern:'solid',position:[i*120,0,0],rotation:[0,0,0],holeSize:12,holeSpacing:48})),connections:[]}
  await page.addInitScript(project=>{
    if(!sessionStorage.getItem('seeded-limit')) {localStorage.setItem('playwood-studio-project-v1',JSON.stringify(project));sessionStorage.setItem('seeded-limit','1')}
  },project)
  await page.goto('/')
  await expect(page.locator('.panel-list-row')).toHaveCount(200)
  await page.getByRole('button',{name:'Select all',exact:true}).click()
  await page.getByRole('button',{name:'Clear',exact:true}).click()
  await page.getByRole('button',{name:'Add a panel',exact:false}).first().click()
  await page.getByRole('button',{name:'Add to workspace',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Projects support up to 200 panels'})).toBeVisible()
  await expect(page.locator('.panel-list-row')).toHaveCount(200)
  await page.reload()
  await expect(page.locator('.panel-list-row')).toHaveCount(200)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
