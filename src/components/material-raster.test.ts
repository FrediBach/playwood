import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { createMaterialRaster } from './material-raster'
import { packMaterialRaster, unpackMaterialRaster } from './material-raster-packing'

// Captured from the original synchronous generators before worker extraction.
// Hash the complete RGBA buffers so matching code paths cannot hide pixel changes.
const originals = {
  birch: {
    width: 512, height: 1024, tileWidth: 0.6, tileHeight: 1.2,
    color: '9ac292e172e2d2d252b91e33b644ae16650dc096c5f6477c0d27ed1cca9a2e75',
    surface: 'dfe437c3bf449707d80b5bb7fbee1e6ab36f3e82312b887b2cc386e006ce3201',
    combined: 'ae087628ed3ef6acb35944b74a60e0b1242cbd78a83c24b421d1be95f651deb7',
  },
  oak: {
    width: 512, height: 1024, tileWidth: 0.6, tileHeight: 1.2,
    color: '888bf65d321cc25fc58103ff091efa60417f2b03cf320f28a275e9fae179566d',
    surface: '0d0a7e848aa6c8b1c66db9622769f9663117ea18f005a1d283816b088a56d36c',
    combined: '1c2ae0fe27bc7327fd977d7404f94a03310c7e6ceb30c9332bc464e33eb25830',
  },
  walnut: {
    width: 512, height: 1024, tileWidth: 0.6, tileHeight: 1.2,
    color: 'd447768b43e7e3aa696e1d62b33203e76ef5f486c0446e81ab5bd32d3009c5e2',
    surface: 'b1b392a21b8c80bcaed6fe7e5d0b1470c39210da053b41ba7d219f4af3592cd4',
    combined: 'a233ccfab793deac5ed9a19bcb42f7352919e0cf51634fdb86de5623188e0cbf',
  },
  mdf: {
    width: 512, height: 1024, tileWidth: 0.6, tileHeight: 1.2,
    color: 'ebc0723cfa47b4b609a64234b82cc87ee9cc7b3d4001c4b225b6443034b5ebbb',
    surface: '0b9b1b54b13e5f9fe23bf57ed2a425b948594a6cb92a4d4d267d0abf2d092cee',
    combined: 'cf5e273bb6339f7938726017024b498f2067e54c15dfcc8c76ae09e94a357459',
  },
  osb: {
    width: 1024, height: 1024, tileWidth: 0.6, tileHeight: 0.6,
    color: '0ea1e19f7e9b28e020ca5b328f3e2b1b30aa88c2d0c624043bddcf2e271d755c',
    surface: '8a668672c2fab5df822660836e990c5671fd239ec61ef8313caff79ed2867035',
    combined: '8a8f3a8380f27c3253e5986f662a409493a5658c509aa60205bed23e292c318f',
  },
  nazena: {
    width: 1024, height: 1024, tileWidth: 0.45, tileHeight: 0.45,
    color: 'a007be16322220a5a7e3b5bcb6639ed0af8470724ddb3dc3c2d453d8cf3c294d',
    surface: '3bed2a31a23c3d34bedec8ca9bc3b307f070398dc14f1222861fed3175bc969d',
    combined: '19bd4b022174bb402e52095c77183d7c7e82fb5ae70a808551ac1758f26ee873',
  },
} as const

function hash(...buffers: Uint8Array[]) {
  const digest = createHash('sha256')
  for (const buffer of buffers) digest.update(buffer)
  return digest.digest('hex')
}

describe.each(Object.keys(originals) as (keyof typeof originals)[])('%s material raster', material => {
  let raster: ReturnType<typeof createMaterialRaster>
  let packed: ReturnType<typeof packMaterialRaster>
  const expected = originals[material]
  beforeAll(() => {
    raster = createMaterialRaster(material)
    packed = packMaterialRaster(material, raster)
  })

  it('preserves every original color and surface byte at the same physical scale', () => {
    expect(raster).toMatchObject({
      width: expected.width, height: expected.height,
      tileWidth: expected.tileWidth, tileHeight: expected.tileHeight,
    })
    expect(raster.color.byteLength).toBe(expected.width * expected.height * 4)
    expect(raster.surface.byteLength).toBe(raster.color.byteLength)
    expect(hash(raster.color)).toBe(expected.color)
    expect(hash(raster.surface)).toBe(expected.surface)
    expect(hash(raster.color, raster.surface)).toBe(expected.combined)
  })

  it('packs only distinct channels and restores independent, byte-identical RGBA buffers', () => {
    const channels = material === 'osb' || material === 'nazena' ? 5 : 3
    expect(packed.channels).toBe(channels)
    expect(packed.data.byteLength).toBe(expected.width * expected.height * channels)
    expect(packed.data.buffer).not.toBe(raster.color.buffer)
    expect(packed.data.buffer).not.toBe(raster.surface.buffer)

    const restored = unpackMaterialRaster(packed)
    expect(restored).toMatchObject({
      width: expected.width, height: expected.height,
      tileWidth: expected.tileWidth, tileHeight: expected.tileHeight,
    })
    expect(restored.color.buffer).not.toBe(packed.data.buffer)
    expect(restored.surface.buffer).not.toBe(packed.data.buffer)
    expect(restored.color.buffer).not.toBe(raster.color.buffer)
    expect(restored.surface.buffer).not.toBe(raster.surface.buffer)
    expect(restored.color.buffer).not.toBe(restored.surface.buffer)
    expect(Buffer.from(restored.color).equals(Buffer.from(raster.color))).toBe(true)
    expect(Buffer.from(restored.surface).equals(Buffer.from(raster.surface))).toBe(true)
    expect(hash(restored.color, restored.surface)).toBe(expected.combined)
  })
})

it.each([11, 13])('rejects a packed buffer with %i bytes for twelve bytes of pixels', length => {
  expect(() => unpackMaterialRaster({
    width: 2, height: 2, tileWidth: 0.6, tileHeight: 1.2,
    channels: 3, data: new Uint8Array(length),
  })).toThrow()
})
