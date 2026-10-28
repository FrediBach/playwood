import { chromium } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Generate committed PNGs from the same vector used in the app header.
const publicDir = fileURLToPath(new URL('../public/', import.meta.url))
const mark = await readFile(`${publicDir}/favicon.svg`, 'utf8')
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  await mkdir(`${publicDir}/icons`, { recursive: true })
  for (const [name, size, padding] of [
    ['favicon-16', 16, 0], ['favicon-32', 32, 0], ['apple-touch-icon', 180, 12],
    ['icon-192', 192, 10], ['icon-512', 512, 10], ['icon-maskable-512', 512, 20],
  ]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#f4f3ef;width:100vw;height:100vh;padding:${padding}%;display:grid;place-items:center}svg{width:100%;height:100%}</style>${mark}`)
    await page.screenshot({ path: `${publicDir}/icons/${name}.png` })
  }
  await page.setViewportSize({ width: 1200, height: 630 })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#f4f3ef;color:#292b27;font-family:Arial,Helvetica,sans-serif}
    .brand{position:absolute;left:64px;top:52px;display:flex;align-items:center;gap:13px;font-size:38px;font-weight:750;letter-spacing:-2px}.brand svg{width:52px;height:52px}.dot{color:#c94727}.tag{font-size:13px;letter-spacing:2px;color:#72756c;margin:15px 0 0 2px}
    h1{position:absolute;left:68px;top:187px;margin:0;font-size:70px;font-weight:500;line-height:1.08;letter-spacing:-3px}h1 span{color:#c94727}
    p{position:absolute;left:70px;top:378px;font-size:21px;line-height:1.6;color:#6b705f;margin:0}
    .art{position:absolute;right:39px;top:113px;width:445px;height:445px}.art svg{width:100%;height:100%}
    footer{position:absolute;bottom:43px;left:70px;right:70px;border-top:1px solid #d9d9ce;padding-top:21px;display:flex;justify-content:space-between;font-size:14px;color:#6b705f}.url{color:#292b27;font-weight:600}
  </style></head><body><div class="brand">${mark}<span>playwood<span class="dot">.</span></span><span class="tag">APP</span></div>
    <h1>Make room<br>for <span>your ideas.</span></h1><p>Your panels. A few connections.<br>Furniture, imagined in 3D.</p>
    <div class="art">${mark}</div><footer><span class="url">playwood.app</span><span>Design. Connect. Make it yours.</span></footer>
  </body></html>`)
  await page.screenshot({ path: `${publicDir}/og-image.png` })
} finally {
  await browser.close()
}
