import {test,expect} from './browser-fixture'

test('a failed 3D export download leaves project export available',async({page})=>{
  await page.route(/\/BlenderExport\.tsx(?:\?.*)?$/,route=>route.abort())
  await page.goto('/')
  await page.getByRole('button',{name:'Export project',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'3D export options could not load'})).toBeVisible()
  const downloading=page.waitForEvent('download')
  await page.getByRole('button',{name:/Project file All panels/}).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.playwood\.json$/)
})
