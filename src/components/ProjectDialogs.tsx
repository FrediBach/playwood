import { getPhysicalConnectors } from '@/lib/connector-selection'
import type { ComponentProps, Dispatch, SetStateAction } from 'react'
import { ArrowRight, CircleHelp, Download, FolderOpen, ListChecks, Plus, Upload } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { PanelFields, SelectField } from './fields'
import { ExampleBrowser } from './ExampleBrowser'
import { RotateCreation } from './RotateCreation'
import { ConnectorGlyph } from './editor-controls'
import { MATERIALS } from '@/lib/materials'
import { CONNECTORS } from '@/lib/connector-options'
import type { Panel, Project, ValidationIssue } from '@/lib/types'

export type ProjectDialog = 'add' | 'templates' | 'export' | 'help' | 'parts' | 'rotate' | null
interface Props {
  dialog: ProjectDialog
  onClose: () => void
  onAdd: () => void
  attachNewPanel: boolean
  onRotate: ComponentProps<typeof RotateCreation>['onRotate']
  draft: Panel
  setDraft: Dispatch<SetStateAction<Panel>>
  loadTemplate: (template: string) => void
  exportProject: () => void
  onExportParts: () => void
  onImport: () => void
  importError: string
  project: Project
  panels: Panel[]
  connectorCount: number
  issues: ValidationIssue[]
}
const SOURCE_URL = 'https://www.playwood.it/site/assets/files/18237/technical_information_playwood_connectors.pdf'

export function ProjectDialogs(props: Props) {
  return <Dialog open={props.dialog!==null} onOpenChange={open=>{if(!open)props.onClose()}}>
    <DialogContent className={props.dialog==='templates'?'wide-dialog':props.dialog==='parts'?'parts-dialog':''}>
      <DialogBody {...props}/>
    </DialogContent>
  </Dialog>
}

function DialogBody(props: Props) {
  switch (props.dialog) {
    case 'rotate': return <RotateDialog {...props}/>
    case 'add': return <AddDialog {...props}/>
    case 'templates': return <TemplatesDialog {...props}/>
    case 'export': return <ExportDialog {...props}/>
    case 'help': return <HelpDialog {...props}/>
    case 'parts': return <PartsDialog {...props}/>
    default: return null
  }
}

function RotateDialog({onClose,onRotate}: Pick<Props, 'onClose' | 'onRotate'>) {
  return <RotateCreation onCancel={onClose} onRotate={onRotate}/>
}

function AddDialog({draft,setDraft,onClose,onAdd,attachNewPanel}: Pick<Props, 'draft' | 'setDraft' | 'onClose' | 'onAdd' | 'attachNewPanel'>) {
  return <><span className="dialog-eyebrow">YOUR MATERIAL, YOUR POSSIBILITIES</span><DialogTitle>Bring your own panel.</DialogTitle><DialogDescription>Start with what you have. Every detail can be changed later.</DialogDescription><div className="dialog-form"><label className="field"><span>Panel name</span><input value={draft.name} maxLength={60} onChange={e=>setDraft(p=>({...p,name:e.target.value}))}/></label><PanelFields panel={draft} onChange={patch=>setDraft(p=>({...p,...patch}))}/><SelectField label="Orientation" value={draft.rotation[0]===-Math.PI/2?'horizontal':draft.rotation[1]===Math.PI/2?'side':'vertical'} onChange={v=>setDraft(p=>({...p,rotation:v==='horizontal'?[-Math.PI/2,0,0]:v==='side'?[0,Math.PI/2,0]:[0,0,0]}))}><option value="vertical">Vertical · front facing</option><option value="horizontal">Horizontal · flat</option><option value="side">Vertical · side facing</option></SelectField></div><div className="dialog-footer"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={onAdd}><Plus size={17}/>{attachNewPanel?'Choose attachment point':'Add to workspace'}</Button></div></>
}

function TemplatesDialog({loadTemplate}: Pick<Props, 'loadTemplate'>) {
  return <><span className="dialog-eyebrow">A FEW GOOD STARTING POINTS</span><DialogTitle>Simple parts. Endless possibilities.</DialogTitle><DialogDescription>Choose a full build or reusable assembly and make it your own. You can undo switching templates.</DialogDescription><ExampleBrowser onSelect={loadTemplate}/></>
}

function ExportDialog({exportProject,onExportParts,onImport,importError}: Pick<Props, 'exportProject' | 'onExportParts' | 'onImport' | 'importError'>) {
  return <><span className="dialog-eyebrow">FROM IDEA TO SOMETHING REAL</span><DialogTitle>Take your project with you.</DialogTitle><DialogDescription>Save an editable project or a parts list for your next build.</DialogDescription><div className="export-options"><button onClick={exportProject}><span className="export-icon"><FolderOpen size={23}/></span><span><strong>Project file</strong><small>All panels, connections, and materials · JSON</small></span><Download size={19}/></button><button onClick={onExportParts}><span className="export-icon"><ListChecks size={23}/></span><span><strong>Parts & cutting list</strong><small>Panel dimensions and connector quantities · CSV</small></span><Download size={19}/></button></div><div className="import-area"><span>Picking up where you left off?</span><Button variant="outline" onClick={onImport}><Upload size={16}/>Import project</Button></div>{importError&&<p role="alert" className="error-message">{importError}</p>}<p className="dialog-note">Changes are saved automatically in this browser. Export a project file to keep a separate copy.</p></>
}

function HelpDialog(_props: Props) {
  return <><span className="dialog-eyebrow">LESS, BUT BETTER</span><DialogTitle>A space to think with your hands.</DialogTitle><DialogDescription>playwood. APP lets you explore furniture made from your own panels and the Playwood connector system.</DialogDescription><div className="help-steps"><div><span>01</span><p><strong>Bring a panel.</strong> Choose its size, material, finish, and surface. Pegboards and rounded slots are cut through the 3D geometry.</p></div><div><span>02</span><p><strong>Make a connection.</strong> Select a panel, choose Attach, and explore a side, connector angle, and offset. The preview updates before you commit. Already positioned your panels? Select them and choose Auto-add connectors to fill compatible joints. Interior T joints split continuous panels around the connector while keeping their outer dimensions; Undo restores the original panels.</p></div><div><span>03</span><p><strong>Make it yours.</strong> Select a panel or assembly, then hold Control and drag it in the preview. It snaps near compatible attachments; release to place it or press Escape to cancel. Dragging disconnects its previous external joints. Use the arrow keys to move in the direction you see. Connected panels resize together; hold Shift for 10 cm steps. Undo is always available.</p></div></div><div className="shortcut-list"><span>Orbit <kbd>Drag</kbd></span><span>Pan <kbd>Right-drag</kbd></span><span>Multi-select <kbd>Shift-click</kbd></span><span>Select all <kbd>⌘ / Ctrl A</kbd></span><span>Move &amp; snap <kbd>Ctrl + drag</kbd></span><span>Cancel move <kbd>Esc</kbd></span><span>Move in preview <kbd>↑ ↓ ← → · 1 cm</kbd></span><span>Move further <kbd>Shift + arrows · 10 cm</kbd></span><span>Fit view <kbd>F</kbd></span><span>Copy <kbd>⌘ / Ctrl C</kbd></span><span>Paste, then choose a + <kbd>⌘ / Ctrl V</kbd></span><span>Cancel paste <kbd>Esc</kbd></span><span>Duplicate <kbd>⌘ / Ctrl D</kbd></span><span>Undo <kbd>⌘ / Ctrl Z</kbd></span><span>Delete <kbd>Delete</kbd></span></div><div className="reference-note"><strong>Built around the real system.</strong><p>90°, 105°, and 150° connectors accept 16–19 mm panels. T and cross connectors accept 18–19 mm panels. Connector shapes use the supplied 3D models; this editor is a design study, not a structural or fabrication simulation. Review joint clearances before making.</p><a href={SOURCE_URL} target="_blank" rel="noreferrer">Official technical drawings <ArrowRight size={14}/></a><a href="https://www.playwood.it/en/diy-wooden-projects-connectors/" target="_blank" rel="noreferrer">Explore Playwood connectors <ArrowRight size={14}/></a></div></>
}

function PartsDialog({project,connectorCount,panels,issues,onExportParts}: Pick<Props, 'project' | 'connectorCount' | 'panels' | 'issues' | 'onExportParts'>) {
  return <><span className="dialog-eyebrow">THE SUM OF SIMPLE PARTS</span><DialogTitle>Your assembly, item by item.</DialogTitle><DialogDescription>{project.panels.length} panels and {connectorCount} connectors in {project.name}.</DialogDescription><div className="parts-table-wrap"><table><thead><tr><th>Panel</th><th>Material</th><th>Dimensions · mm</th></tr></thead><tbody>{panels.map(p=><tr key={p.id}><td>{p.name}<small>{p.pattern==='solid'?'Solid':p.pattern==='pegboard'?'Pegboard':'Rounded slots'}</small></td><td>{MATERIALS.find(m=>m.id===p.material)?.name}</td><td>{p.width} × {p.height} × {p.thickness}</td></tr>)}</tbody></table></div><div className="parts-connectors">{CONNECTORS.map(c=>{const count=getPhysicalConnectors(project).filter(conn=>conn.type===c.id).length;return count>0?<span key={c.id}><ConnectorGlyph type={c.id}/><strong>{count}</strong> × {c.name}</span>:null})}</div>{issues.length>0&&<div className="parts-issues"><h3>Before you build</h3>{issues.map(i=><p key={i.id}><CircleHelp size={15}/>{i.message}</p>)}</div>}<div className="dialog-footer"><Button variant="outline" onClick={onExportParts}><Download size={16}/>Export cutting list</Button></div></>
}
