/** IKEA Switzerland box/tray assortment, checked 2026-11-01. Sizes are millimeters.
 * Outer dimensions and available colors come from the linked IKEA product pages.
 * Colors, wall profiles, rim sizes and cutouts are visual approximations, not
 * measured fabrication templates or a claim of IKEA/PlayWood compatibility.
 */
export interface TrofastColor {
  id: string
  name: string
  hex: string
}

export interface TrofastItem {
  id: string
  name: string
  kind: 'plastic' | 'mesh' | 'tray'
  width: number
  depth: number
  height: number
  colors: string[]
  url: string
  productIds: Record<string, string>
  /** Approximate opening/body fit for visualization; measure a real box before cutting. */
  cutoutWidth: number
  cutoutDepth: number
  cornerRadius: number
  rimHeight: number
}

export const TROFAST_COLORS: Record<string, TrofastColor> = {
  white: { id: 'white', name: 'White', hex: '#f1f0e9' },
  'light-green': { id: 'light-green', name: 'Light green', hex: '#a7d998' },
  'light-orange': { id: 'light-orange', name: 'Light orange', hex: '#e5a473' },
  grey: { id: 'grey', name: 'Grey', hex: '#a3a39b' },
  'light-blue': { id: 'light-blue', name: 'Light blue', hex: '#abd6e5' },
  lilac: { id: 'lilac', name: 'Lilac', hex: '#b7abe8' },
  red: { id: 'red', name: 'Red', hex: '#aa5049' },
  'bright-green': { id: 'bright-green', name: 'Bright green', hex: '#75b77f' },
  'light-green-grey': { id: 'light-green-grey', name: 'Light green-grey', hex: '#a8b3a1' },
  'grey-blue': { id: 'grey-blue', name: 'Grey-blue', hex: '#69838e' },
  'dark-grey': { id: 'dark-grey', name: 'Dark grey', hex: '#494c49' },
}

const ikea = 'https://www.ikea.com/ch/en/p/'
const makeItem = (item: Omit<TrofastItem, 'cutoutWidth' | 'cutoutDepth' | 'cornerRadius' | 'rimHeight'>): TrofastItem => ({
  ...item,
  cutoutWidth: item.width - 20,
  cutoutDepth: item.depth - 20,
  cornerRadius: item.kind === 'plastic' ? 32 : item.kind === 'tray' ? 20 : 12,
  rimHeight: item.kind === 'mesh' ? 3 : 4,
})

export const TROFAST_ITEMS: TrofastItem[] = [
  makeItem({ id: 'plastic-small', name: 'Small box', kind: 'plastic', width: 200, depth: 300, height: 100,
    colors: ['white'], productIds: { white: '10582093' }, url: `${ikea}trofast-storage-box-white-10582093/` }),
  makeItem({ id: 'plastic-shallow', name: 'Shallow box', kind: 'plastic', width: 420, depth: 300, height: 100,
    colors: ['white', 'light-green', 'light-orange'], productIds: { white: '50582072', 'light-green': '90582089', 'light-orange': '20582083' },
    url: `${ikea}trofast-storage-box-white-50582072/` }),
  makeItem({ id: 'plastic-medium', name: 'Medium box', kind: 'plastic', width: 420, depth: 300, height: 230,
    colors: ['white', 'grey', 'light-blue', 'lilac', 'red', 'bright-green'],
    productIds: { white: '40582100', grey: '30589531', 'light-blue': '50582091', lilac: '00582098', red: '70582085', 'bright-green': '40582096' },
    url: `${ikea}trofast-storage-box-white-40582100/` }),
  makeItem({ id: 'plastic-deep', name: 'Deep box', kind: 'plastic', width: 420, depth: 300, height: 360,
    colors: ['white'], productIds: { white: '30582087' }, url: `${ikea}trofast-storage-box-white-30582087/` }),
  makeItem({ id: 'mesh-small', name: 'Small mesh box', kind: 'mesh', width: 200, depth: 300, height: 100,
    colors: ['grey-blue', 'dark-grey'], productIds: { 'grey-blue': '60530068', 'dark-grey': '10518568' },
    url: `${ikea}trofast-mesh-storage-box-grey-blue-60530068/` }),
  makeItem({ id: 'mesh-shallow', name: 'Shallow mesh box', kind: 'mesh', width: 420, depth: 300, height: 100,
    colors: ['light-green-grey', 'grey-blue', 'dark-grey'], productIds: { 'light-green-grey': '90518574', 'grey-blue': '40530074', 'dark-grey': '60518453' },
    url: `${ikea}trofast-mesh-storage-box-light-green-grey-90518574/` }),
  makeItem({ id: 'mesh-medium', name: 'Medium mesh box', kind: 'mesh', width: 420, depth: 300, height: 230,
    colors: ['light-green-grey', 'grey-blue', 'dark-grey'], productIds: { 'light-green-grey': '90530081', 'grey-blue': '60518575', 'dark-grey': '70518565' },
    url: `${ikea}trofast-mesh-storage-box-light-green-grey-90530081/` }),
  makeItem({ id: 'tray', name: 'Compartment tray', kind: 'tray', width: 420, depth: 300, height: 50,
    colors: ['white', 'red'], productIds: { white: '70581788', red: '30582105' },
    url: `${ikea}trofast-storage-tray-with-compartments-white-70581788/` }),
]

export const getTrofastItem = (id: string) => TROFAST_ITEMS.find(item => item.id === id)
export const getTrofastColor = (id: string) => TROFAST_COLORS[id]

export function getTrofastProductUrl(item: TrofastItem, colorId: string) {
  const productId = item.productIds[colorId]
  if (!productId) return item.url
  const productName = item.kind === 'mesh' ? 'mesh-storage-box' : item.kind === 'tray' ? 'storage-tray-with-compartments' : 'storage-box'
  return `${ikea}trofast-${productName}-${colorId}-${productId}/`
}
