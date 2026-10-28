import { CircleHelp } from 'lucide-react'
import type { getProjectBounds } from '@/lib/model'

interface Props {
  panelCount: number
  connectorCount: number
  issueCount: number
  bounds: ReturnType<typeof getProjectBounds>
  onParts: () => void
  onHelp: () => void
}
const number = (n:number)=>Math.round(n).toLocaleString()

export function ProjectStatus({panelCount,connectorCount,issueCount,bounds,onParts,onHelp}: Props) {
  return <footer className="status-bar"><div><span className="status-dot"/><span>{panelCount} panels</span><span className="status-separator">/</span><span>{connectorCount} connectors</span><span className="status-separator">/</span><button onClick={onParts} className={issueCount?'status-warning':''}>{issueCount?`${issueCount} ${issueCount===1?'check':'checks'} to review`:'Ready to explore'}</button></div><div className="assembly-size"><span>ASSEMBLY</span>{number(bounds.width)} × {number(bounds.height)} × {number(bounds.depth)} mm</div><a className="copyright" href="https://fredibach.com" target="_blank" rel="noreferrer">© 2026 Fredi Bach</a><button className="status-help" onClick={onHelp}><CircleHelp size={14}/>Shortcuts & help</button></footer>
}
