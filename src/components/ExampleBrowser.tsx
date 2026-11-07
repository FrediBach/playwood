import { ASSEMBLY_LIBRARY } from '@/lib/assembly-library'
import { EXAMPLE_LIBRARY,ExampleDefinition } from '@/lib/example-library'
import { ArrowRight,FolderSync,Plus,Search,Upload } from 'lucide-react'
import { useMemo,useState,type ReactNode } from 'react'
import './example-browser.css'
import { LibraryPreview, LibraryPreviewProvider } from './LibraryPreview'
import { Button } from './ui/button'

export interface SyncedProjectLibrary {
  directoryName: string
  projects: { name: string; title: string }[]
  disabled: boolean
  readPreview: (name: string) => Promise<string>
  onOpen: (name: string) => void
}

export function ExampleBrowser({ compact = false, onSelect, onInsertAssembly, myAssemblies, onImportAssembly, assemblyImportError, syncedProjects }: { syncedProjects?: SyncedProjectLibrary; compact?: boolean; onSelect: (id: string) => void; onInsertAssembly?: (id: string) => void; myAssemblies?: ReactNode; onImportAssembly?: () => void; assemblyImportError?: string }) {
  const [collection, setCollection] = useState<'builds' | 'assemblies'>('builds')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const { categories, search, matches, showBlank } = useExampleMatches(collection, query, category)
  return <LibraryPreviewProvider><div className={`example-browser${compact ? ' example-browser-compact' : ''}`}>
    <div className="example-collection" role="group" aria-label="Library collection">
      {(['builds', 'assemblies'] as const).map(value => <button key={value} aria-pressed={collection === value} onClick={() => { setCollection(value); setCategory('all'); setQuery('') }}>{value === 'builds' ? 'Full builds' : 'Assemblies'}</button>)}
    </div>
    {collection === 'assemblies' && <AssemblyLibraryIntro onImport={onImportAssembly} error={assemblyImportError} canInsert={!!onInsertAssembly}>{myAssemblies}</AssemblyLibraryIntro>}
    <div className="example-filters">
      <label className="example-search"><Search size={15} aria-hidden="true"/><span className="visually-hidden">Search examples</span>
        <input type="search" placeholder="Search examples" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <label className="example-category"><span className="visually-hidden">Example category</span><select value={category} onChange={event => setCategory(event.target.value)}>
        <option value="all">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
    </div>
    {collection === 'builds' && category === 'all' && syncedProjects && <SyncedProjectCards library={syncedProjects} search={search}/>}
    <p className="example-count" aria-live="polite">{matches.length} {matches.length === 1 ? 'example' : 'examples'}{search || category !== 'all' ? ' found' : ' to make your own'}</p>
    <ExampleCards compact={compact} matches={matches} collection={collection} onInsertAssembly={onInsertAssembly} onSelect={onSelect} showBlank={showBlank}/>
    {!matches.length && !showBlank && <div className="example-empty"><p>No examples match your search.</p><button onClick={() => { setQuery(''); setCategory('all') }}>Show all examples</button></div>}
  </div></LibraryPreviewProvider>
}

function useExampleMatches(collection: 'builds' | 'assemblies', query: string, category: string) {
  const library = collection === 'builds' ? EXAMPLE_LIBRARY : ASSEMBLY_LIBRARY
  const categories = useMemo(() => [...new Set(library.map(example => example.category))], [library])
  const search = query.trim().toLocaleLowerCase()
  const matches = library.filter(example => (category === 'all' || example.category === category)
    && `${example.name} ${example.description} ${example.category}`.toLocaleLowerCase().includes(search))
  const showBlank = collection === 'builds' && category === 'all' && (!search || 'a blank canvas start with a single panel'.includes(search))
  return { categories, search, matches, showBlank }
}

function AssemblyLibraryIntro({ onImport, error, canInsert, children }: { onImport?: () => void; error?: string; canInsert: boolean; children?: ReactNode }) {
  return <>
    {onImport && <div className="assembly-file-import">
      <Button variant="outline" className="full-button" onClick={onImport}><Upload size={15}/>Import assembly</Button>
      <p className="assembly-help">Select panels or an assembly to attach it. Clear the selection to place it freely.</p>
      {error && <p role="alert" className="error-message">{error}</p>}
    </div>}
    {children}<p className="example-count">{canInsert ? 'Insert a reusable module into your build, then duplicate or connect it.' : 'Start with a reusable module, then duplicate or connect it.'}</p>
  </>
}

function ExampleCards({ compact, matches, collection, onInsertAssembly, onSelect, showBlank }: { compact: boolean; matches: ExampleDefinition[]; collection: "builds" | "assemblies"; onInsertAssembly: ((id: string) => void)|undefined; onSelect: (id: string) => void; showBlank: boolean })  {
  return <div className={compact? 'example-list':'template-grid'}>
    {matches.map(example => <button key={example.id} className={compact? 'library-template':'template-card'} data-example-id={example.id}
      aria-label={compact? example.name:undefined} onClick={() => (collection==='assemblies'&&onInsertAssembly? onInsertAssembly:onSelect)(example.id)}>
      <LibraryPreview id={example.id}/>
      {compact? <span className="example-compact-caption"><span>{example.name}<small>{example.category}</small></span><ArrowRight size={16} /></span>
        :<><strong>{example.name}</strong><span className="example-description">{example.description}<ArrowRight size={16} /></span><small className="example-card-category">{example.category}</small></>}
    </button>)}
    {showBlank&&<button className={compact? 'library-template':'template-card'} data-example-id="blank" aria-label={compact? 'A blank canvas':undefined} onClick={() => onSelect('blank')}>
      <div className="template-art template-blank" aria-hidden="true"><Plus size={40} strokeWidth={1} /></div>
      {compact? <span>A blank canvas<ArrowRight size={16} /></span>:<><strong>A blank canvas</strong><span>Start with a single panel.<ArrowRight size={16} /></span></>}
    </button>}
  </div>
}

function SyncedProjectCards({ library, search }: { library: SyncedProjectLibrary; search: string }) {
  return <section className="synced-project-library" aria-label="Synced folder projects">
      <h3><FolderSync size={16} aria-hidden="true"/>Synced folder projects</h3>
      <p className="example-count">Local folder · {library.directoryName}</p>
      {library.projects.filter(entry => `${entry.title} ${entry.name} ${library.directoryName}`.toLocaleLowerCase().includes(search)).map(entry =>
        <button key={entry.name} className="library-template synced-project-entry" disabled={library.disabled} onClick={() => library.onOpen(entry.name)} aria-label={`Open synced project ${entry.title}`}>
          <LibraryPreview id={entry.name} read={library.readPreview} revision={entry}/>
          <span className="example-compact-caption"><span><strong>{entry.title}</strong><small>Folder sync · {entry.name}</small></span><ArrowRight size={16} aria-hidden="true"/></span>
        </button>)}
      {!library.projects.length && <p className="example-count">No projects in this folder. Save a project or use Sync → Resync to refresh.</p>}
    </section>
}
