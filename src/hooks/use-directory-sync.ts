import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProjectSnapshot } from './use-project'
import { createAssemblyFile, parseAssemblyFile } from '@/lib/assembly-file'
import {
  directorySyncError, forgetSyncDirectory, isDirectorySyncSupported, overwriteDirectoryProject,
  pickSyncDirectory, readDirectoryPreviewContent, readDirectoryAssembly, readDirectoryProject, rememberSyncDirectory,
  restoreSyncDirectory, scanSyncDirectory, writeNewDirectoryFile,
  type DirectoryHandle, type DirectoryListing,
} from '@/lib/directory-sync'
import type { AssemblyDefinition, Project } from '@/lib/types'

interface FileBinding {
  documentId: string
  name: string
  content: string
  savedProject: string
}
interface SyncState {
  directory: DirectoryHandle | null
  connected: boolean
  loading: boolean
  busy: boolean
  listing: DirectoryListing
  binding: FileBinding | null
  autosave: boolean
  pendingOpen: { name: string; source: ProjectSnapshot } | null
  status: string
  error: string
}
interface Options extends ProjectSnapshot {
  getSnapshot: () => ProjectSnapshot
  replaceProject: (project: Project) => void
  insertAssembly: (definition: AssemblyDefinition) => void
  notify: (message: string) => void
}
const emptyListing = (): DirectoryListing => ({ projects: [], assemblies: [], errors: [] })
const serialize = (project: Project) => JSON.stringify(project, null, 2)

/** Directory metadata stays outside project history and the portable version 1 file. */
export function useDirectorySync(options: Options) {
  const supported = isDirectorySyncSupported()
  const [state, setState] = useState<SyncState>(() => ({
    directory: null, connected: false, loading: supported, busy: false, listing: emptyListing(),
    binding: null, autosave: false, pendingOpen: null, status: '', error: '',
  }))
  const latest = useRef(state)
  const actions = useRef(options)
  useLayoutEffect(() => { actions.current = options }, [options])
  const update = useCallback((patch: Partial<SyncState>) => {
    latest.current = { ...latest.current, ...patch }
    setState(latest.current)
  }, [])
  const projectJson = useMemo(() => JSON.stringify(options.project), [options.project])
  const binding = state.binding?.documentId === options.documentId ? state.binding : null
  const dirty = !binding || binding.savedProject !== projectJson

  useEffect(() => {
    if (!supported) return
    let canceled = false
    void restoreSyncDirectory().then(directory => {
      if (!canceled) update({ directory, loading: false, status: directory ? 'Folder remembered. Resync to reconnect.' : '' })
    }).catch(error => {
      if (!canceled) update({ loading: false, error: directorySyncError(error) })
    })
    return () => { canceled = true }
  }, [supported, update])

  // Replacements and undo/redo across documents must never write into the previous file.
  useEffect(() => {
    const current = latest.current
    if (current.binding && current.binding.documentId !== options.documentId) {
      update({ binding: null, autosave: false, pendingOpen: null, error: '', status: 'Save this workspace to create a new project file.' })
    }
  }, [options.documentId, update])

  const run = useCallback(async (operation: () => Promise<void>, pauseOnError = true) => {
    if (latest.current.busy || latest.current.loading) return
    update({ busy: true, error: '' })
    try { await operation() }
    catch (error) {
      const message = directorySyncError(error)
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      update({ error: message, ...((pauseOnError || denied) ? { autosave: false, status: 'Folder sync paused.' } : {}), ...(denied ? { connected: false } : {}) })
      actions.current.notify(message)
    } finally { update({ busy: false }) }
  }, [update])

  const directoryWithAccess = useCallback(async () => {
    const { directory, connected } = latest.current
    if (!directory || !connected) throw new Error('Resync the folder before reading or saving files.')
    if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new DOMException('Folder permission expired.', 'NotAllowedError')
    }
    return directory
  }, [])

  // Preview reads never prompt for access, change the workspace, or affect autosave.
  const previewDirectory = state.directory
  const previewConnected = state.connected
  const readPreview = useCallback(async (name: string) => {
    if (!previewDirectory || !previewConnected || await previewDirectory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new Error('Resync the folder to load previews.')
    }
    return readDirectoryPreviewContent(previewDirectory, name)
  }, [previewDirectory, previewConnected])

  const refresh = useCallback(async (directory: DirectoryHandle) => {
    const listing = await scanSyncDirectory(directory)
    update({ listing })
  }, [update])

  const choose = () => {
    const previousError = latest.current.error
    return run(async () => {
      // Keep the picker in the click's user activation, before other asynchronous work.
      let directory: DirectoryHandle
      try { directory = await pickSyncDirectory() }
      catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') { update({ error: previousError }); return }
        throw error
      }
      if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new DOMException('Folder permission denied.', 'NotAllowedError')
      }
      const listing = await scanSyncDirectory(directory)
      update({ directory, connected: true, listing, binding: null, autosave: false, pendingOpen: null, status: 'Folder connected.' })
      try { await rememberSyncDirectory(directory) }
      catch (error) { update({ error: `This folder is connected for this session but could not be remembered. ${directorySyncError(error)}` }) }
    }, false)
  }

  const resync = () => run(async () => {
    const directory = latest.current.directory
    if (!directory) throw new Error('Choose a folder first.')
    // Permission requests must originate in an explicit gesture, never the autosave timer.
    if (await directory.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new DOMException('Folder permission denied.', 'NotAllowedError')
    }
    update({ connected: true })
    await refresh(directory)
    const active = latest.current.binding
    if (active && active.documentId === actions.current.getSnapshot().documentId) {
      const disk = await readDirectoryProject(directory, active.name)
      if (disk.content !== active.content) {
        throw new Error('The project file changed outside Playwood. Duplicate your project to keep your edits, or open the file again to load its changes.')
      }
    }
    update({ status: 'Folder resynced.' })
  })

  const forget = () => run(async () => {
    await forgetSyncDirectory()
    update({ directory: null, connected: false, listing: emptyListing(), binding: null, autosave: false, pendingOpen: null, status: '' })
  })

  const assertSource = (source: ProjectSnapshot) => {
    const current = actions.current.getSnapshot()
    if (current.documentId !== source.documentId || current.project !== source.project) {
      throw new Error('The workspace changed while reading the file. Try opening it again.')
    }
  }

  const saveSnapshot = useCallback(async (directory: DirectoryHandle, source: ProjectSnapshot) => {
    const previous = latest.current.binding
    const active = previous?.documentId === source.documentId ? previous : null
    const content = serialize(source.project)
    let name = active?.name
    if (active) await overwriteDirectoryProject(directory, active.name, active.content, content)
    else name = await writeNewDirectoryFile(directory, source.project.name, 'project', content)
    if (actions.current.getSnapshot().documentId === source.documentId) {
      update({ binding: { documentId: source.documentId, name: name!, content, savedProject: JSON.stringify(source.project) }, status: 'Saved to folder.' })
    }
    // An autosave need not reparse every other project and assembly in the folder.
    const listing = latest.current.listing
    const entry = { name: name!, title: source.project.name }
    const projects = [...listing.projects.filter(item => item.name !== name), entry]
      .sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name))
    update({ listing: { ...listing, projects, errors: listing.errors.filter(message => !message.startsWith(`${name}:`)) } })
  }, [update])

  const save = useCallback(() => run(async () => {
    const source = actions.current.getSnapshot()
    const directory = await directoryWithAccess()
    await saveSnapshot(directory, source)
  }), [directoryWithAccess, run, saveSnapshot])

  const openFile = async (directory: DirectoryHandle, name: string, source: ProjectSnapshot) => {
    const loaded = await readDirectoryProject(directory, name)
    assertSource(source)
    actions.current.replaceProject(loaded.project)
    const opened = actions.current.getSnapshot()
    update({ binding: { documentId: opened.documentId, name, content: loaded.content, savedProject: JSON.stringify(opened.project) }, autosave: false, pendingOpen: null, status: 'Project opened from folder.' })
    actions.current.notify('Project opened from folder. Undo restores the previous workspace.')
  }

  const openProject = (name: string) => {
    if (latest.current.busy) return
    const source = actions.current.getSnapshot()
    const active = latest.current.binding
    if (!active || active.documentId !== source.documentId || active.savedProject !== JSON.stringify(source.project)) {
      update({ pendingOpen: { name, source }, error: '' })
      return
    }
    return run(async () => openFile(await directoryWithAccess(), name, source), false)
  }

  const confirmOpen = (saveFirst: boolean) => run(async () => {
    const pending = latest.current.pendingOpen
    if (!pending) return
    assertSource(pending.source)
    const directory = await directoryWithAccess()
    if (saveFirst) await saveSnapshot(directory, pending.source)
    await openFile(directory, pending.name, pending.source)
  })

  const duplicate = (name?: string) => run(async () => {
    const source = actions.current.getSnapshot().project
    const directory = await directoryWithAccess()
    const original = name ? (await readDirectoryProject(directory, name)).project : source
    const copy = { ...original, name: `${original.name.slice(0, 75)} copy` }
    const filename = await writeNewDirectoryFile(directory, copy.name, 'project', serialize(copy))
    await refresh(directory)
    update({ status: `Copy saved as ${filename}.` })
    actions.current.notify('Project duplicated in the folder.')
  })

  const insertAssembly = (name: string) => run(async () => {
    const source = actions.current.getSnapshot()
    const definition = await readDirectoryAssembly(await directoryWithAccess(), name)
    assertSource(source)
    actions.current.insertAssembly(definition)
  }, false)

  const exportAssembly = (id: string) => run(async () => {
    const source = actions.current.getSnapshot().project
    const file = createAssemblyFile(source, id)
    const directory = await directoryWithAccess()
    const name = await writeNewDirectoryFile(directory, file.definition.name, 'assembly', JSON.stringify(file, null, 2))
    await refresh(directory)
    update({ status: `Assembly saved as ${name}.` })
    actions.current.notify('Assembly exported to folder.')
  })

  const importAssembly = (file: File) => run(async () => {
    if (file.size > 2_000_000) throw new Error('Choose an assembly file smaller than 2 MB.')
    const definition = parseAssemblyFile(JSON.parse(await file.text()))
    const directory = await directoryWithAccess()
    await writeNewDirectoryFile(directory, definition.name, 'assembly', JSON.stringify({ format: 'playwood-assembly', version: 1, definition }, null, 2))
    await refresh(directory)
    update({ status: 'Assembly imported into folder.' })
  }, false)

  useEffect(() => {
    if (!state.autosave || !state.connected || state.busy || !binding || !dirty || state.pendingOpen) return
    const timer = window.setTimeout(() => {
      // A replacement can commit before React has cleaned up this timer.
      if (latest.current.autosave && latest.current.binding === binding && actions.current.getSnapshot().documentId === binding.documentId) void save()
    }, 700)
    return () => window.clearTimeout(timer)
  }, [state.autosave, state.connected, state.busy, state.pendingOpen, binding, dirty, projectJson, save])

  useEffect(() => {
    if (!binding || !dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [binding, dirty])

  return {
    supported, loading: state.loading, busy: state.busy, directoryName: state.directory?.name ?? null,
    connected: state.connected, status: state.status, error: state.error,
    scanErrors: state.listing.errors, projects: state.listing.projects, assemblies: state.listing.assemblies,
    activeFile: binding?.name ?? null, dirty, autosave: state.autosave && !!binding,
    pendingOpen: state.pendingOpen?.name ?? null,
    headerStatus: state.error && state.directory ? 'Folder sync needs attention' : binding ? state.busy ? 'Syncing folder…' : dirty ? 'Folder has unsaved changes' : 'Saved to folder' : undefined,
    readPreview, choose, resync, forget, save, duplicate, openProject, confirmOpen, insertAssembly, exportAssembly, importAssembly,
    cancelOpen: () => update({ pendingOpen: null }),
    setAutosave: (enabled: boolean) => update({ autosave: enabled && !!binding && state.connected }),
  }
}
