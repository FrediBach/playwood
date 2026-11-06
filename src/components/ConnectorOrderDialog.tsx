import { useState } from 'react'
import { Download } from 'lucide-react'
import { download } from '@/editor/project-file-commands'
import { connectorOrderGroups, connectorOrderText, createConnectorOrder, formatEuros, ORDER_CATALOG, ORDER_CATALOG_DATE, ORDER_PRICE_NOTE, ORDER_SHOP_URL } from '@/lib/connector-order'
import type { Project } from '@/lib/types'
import { Button } from './ui/button'
import { DialogDescription, DialogTitle } from './ui/dialog'
import { SelectField } from './fields'

export function ConnectorOrderDialog({ project }: { project: Project }) {
  const [choices, setChoices] = useState<Record<string, string>>({})
  const groups = connectorOrderGroups(project)
  const order = createConnectorOrder(project, choices)
  return <>
    <span className="dialog-eyebrow">FROM DESIGN TO YOUR PARTS LIST</span>
    <DialogTitle>Buy connectors</DialogTitle>
    <DialogDescription>Prepare a connector order list. No checkout or order is placed. Color choices here leave your design unchanged.</DialogDescription>
    {!groups.length ? <p className="dialog-note">Your project has no installed connectors to order.</p> : <>
      <div className="connector-order-groups">{groups.map(group => {
        const product = ORDER_CATALOG[group.productId]
        return <section className="connector-order-group" key={group.key}>
          <div><strong>{group.count} × {product.name}</strong><p className="dialog-note">Design: {group.designColor} · {formatEuros(product.cents)} each</p></div>
          {!group.defaultColor && <p className="error-message">{group.designColor} is not listed for this connector. Choose an alternative.</p>}
          <SelectField label={`Order color for ${product.name} (${group.designColor})`} value={choices[group.key] ?? group.defaultColor} onChange={color => setChoices(current => ({ ...current, [group.key]: color }))}>
            <option value="" disabled>Choose a color</option>{product.colors.map(color => <option key={color} value={color}>{color}</option>)}
          </SelectField>
          <a className="dialog-note" href={`${ORDER_SHOP_URL}${product.path}`} target="_blank" rel="noreferrer">View product on PlayWood ↗</a>
        </section>
      })}</div>
      <p aria-live="polite"><strong>{order.unresolved ? 'Estimated subtotal' : 'Estimated total'}: {formatEuros(order.totalCents)}</strong>{order.unresolved > 0 && <span className="dialog-note"> · Choose colors for {order.unresolved} pieces to complete the estimate.</span>}</p>
    </>}
    <p className="dialog-note">{ORDER_PRICE_NOTE} Quantities are the installed pieces required by your design. Catalog checked {ORDER_CATALOG_DATE}.</p>
    <div className="dialog-footer"><Button disabled={!groups.length || order.unresolved > 0} onClick={() => download(connectorOrderText(project, choices), `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'playwood'}-connector-order.txt`, 'text/plain')}><Download size={17}/>Download order list</Button></div>
  </>
}
