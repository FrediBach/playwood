import {test,expect} from './browser-fixture'

test('repeated Studio and room switches draw complete scenery with a fitted camera',async({page})=>{
  const fiberUrls=new Set<string>()
  page.on('request',request=>{
    if(new URL(request.url()).pathname.endsWith('/@react-three_fiber.js')) fiberUrls.add(request.url())
  })
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(()=>page.locator('canvas').evaluate(async (canvas,urls)=>{
    for(const url of urls) {
      const {_roots}=await import(url)
      const store=_roots.get(canvas)?.store
      if(store) {Object.assign(window,{switchStore:store});return true}
    }
    return false
  },[...fiberUrls]),{timeout:15000}).toBe(true)
  await page.evaluate(()=>{
    const {gl}=(window as any).switchStore.getState()
    const render=gl.render.bind(gl)
    const samples:{room:boolean;background:string;camera:string;position:number[]}[]=[]
    Object.assign(window,{switchFrames:samples})
    gl.render=(scene: any,camera: any)=>{
      if(scene.isScene) samples.push({room:!!scene.getObjectByName('Modern home'),background:scene.background?.getHexString(),camera:camera.uuid,position:camera.position.toArray()})
      render(scene,camera)
    }
  })
  for(let repeat=0;repeat<3;repeat++) {
    for(const room of [true,false]) {
      const start=await page.evaluate(()=>(window as any).switchFrames.length as number)
      await page.getByRole('button',{name:room?'Realistic preview':'Studio',exact:true}).click()
      await expect.poll(()=>page.evaluate(()=>{
        const frames=(window as any).switchFrames
        return frames.at(-1)?.room
      })).toBe(room)
      // Include the delayed ResizeObserver delivery, not only the first new frame.
      await page.waitForTimeout(350)
      const positions=await page.evaluate(({start,room})=>(window as any).switchFrames.slice(start).filter((frame:any)=>frame.room===room).map((frame:any)=>frame.position) as number[][],{start,room})
      expect(positions.length).toBeGreaterThan(0)
      for(const position of positions) for(let axis=0;axis<3;axis++) expect(position[axis]).toBeCloseTo(positions[0][axis],6)
    }
  }
  const frames=await page.evaluate(()=>(window as any).switchFrames as {room:boolean;background:string;camera:string;position:number[]}[])
  expect(frames.some(frame=>frame.room)).toBe(true)
  expect(frames.some(frame=>!frame.room)).toBe(true)
  expect(new Set(frames.map(frame=>frame.camera)).size).toBe(1)
  for(const frame of frames) {
    expect(frame.background).toBe(frame.room?'e9e7df':'eeede8')
    expect(frame.position.every(Number.isFinite)).toBe(true)
    expect(frame.position).not.toEqual([2,1.5,2.5])
  }
  // A resize must also retain an intentionally off-center user view.
  const panned=await page.evaluate(()=>{
    const {camera,controls,invalidate}=(window as any).switchStore.getState()
    camera.position.x+=0.4
    controls.target.x+=0.4
    controls.update()
    invalidate()
    return {position:camera.position.toArray(),target:controls.target.toArray()}
  })
  await page.setViewportSize({width:1200,height:900})
  await expect.poll(()=>page.evaluate(()=>{
    const {size,gl}=(window as any).switchStore.getState()
    return size.width===gl.domElement.parentElement.getBoundingClientRect().width
  })).toBe(true)
  await page.waitForTimeout(350)
  const resized=await page.evaluate(()=>{
    const {camera,controls}=(window as any).switchStore.getState()
    return {position:camera.position.toArray(),target:controls.target.toArray()}
  })
  expect(resized).toEqual(panned)
  await page.locator('canvas').focus()
  await page.keyboard.press('f')
  await expect.poll(()=>page.evaluate(()=>(window as any).switchStore.getState().controls.target.toArray())).not.toEqual(panned.target)

})
