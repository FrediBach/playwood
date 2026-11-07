import type { Panel } from '@/lib/types'

const mm = (value: number) => Number(value.toFixed(2)).toLocaleString()

export function PanelChangeTable({ changes, label }: { changes: { before: Panel; after: Panel }[]; label: string }) {
  return (
      <div className="parts-table-wrap">
        <table aria-label={label}>
          <thead><tr><th>Panel</th><th>Changes (mm)</th></tr></thead>
          <tbody>{changes.map(({ before, after }) => <tr key={after.id}>
            <td>{after.name}</td>
            <td>
              {(['width', 'height'] as const).filter(field => Math.abs(before[field] - after[field]) > 1e-6).map(field => <div key={field}>{field === 'width' ? 'Width' : 'Height'}: {mm(before[field])} → {mm(after[field])}</div>)}
              {(['X', 'Y', 'Z'] as const).map((axis, index) => Math.abs(before.position[index] - after.position[index]) > 1e-6
                ? <div key={axis}>Center {axis}: {mm(before.position[index])} → {mm(after.position[index])}</div> : null)}
              {JSON.stringify(before.customOutline) !== JSON.stringify(after.customOutline) && <div>Outline refitted</div>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>
  )
}
