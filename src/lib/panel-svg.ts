import { EllipseCurve, LineCurve, type Path, type Vector2 } from 'three'
import { makePanelShape } from './panel-cut-geometry'
import type { Panel } from './types'

export function needsPanelSvg(panel: Panel): boolean {
  return panel.pattern !== 'solid' || !!panel.customOutline || (panel.cornerRadius ?? 0) > 0 || !!panel.trofastInserts?.length
}

const number = (value: number) => Number(value.toFixed(6))
const escapeXml = (value: string) => value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!)

/** Convert the shared metre-based XY shape to top-left millimetres, retaining exact arcs. */
function pathData(path: Path, panel: Panel): string {
  const position = (point: Vector2) => `${number(point.x * 1000 + panel.width / 2)} ${number(panel.height / 2 - point.y * 1000)}`
  const commands = [`M ${position(path.curves[0].getPoint(0))}`]
  for (const curve of path.curves) {
    if (curve instanceof LineCurve) commands.push(`L ${position(curve.v2)}`)
    else if (curve instanceof EllipseCurve) {
      // Two arcs also represent full circles, whose coincident endpoints SVG would omit.
      const radii = `${number(curve.xRadius * 1000)} ${number(curve.yRadius * 1000)}`
      const sweep = curve.aClockwise ? 1 : 0
      commands.push(`A ${radii} 0 0 ${sweep} ${position(curve.getPoint(0.5))}`,
        `A ${radii} 0 0 ${sweep} ${position(curve.getPoint(1))}`)
    } else throw new Error('Unsupported panel curve in SVG export.')
  }
  return `${commands.join(' ')} Z`
}

export function panelToSvg(panel: Panel): string {
  const shape = makePanelShape(panel)
  const description = `Panel ${panel.width} × ${panel.height} × ${panel.thickness} mm. Top-left panel coordinates. Outside contour: black; through openings: white. Set cutting depth and tool offsets on your cutter.${panel.trofastInserts?.length ? ' TROFAST openings are approximate; measure the real insert before cutting.' : ''}`
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${panel.width}mm" height="${panel.height}mm" viewBox="0 0 ${panel.width} ${panel.height}">
  <title>${escapeXml(panel.name)}</title>
  <desc>${escapeXml(description)}</desc>
  <path id="outline" d="${pathData(shape, panel)}" fill="#000000" stroke="#000000" stroke-width="0.1"/>
${shape.holes.map((hole, index) => `  <path id="cutout-${index + 1}" d="${pathData(hole, panel)}" fill="#ffffff" stroke="#000000" stroke-width="0.1"/>`).join('\n')}
</svg>
`
}

export function panelSvgFilename(panel: Panel, index: number): string {
  const name = panel.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'panel'
  return `${index + 1}-${name}.svg`
}
