import { CONNECTOR_COLORS, METAL_CONNECTOR_COLOR } from './connector-options'
import { getPhysicalConnectors } from './connector-selection'
import type { Project } from './types'

export const ORDER_CATALOG_DATE = '2026-11-06'
export const ORDER_SHOP_URL = 'https://playwood.it/en/diy-wooden-projects-connectors/'
const colors = {
  Black: '#000000', White: '#ffffff', Red: '#ff0000', Green: '#008002',
  Army: '#114a11', Blue: '#0000ff', Gray: '#808080',
}
export type OrderColor = keyof typeof colors
interface Product { name: string; colors: OrderColor[]; cents: number; path: string }
// Snapshot of the live product color inputs and VAT-inclusive entry prices.
// Deliberately excludes volume discounts and supplier minimum quantities.
export const ORDER_CATALOG: Record<string, Product> = {
  '90': { name: '90° plastic connector', colors: ['Black','White'], cents: 274, path: '90-connector/' },
  t: { name: 'T plastic connector', colors: ['Black','White'], cents: 476, path: 't-shape-connector/' },
  cross: { name: 'Cross plastic connector', colors: ['Red','Black','White','Gray'], cents: 574, path: 'cruz-conectores/' },
  '105': { name: '105° plastic connector', colors: ['Red','Green','Army','Blue'], cents: 137, path: '105-connector/' },
  '150': { name: '150° plastic connector', colors: ['Red','Green','Army','Blue'], cents: 137, path: '150-connector/' },
  metal: { name: '90° metal connector', colors: ['Black','Gray'], cents: 790, path: '90-connector-2/' },
}
export const ORDER_PRICE_NOTE = 'Estimated EUR prices include VAT. Prices and colors are not synced in real time and may differ at purchase. Shipping, volume discounts and supplier minimum quantities are not included.'
const euroFormatter = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })
export const formatEuros = (cents: number) => euroFormatter.format(cents / 100)
export function connectorOrderGroups(project: Project) {
  const groups = new Map<string, { key: string; productId: string; designColor: string; count: number; defaultColor: OrderColor | '' }>()
  for (const piece of getPhysicalConnectors(project)) {
    const productId = piece.material === 'metal' ? 'metal' : piece.type
    const hex = piece.material === 'metal' ? METAL_CONNECTOR_COLOR : piece.color.toLowerCase()
    const key = `${productId}:${hex}`
    const existing = groups.get(key)
    if (existing) { existing.count++; continue }
    const product = ORDER_CATALOG[productId]
    const defaultColor = piece.material === 'metal' ? 'Gray' : product.colors.find(color => colors[color] === hex) ?? ''
    const designColor = piece.material === 'metal' ? 'Silver' : CONNECTOR_COLORS.find(color => color.color === hex)?.name ?? hex
    groups.set(key, { key, productId, designColor, count: 1, defaultColor })
  }
  return [...groups.values()]
}
export function createConnectorOrder(project: Project, choices: Record<string, string>) {
  const lines = new Map<string, { productId: string; color: OrderColor; count: number; cents: number }>()
  let unresolved = 0
  for (const group of connectorOrderGroups(project)) {
    const product = ORDER_CATALOG[group.productId]
    const color = choices[group.key] ?? group.defaultColor
    if (!product.colors.includes(color as OrderColor)) { unresolved += group.count; continue }
    const key = `${group.productId}:${color}`
    const line = lines.get(key)
    if (line) { line.count += group.count; line.cents += group.count * product.cents }
    else lines.set(key, { productId: group.productId, color: color as OrderColor, count: group.count, cents: group.count * product.cents })
  }
  return { lines: [...lines.values()], unresolved, totalCents: [...lines.values()].reduce((sum, line) => sum + line.cents, 0) }
}
export function connectorOrderText(project: Project, choices: Record<string, string>) {
  const order = createConnectorOrder(project, choices)
  if (order.unresolved) throw new Error('Choose an available color for every connector.')
  return [`Connector order list — ${project.name}`, 'Planning list only — no order has been placed.', `Catalog checked: ${ORDER_CATALOG_DATE}`, ORDER_PRICE_NOTE, '',
    ...order.lines.map(line => `${line.count} × ${ORDER_CATALOG[line.productId].name} · ${line.color} · ${formatEuros(ORDER_CATALOG[line.productId].cents)} each · ${formatEuros(line.cents)}\n${ORDER_SHOP_URL}${ORDER_CATALOG[line.productId].path}`),
    '', `Estimated total: ${formatEuros(order.totalCents)}`, 'Quantities are installed pieces required by the design. Confirm minimum order quantities with the shop.'].join('\n')
}
