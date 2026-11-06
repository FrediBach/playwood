import { useId, useRef, useState } from 'react'
import { Copy, Download, FolderOpen, FolderSync, RefreshCw, Save, Upload } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import './directory-sync.css'

interface DirectoryEntry { name: string; title: string }

export interface DirectorySyncDialogProps {
  open: boolean
  onClose: () => void
  supported: boolean
  loading: boolean
  busy: boolean
  directoryName: string | null
  connected: boolean
  status: string
  error: string
  scanErrors: string[]
  projects: DirectoryEntry[]
  assemblies: DirectoryEntry[]
  activeFile: string | null
  dirty: boolean
  autosave: boolean
  pendingOpen: string | null
  assemblyOptions: { id: string; name: string }[]
  onChoose: () => void
  onResync: () => void
  onForget: () => void
  onSave: () => void
  onDuplicate: () => void
  onAutosave: (enabled: boolean) => void
  onOpenProject: (name: string) => void
  onDuplicateProject: (name: string) => void
  onConfirmOpen: (save: boolean) => void
  onCancelOpen: () => void
  onInsertAssembly: (name: string) => void
  onExportAssembly: (id: string) => void
  onImportAssembly: (file: File) => void
}

export function DirectorySyncDialog(props: DirectorySyncDialogProps) {
  const opener = useRef<HTMLElement | null>(null)
  const locked = props.busy || props.loading || props.pendingOpen !== null
  return <Dialog open={props.open} onOpenChange={open => { if (!open) props.onClose() }}>
    <DialogContent className="directory-sync-dialog"
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={event => {
        if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() }
      }}>
      <span className="dialog-eyebrow">YOUR FILES, IN YOUR FOLDER</span>
      <DialogTitle>Sync projects</DialogTitle>
      <DialogDescription>Open and save projects in a local folder. Use Resync to refresh its files. Your browser recovery save continues as you work.</DialogDescription>
      {!props.supported ? <p className="sync-notice">This browser does not support local folder access. Open Playwood in a supporting browser, such as Chrome or Edge, to sync a folder. Browser saves and project import/export remain available here.</p> : <>
        <DirectoryConnection {...props} locked={locked}/>
        {props.loading && <p className="sync-help" role="status">Checking the remembered folder…</p>}
        {props.error && <p className="error-message sync-error" role="alert">{props.error}</p>}
        {props.directoryName && <>
          <p className="sync-status" role="status">{props.busy ? 'Working…' : props.status}</p>
          {props.pendingOpen && <OpenConfirmation {...props}/>}
          <WorkspaceFiles {...props} disabled={locked || !props.connected}/>
          <DirectoryProjects {...props} disabled={locked || !props.connected}/>
          <DirectoryAssemblies {...props} disabled={locked || !props.connected}/>
          {props.scanErrors.length > 0 && <details className="sync-scan-errors">
            <summary>{props.scanErrors.length} {props.scanErrors.length === 1 ? 'file needs' : 'files need'} attention</summary>
            <ul>{props.scanErrors.map((error, index) => <li key={`${index}:${error}`}>{error}</li>)}</ul>
          </details>}
        </>}
      </>}
    </DialogContent>
  </Dialog>
}

function DirectoryConnection(props: DirectorySyncDialogProps & { locked: boolean }) {
  if (!props.directoryName) return <div className="sync-connect">
    <div className="sync-folder-icon"><FolderSync size={25}/></div>
    <p>Choose a folder for your Playwood projects and reusable assemblies. Playwood will remember it for next time.</p>
    <Button onClick={props.onChoose} disabled={props.locked}><FolderOpen size={17}/>Choose folder</Button>
  </div>
  return <section className="sync-connection" aria-label="Sync folder">
    <div className="sync-folder-name"><FolderOpen size={20}/><div><strong>{props.directoryName}</strong><span>{props.connected ? 'Connected folder' : 'Remembered folder · access needed'}</span></div></div>
    <div className="sync-actions">
      <Button size="sm" variant="outline" disabled={props.locked} onClick={props.onResync}><RefreshCw size={15}/>Resync</Button>
      <Button size="sm" variant="ghost" disabled={props.locked} onClick={props.onChoose}>Change folder</Button>
      <Button size="sm" variant="ghost" disabled={props.locked} onClick={props.onForget}>Forget folder</Button>
    </div>
    {!props.connected && <p className="sync-help">Use Resync to allow access to this folder again.</p>}
  </section>
}

function OpenConfirmation(props: DirectorySyncDialogProps) {
  const title = props.projects.find(entry => entry.name === props.pendingOpen)?.title ?? props.pendingOpen
  return <section className="sync-confirmation" aria-label="Unsaved folder changes">
    <strong>Save before opening “{title}”?</strong>
    <p>Your current workspace has changes that are not saved to this folder. Opening replaces the browser recovery save too. Undo can restore the previous workspace until you reload or close the app.</p>
    <div className="sync-actions">
      <Button size="sm" disabled={props.busy || !props.connected} onClick={() => props.onConfirmOpen(true)}>Save and open</Button>
      <Button size="sm" variant="outline" disabled={props.busy || !props.connected} onClick={() => props.onConfirmOpen(false)}>Open without saving</Button>
      <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onCancelOpen}>Cancel</Button>
    </div>
  </section>
}

function WorkspaceFiles(props: DirectorySyncDialogProps & { disabled: boolean }) {
  const headingId = useId()
  return <section className="sync-section" aria-labelledby={headingId}>
    <h3 id={headingId}>Current workspace</h3>
    <p className="sync-current-file">{props.activeFile ?? 'Not yet saved in this folder'}{props.activeFile && <span>{props.dirty ? 'Unsaved changes' : 'Saved to folder'}</span>}</p>
    <div className="sync-actions">
      <Button size="sm" onClick={props.onSave} disabled={props.disabled}><Save size={15}/>Save project</Button>
      <Button size="sm" variant="outline" onClick={props.onDuplicate} disabled={props.disabled}><Copy size={15}/>Duplicate project</Button>
    </div>
    <label className="checkbox-label sync-autosave"><input type="checkbox" checked={props.autosave} disabled={props.disabled || !props.activeFile} onChange={event => props.onAutosave(event.target.checked)}/>Autosave to folder</label>
    <p className="sync-help">{props.activeFile ? 'When enabled, accepted edits also save to this project file.' : 'Save or open a project in this folder to enable autosave.'} Duplicate creates a separate file.</p>
  </section>
}

function DirectoryProjects(props: DirectorySyncDialogProps & { disabled: boolean }) {
  const headingId = useId()
  return <section className="sync-section" aria-labelledby={headingId}>
    <div className="sync-section-heading"><h3 id={headingId}>Projects</h3><span>{props.projects.length}</span></div>
    {props.projects.length ? <ul className="sync-file-list" aria-label="Projects in folder">{props.projects.map(entry => <li key={entry.name} className={entry.name === props.activeFile ? 'sync-file-active' : ''}>
      <div className="sync-file-copy"><strong>{entry.title}</strong><span>{entry.name}</span>{entry.name === props.activeFile && <small>Current project</small>}</div>
      <div className="sync-row-actions">
        <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => props.onOpenProject(entry.name)} aria-label={`Open ${entry.title}`}>Open</Button>
        <Button size="icon" variant="ghost" disabled={props.disabled} onClick={() => props.onDuplicateProject(entry.name)} aria-label={`Duplicate ${entry.title}`} title={`Duplicate ${entry.title}`}><Copy size={15}/></Button>
      </div>
    </li>)}</ul> : <p className="sync-empty">{props.connected ? 'No projects in this folder yet. Save your current workspace to add one.' : 'Resync to see the projects in this folder.'}</p>}
  </section>
}

function DirectoryAssemblies(props: DirectorySyncDialogProps & { disabled: boolean }) {
  const headingId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [chosenId, setChosenId] = useState('')
  const exportId = props.assemblyOptions.some(option => option.id === chosenId) ? chosenId : props.assemblyOptions[0]?.id ?? ''
  return <section className="sync-section" aria-labelledby={headingId}>
    <div className="sync-section-heading"><h3 id={headingId}>Assemblies</h3><span>{props.assemblies.length}</span></div>
    {props.assemblies.length ? <ul className="sync-file-list" aria-label="Assemblies in folder">{props.assemblies.map(entry => <li key={entry.name}>
      <div className="sync-file-copy"><strong>{entry.title}</strong><span>{entry.name}</span></div>
      <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => props.onInsertAssembly(entry.name)} aria-label={`Insert ${entry.title}`}>Insert</Button>
    </li>)}</ul> : <p className="sync-empty">{props.connected ? 'Import an assembly file, or export an assembly from your current project.' : 'Resync to see the assemblies in this folder.'}</p>}
    <div className="sync-assembly-transfer">
      <Button size="sm" variant="outline" disabled={props.disabled} onClick={() => inputRef.current?.click()}><Upload size={15}/>Import assembly into folder</Button>
      <input ref={inputRef} type="file" accept=".json,.playwood-assembly.json" className="visually-hidden" aria-label="Import assembly into folder file" disabled={props.disabled} onChange={event => { const file = event.target.files?.[0]; if (file) props.onImportAssembly(file); event.target.value = '' }}/>
      <div className="sync-export-assembly">
        <label className="field"><span>Assembly to export</span><select value={exportId} disabled={props.disabled || !exportId} onChange={event => setChosenId(event.target.value)}>
          {!props.assemblyOptions.length && <option value="">No assemblies in this project</option>}
          {props.assemblyOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select></label>
        <Button size="sm" variant="outline" disabled={props.disabled || !exportId} onClick={() => props.onExportAssembly(exportId)}><Download size={15}/>Export assembly to folder</Button>
      </div>
    </div>
    <p className="sync-help">Insert adds an assembly to your workspace. Import and export keep a reusable assembly file in this folder.</p>
  </section>
}
