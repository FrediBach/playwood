import type { ComponentProps } from 'react'
import { PanelFields } from './fields'
import { InspectorDisclosure } from './InspectorPrimitives'
import { MATERIALS, COLORS } from '@/lib/materials'
import type { Panel } from '@/lib/types'

export function panelShapeSummary(panels: Panel[]) {
  const labels = panels.map(panel => `${panel.customOutline ? 'Custom outline' : 'Rectangle'} · ${panel.pattern === 'solid' ? (panel.cornerRadius ? 'Rounded corners' : 'Solid') : panel.pattern === 'pegboard' ? 'Pegboard' : 'Slots'}`)
  return labels.every(label => label === labels[0]) ? labels[0] : 'Mixed shapes & surfaces'
}

export function panelAppearanceSummary(panels: Panel[]) {
  const labels = panels.map(panel => {
    const material = MATERIALS.find(material => material.id === panel.material)?.name ?? panel.material
    const coverage = panel.material === 'painted' ? 1 : panel.finishCoverage ?? 0
    const color = COLORS.find(color => color.color.toLowerCase() === panel.color.toLowerCase())?.name ?? 'Custom color'
    return `${material} · ${coverage ? `${color} ${Math.round(coverage * 100)}%` : 'Natural'}`
  })
  return labels.every(label => label === labels[0]) ? labels[0] : 'Mixed materials & finishes'
}

export function PanelSecondaryFields(props: ComponentProps<typeof PanelFields>) {
  const panels = props.panels?.length ? props.panels : [props.panel]
  const customized = panels.filter(panel => panel.customOutline || (panel.cornerRadius ?? 0) > 0 || panel.pattern !== 'solid')
  return <>
    <InspectorDisclosure title="Shape & surface" badge={customized.length ? { label: 'Custom', description: `${customized.length} of ${panels.length} selected panels have a custom outline, rounded corners, or patterned surface` } : undefined} summary={panelShapeSummary(panels)} preferenceKey="panel-shape">
      <PanelFields {...props} group="shape" compact/>
    </InspectorDisclosure>
    <InspectorDisclosure title="Material & finish" summary={panelAppearanceSummary(panels)} preferenceKey="panel-appearance">
      <PanelFields {...props} group="appearance" compact/>
    </InspectorDisclosure>
  </>
}
