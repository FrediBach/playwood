import { memo, useMemo, useState } from 'react'
import { ArrowRight, Plus, Search } from 'lucide-react'
import { Color, Euler, Vector3 } from 'three'
import { EXAMPLE_LIBRARY } from '@/lib/example-library'
import { getConnectionAnchors, resolvePanels } from '@/lib/model'
import type { Project } from '@/lib/types'
import './example-browser.css'

type Example = (typeof EXAMPLE_LIBRARY)[number]
type PreviewFace = { points: Vector3[]; color: string; depth: number }
const cameraDirection = new Vector3(1, 0.8, 1).normalize()
const screenRight = new Vector3(1, 0, -1).normalize()
const screenUp = new Vector3().crossVectors(cameraDirection, screenRight)
const projectPoint = (point: Vector3) => [point.dot(screenRight), -point.dot(screenUp)]

/** A small orthographic drawing of the same panels that will open in the editor. */
function previewFaces(project: Project): PreviewFace[] {
  const panels = resolvePanels(project)
  const faces: PreviewFace[] = []
  for (const panel of panels) {
    const rotation = new Euler(...panel.rotation)
    const corners = Array.from({ length: 8 }, (_, index) => new Vector3(
      (index & 1 ? 1 : -1) * panel.width / 2,
      (index & 2 ? 1 : -1) * panel.height / 2,
      (index & 4 ? 1 : -1) * panel.thickness / 2,
    ).applyEuler(rotation).add(new Vector3(...panel.position)))
    const sides = [
      { indices: [0, 4, 6, 2], normal: new Vector3(-1, 0, 0) },
      { indices: [1, 3, 7, 5], normal: new Vector3(1, 0, 0) },
      { indices: [0, 1, 5, 4], normal: new Vector3(0, -1, 0) },
      { indices: [2, 6, 7, 3], normal: new Vector3(0, 1, 0) },
      { indices: [0, 2, 3, 1], normal: new Vector3(0, 0, -1) },
      { indices: [4, 5, 7, 6], normal: new Vector3(0, 0, 1) },
    ]
    for (const side of sides) {
      const normal = side.normal.applyEuler(rotation)
      if (normal.dot(cameraDirection) <= 0.00001) continue
      const points = side.indices.map(index => corners[index])
      const light = 0.72 + 0.28 * Math.max(0, normal.dot(new Vector3(0.2, 1, 0.5).normalize()))
      faces.push({ points, color: `#${new Color(panel.color).multiplyScalar(light).getHexString()}`,
        depth: points.reduce((sum, point) => sum + point.dot(cameraDirection), 0) / points.length })
    }
  }
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  for (const connection of project.connections) {
    const parent = byId.get(connection.parentId), child = byId.get(connection.childId)
    if (!parent || !child) continue
    for (const anchor of getConnectionAnchors(connection, parent, child)) {
      const center = new Vector3(...anchor)
      // Draw a hardware-sized square in the projection so seams remain legible.
      const points = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => center.clone()
        .addScaledVector(screenRight, x * 16).addScaledVector(screenUp, y * 16))
      faces.push({ points, color: connection.color, depth: center.dot(cameraDirection) + 20 })
    }
  }
  return faces.sort((a, b) => a.depth - b.depth)
}

const ExampleArt = memo(function ExampleArt({ example }: { example: Example }) {
  const drawing = useMemo(() => {
    const faces = previewFaces(example.create()).map(face => ({ ...face, projected: face.points.map(projectPoint) }))
    const points = faces.flatMap(face => face.projected)
    const minX = Math.min(...points.map(point => point[0]))
    const maxX = Math.max(...points.map(point => point[0]))
    const minY = Math.min(...points.map(point => point[1]))
    const maxY = Math.max(...points.map(point => point[1]))
    const scale = Math.min(204 / Math.max(1, maxX - minX), 119 / Math.max(1, maxY - minY))
    return faces.map(face => ({ color: face.color, points: face.projected.map(([x, y]) =>
      `${120 + (x - (minX + maxX) / 2) * scale},${76 + (y - (minY + maxY) / 2) * scale}`).join(' ') }))
  }, [example])
  return <div className="template-art example-art" aria-hidden="true"><svg viewBox="0 0 240 155">
    {drawing.map((face, index) => <polygon key={index} points={face.points} fill={face.color} stroke="#5f503c" strokeOpacity=".45" strokeWidth=".65" strokeLinejoin="round" />)}
  </svg></div>
})

export function ExampleBrowser({ compact = false, onSelect }: { compact?: boolean; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const categories = useMemo(() => [...new Set(EXAMPLE_LIBRARY.map(example => example.category))], [])
  const search = query.trim().toLocaleLowerCase()
  const matches = EXAMPLE_LIBRARY.filter(example => (category === 'all' || example.category === category)
    && `${example.name} ${example.description} ${example.category}`.toLocaleLowerCase().includes(search))
  const showBlank = category === 'all' && (!search || 'a blank canvas start with a single panel'.includes(search))
  return <div className={`example-browser${compact ? ' example-browser-compact' : ''}`}>
    <div className="example-filters">
      <label className="example-search"><Search size={15} aria-hidden="true"/><span className="visually-hidden">Search examples</span>
        <input type="search" placeholder="Search examples" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <label className="example-category"><span className="visually-hidden">Example category</span><select value={category} onChange={event => setCategory(event.target.value)}>
        <option value="all">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
    </div>
    <p className="example-count" aria-live="polite">{matches.length} {matches.length === 1 ? 'example' : 'examples'}{search || category !== 'all' ? ' found' : ' to make your own'}</p>
    <div className={compact ? 'example-list' : 'template-grid'}>
      {matches.map(example => <button key={example.id} className={compact ? 'library-template' : 'template-card'} data-example-id={example.id}
        aria-label={compact ? example.name : undefined} onClick={() => onSelect(example.id)}>
        <ExampleArt example={example}/>
        {compact ? <span className="example-compact-caption"><span>{example.name}<small>{example.category}</small></span><ArrowRight size={16}/></span>
          : <><strong>{example.name}</strong><span className="example-description">{example.description}<ArrowRight size={16}/></span><small className="example-card-category">{example.category}</small></>}
      </button>)}
      {showBlank && <button className={compact ? 'library-template' : 'template-card'} data-example-id="blank" aria-label={compact ? 'A blank canvas' : undefined} onClick={() => onSelect('blank')}>
        <div className="template-art template-blank" aria-hidden="true"><Plus size={40} strokeWidth={1}/></div>
        {compact ? <span>A blank canvas<ArrowRight size={16}/></span> : <><strong>A blank canvas</strong><span>Start with a single panel.<ArrowRight size={16}/></span></>}
      </button>}
    </div>
    {!matches.length && !showBlank && <div className="example-empty"><p>No examples match your search.</p><button onClick={() => { setQuery(''); setCategory('all') }}>Show all examples</button></div>}
  </div>
}
