import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { connectorId, getPhysicalConnectors } from '../src/lib/connector-selection'
import { createPanel, createStarterProject } from '../src/lib/model'

for (const room of [false, true]) {
  test(`exports ${room ? 'realistic scene' : 'construction'} as Blender-compatible GLB`, async ({ page }) => {
    test.setTimeout(120000)
    await page.goto('/')
    const starter = createStarterProject('desk')
    const removed = connectorId(starter.connections[0].id, 0)
    const metal = connectorId(starter.connections[0].id, 1)
    const project = { ...starter, name: 'Blender test', connectorOverrides: { [removed]: { removed: true }, [metal]: { material: 'metal' as const } }, panels: [
      ...starter.panels,
      createPanel({ name: 'Export board', width: 600, height: 400, thickness: 18, position: [0, 500, 0], pattern: 'pegboard', holeSize: 12, holeSpacing: 80 }),
      createPanel({ name: 'Hidden board', visible: false }),
    ] }
    await page.getByLabel('Import project file').setInputFiles({ name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
    if (room) await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Export project', exact: true }).click()
    if (room) await page.getByRole('checkbox', { name: 'Include auto furnishings in realistic scene' }).check()
    const downloadPromise = page.waitForEvent('download', { timeout: 90000 })
    await page.getByRole('button', { name: room ? 'Realistic scene · GLB' : 'Construction · GLB' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'GLB downloaded' })).toBeVisible({ timeout: 30000 })
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(`blender-test-${room ? 'scene' : 'construction'}.glb`)
    const bytes = await readFile((await download.path())!)
    expect(bytes.toString('ascii', 0, 4)).toBe('glTF')
    expect(bytes.readUInt32LE(4)).toBe(2)
    expect(bytes.readUInt32LE(8)).toBe(bytes.length)
    const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
    const names = json.nodes.map((node: { name?: string }) => node.name)
    expect(names).toContain('Export board')
    expect(names).not.toContain('Hidden board')
    expect(names.includes('Modern home')).toBe(room)
    expect(names.includes('Robot vacuum')).toBe(room)
    const hardware = json.nodes.filter((node: { extras?: { connectorId?: string } }) => node.extras?.connectorId)
    expect(hardware).toHaveLength(getPhysicalConnectors(project).length)
    expect(hardware.some((node: { extras: { connectorId: string } }) => node.extras.connectorId === removed)).toBe(false)
    expect(hardware.find((node: { extras: { connectorId: string } }) => node.extras.connectorId === metal).extras.connectorMaterial).toBe('metal')
    expect(names.includes('Preview furnishings')).toBe(room)
    expect(names.some((name?: string) => name?.startsWith('Wall art'))).toBe(room)
    expect(names.some((name?: string) => name?.startsWith('Artwork, '))).toBe(room)
    expect(json.cameras).toHaveLength(1)
    expect(json.images.length).toBeGreaterThan(0)
    expect(json.images.every((image: { bufferView?: number; uri?: string }) => image.bufferView !== undefined && !image.uri)).toBe(true)
    const node = json.nodes.find((node: { name?: string }) => node.name === 'Export board')
    const primitive = json.meshes[node.mesh].primitives[0]
    const positions = json.accessors[primitive.attributes.POSITION]
    expect(positions.max[0] - positions.min[0]).toBeCloseTo(.6)
    expect(positions.max[1] - positions.min[1]).toBeCloseTo(.4)
    expect(positions.count).toBeGreaterThan(24)
    await expect(page.getByRole('status').filter({ hasText: 'GLB downloaded' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Construction · GLB' })).toBeEnabled()
    await page.screenshot({ path: `test-results/blender-export-${room ? 'narrow' : 'desktop'}.png` })
    const box = await page.getByRole('dialog').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(room ? 390 : 1440)
  })
}
