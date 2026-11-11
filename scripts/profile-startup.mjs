import {createServer} from 'node:http'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve,extname,dirname} from 'node:path'
import {gzipSync} from 'node:zlib'
import {chromium} from '@playwright/test'

const args=process.argv.slice(2)
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback
const runs=Number(option('--runs','3'))
if(!Number.isInteger(runs)||runs<1)throw new Error('--runs must be a positive integer')
const output=resolve(option('--output','test-results/startup-performance.json'))
const root=resolve('dist')
const cache=new Map()
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'}
const server=createServer(async(req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname)
    const file=resolve(root,`.${path==='/'?'/index.html':path}`)
    if(!file.startsWith(`${root}/`)){res.writeHead(403);res.end();return}
    let body=cache.get(file)
    if(!body){body=await readFile(file);cache.set(file,body)}
    const gzip=/\.(js|css|html|svg)$/.test(file)&&req.headers['accept-encoding']?.includes('gzip')
    const encoded=gzip?gzipSync(body):body
    res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store','Content-Length':encoded.length,...gzip?{'Content-Encoding':'gzip'}:{}})
    res.end(encoded)
  }catch{res.writeHead(404);res.end()}
})
await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)})
const url=`http://127.0.0.1:${server.address().port}`
let browser
try {
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const samples=[]
  for(let run=0;run<runs;run++) {
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1})
    const page=await context.newPage()
    const cdp=await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled',{cacheDisabled:true})
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1_600_000/8,uploadThroughput:750_000/8})
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
    const scripts=new Set(),errors=[]
    page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.endsWith('.js'))scripts.add(path)})
    page.on('pageerror',error=>errors.push(error.message))
    await page.addInitScript(()=>{
      window.startupProfile={longTasks:[],firstDraw:null,interaction:null}
      new PerformanceObserver(list=>{window.startupProfile.longTasks.push(...list.getEntries().map(entry=>({start:entry.startTime,duration:entry.duration}))) }).observe({type:'longtask',buffered:true})
      // Record the first submitted draw on the editor canvas, not thumbnails.
      for(const Type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) {
        if(!Type)continue
        for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {
          const original=Type.prototype[method]
          if(!original)continue
          Type.prototype[method]=function(...values){
            if(window.startupProfile.firstDraw===null&&this.canvas.closest?.('.scene-surface'))window.startupProfile.firstDraw=performance.now()
            return original.apply(this,values)
          }
        }
      }
    })
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000})
    await page.waitForFunction(()=>window.startupProfile.firstDraw!==null,{},{timeout:120000})
    await page.getByRole('button',{name:'Show dimensions',exact:true}).waitFor()
    await page.evaluate(()=>{
      const button=document.querySelector('button[aria-label="Show dimensions"]')
      button.addEventListener('pointerdown',()=>{
        const start=performance.now()
        const observer=new MutationObserver(()=>{
          if(button.getAttribute('aria-pressed')!=='true')return
          observer.disconnect()
          requestAnimationFrame(()=>requestAnimationFrame(()=>{window.startupProfile.interaction=performance.now()-start}))
        })
        observer.observe(button,{attributes:true,attributeFilter:['aria-pressed']})
      },{once:true})
    })
    await page.getByRole('button',{name:'Show dimensions',exact:true}).click()
    await page.waitForFunction(()=>window.startupProfile.interaction!==null,{},{timeout:120000})
    const metrics=await page.evaluate(()=>({
      firstDrawMs:window.startupProfile.firstDraw,
      firstContentfulPaintMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null,
      interactionMs:window.startupProfile.interaction,
      longTaskMs:window.startupProfile.longTasks.reduce((sum,task)=>sum+task.duration,0),
      maxLongTaskMs:Math.max(0,...window.startupProfile.longTasks.map(task=>task.duration)),
    }))
    const files=await Promise.all([...scripts].sort().map(async path=>{
      const bytes=await readFile(resolve(root,`.${path}`))
      return {path,bytes:bytes.length,gzipBytes:gzipSync(bytes).length}
    }))
    if(errors.length)throw new Error(errors.join('\n'))
    const sample={...metrics,scriptBytes:files.reduce((sum,file)=>sum+file.bytes,0),scriptGzipBytes:files.reduce((sum,file)=>sum+file.gzipBytes,0),files}
    samples.push(sample)
    console.log(`Run ${run+1}: ${sample.scriptGzipBytes} gzip JS bytes; first draw ${Math.round(sample.firstDrawMs)} ms; interaction ${Math.round(sample.interactionMs)} ms`)
    await context.close()
  }
  const median=key=>samples.map(sample=>sample[key]).sort((a,b)=>a-b)[Math.floor(samples.length/2)]
  const summary=Object.fromEntries(['scriptBytes','scriptGzipBytes','firstDrawMs','firstContentfulPaintMs','interactionMs','longTaskMs','maxLongTaskMs'].map(key=>[key,median(key)]))
  const report={recordedAt:new Date().toISOString(),browser:browser.version(),profile:{cpuSlowdown:4,downloadMbps:1.6,uploadMbps:0.75,latencyMs:150,gpu:'SwiftShader',cache:'disabled; fresh context per run',viewport:'1440x900 at DPR 1'},summary,samples}
  if(args.includes('--check')) {
    const budget=JSON.parse(await readFile('scripts/startup-budget.json','utf8'))
    report.budget={...budget,payloadPassed:summary.scriptGzipBytes<=budget.scriptGzipBytes,timingWithinTarget:summary.firstDrawMs<=budget.firstDrawMs&&summary.interactionMs<=budget.interactionMs}
    if(!report.budget.payloadPassed)process.exitCode=1
    if(args.includes('--check-timing')&&!report.budget.timingWithinTarget)process.exitCode=1
    console.log(`Payload budget: ${report.budget.payloadPassed?'PASS':'FAIL'}; timing targets: ${report.budget.timingWithinTarget?'PASS':'EXCEEDED (advisory unless --check-timing)'}`)
  }
  await mkdir(dirname(output),{recursive:true})
  await writeFile(output,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(summary,null,2))
  console.log(`Report: ${output}`)
} finally {
  await browser?.close()
  await new Promise(done=>server.close(done))
}
