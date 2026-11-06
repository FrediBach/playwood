import { parseAssemblyFile } from './assembly-file'
import { ensureProjectPalette } from './custom-colors'
import { repairLegacyExampleInserts } from './legacy-example-inserts'
import { repairLegacyShelf } from './legacy-shelf'
import { parseProject } from './model'
import type { AssemblyDefinition, Project } from './types'

export interface DirectoryFileHandle {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{
    write: (content: string) => Promise<void>
    close: () => Promise<void>
    abort: () => Promise<void>
  }>
}

/** The picker and permission extensions are not yet included in TypeScript's DOM types. */
export interface DirectoryHandle {
  kind: 'directory'
  name: string
  queryPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>
  values: () => AsyncIterable<DirectoryFileHandle | { kind: 'directory'; name: string }>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<DirectoryFileHandle>
}

export interface DirectoryEntry { name: string; title: string }
export interface DirectoryListing { projects: DirectoryEntry[]; assemblies: DirectoryEntry[]; errors: string[] }

const DATABASE_NAME = 'playwood-directory-sync-v1'
const STORE_NAME = 'directory'
const HANDLE_KEY = 'current'
const FILE_LIMIT = 2_000_000
type PickerWindow = Window & {
  showDirectoryPicker?: (options: { id: string; mode: 'readwrite' }) => Promise<DirectoryHandle>
}

export function isDirectorySyncSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function'
}

export function pickSyncDirectory(): Promise<DirectoryHandle> {
  const picker = typeof window === 'undefined' ? undefined : (window as PickerWindow).showDirectoryPicker
  if (!picker) return Promise.reject(new Error('Directory sync is unavailable in this browser. Use a browser with directory access, such as desktop Chrome or Edge.'))
  return picker.call(window, { id: 'playwood-projects', mode: 'readwrite' })
}

async function directoryStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot remember the sync directory.')); return }
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open directory storage.'))
    request.onblocked = () => reject(new Error('Directory storage is busy. Close other Playwood tabs and try again.'))
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const request = operation(transaction.objectStore(STORE_NAME))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Could not remember the sync directory.'))
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('Could not remember the sync directory.'))
    })
  } finally { database.close() }
}

export async function restoreSyncDirectory(): Promise<DirectoryHandle | null> {
  const value: unknown = await directoryStore('readonly', store => store.get(HANDLE_KEY))
  if (!value || typeof value !== 'object' || !('kind' in value) || value.kind !== 'directory' ||
    !('name' in value) || typeof value.name !== 'string' ||
    !('queryPermission' in value) || typeof value.queryPermission !== 'function' ||
    !('requestPermission' in value) || typeof value.requestPermission !== 'function' ||
    !('values' in value) || typeof value.values !== 'function' ||
    !('getFileHandle' in value) || typeof value.getFileHandle !== 'function') return null
  return value as DirectoryHandle
}

export async function rememberSyncDirectory(handle: DirectoryHandle): Promise<void> {
  await directoryStore('readwrite', store => store.put(handle, HANDLE_KEY))
}

export async function forgetSyncDirectory(): Promise<void> {
  await directoryStore('readwrite', store => store.delete(HANDLE_KEY))
}

async function readContent(handle: DirectoryFileHandle): Promise<string> {
  const file = await handle.getFile()
  if (file.size > FILE_LIMIT) throw new Error('Choose a Playwood file smaller than 2 MB.')
  return file.text()
}

function isAssembly(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'format' in value && value.format === 'playwood-assembly'
}

function resemblesProject(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'panels' in value && 'connections' in value
}

export async function scanSyncDirectory(directory: DirectoryHandle): Promise<DirectoryListing> {
  const listing: DirectoryListing = { projects: [], assemblies: [], errors: [] }
  for await (const handle of directory.values()) {
    if (handle.kind !== 'file' || !/\.json$/i.test(handle.name)) continue
    let recognized = /\.playwood(?:-assembly)?\.json$/i.test(handle.name)
    try {
      const value: unknown = JSON.parse(await readContent(handle))
      if (isAssembly(value)) {
        recognized = true
        listing.assemblies.push({ name: handle.name, title: parseAssemblyFile(value).name })
      } else if (resemblesProject(value) || recognized) {
        recognized = true
        listing.projects.push({ name: handle.name, title: parseProject(value).name })
      }
    } catch (error) {
      // Unrelated JSON, including non-JSON text with an unrelated filename, is not a project.
      if (recognized) listing.errors.push(`${handle.name}: ${directorySyncError(error)}`)
    }
  }
  const byTitle = (a: DirectoryEntry, b: DirectoryEntry) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name)
  listing.projects.sort(byTitle)
  listing.assemblies.sort(byTitle)
  return listing
}

export async function readDirectoryProject(directory: DirectoryHandle, name: string): Promise<{ project: Project; content: string }> {
  const content = await readDirectoryPreviewContent(directory, name)
  return { project: parseDirectoryProjectContent(content), content }
}

export async function readDirectoryPreviewContent(directory: DirectoryHandle, name: string): Promise<string> {
  return readContent(await directory.getFileHandle(name))
}

export function parseDirectoryProjectContent(content: string): Project {
  const value: unknown = JSON.parse(content)
  if (isAssembly(value)) throw new Error('Choose a project file. Use Import assembly for reusable assemblies.')
  const parsed = parseProject(value)
  const shelf = (parsed.constraints?.length || parsed.spaceConstraint?.enabled) ? parsed : repairLegacyShelf(parsed)
  const repaired = (parsed.constraints?.length || parsed.spaceConstraint?.enabled) ? shelf : repairLegacyExampleInserts(shelf)
  return ensureProjectPalette(repaired)
}

export async function readDirectoryAssembly(directory: DirectoryHandle, name: string): Promise<AssemblyDefinition> {
  return parseAssemblyFile(JSON.parse(await readContent(await directory.getFileHandle(name))))
}

async function writeContent(handle: DirectoryFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable()
  try { await writable.write(content); await writable.close() }
  catch (error) {
    try { await writable.abort() } catch { /* Preserve the original write failure. */ }
    throw error
  }
}

function checkContentSize(content: string): void {
  if (new TextEncoder().encode(content).length > FILE_LIMIT) throw new Error('This file is larger than the 2 MB import limit. Reduce its size before saving to the directory.')
}

export async function writeNewDirectoryFile(directory: DirectoryHandle, title: string, kind: 'project' | 'assembly', content: string): Promise<string> {
  checkContentSize(content)
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || (kind === 'project' ? 'playwood-project' : 'assembly')
  const extension = kind === 'project' ? '.playwood.json' : '.playwood-assembly.json'
  const occupied = new Set<string>()
  for await (const entry of directory.values()) occupied.add(entry.name.toLowerCase())
  for (let suffix = 1; ; suffix++) {
    const name = `${base}${suffix === 1 ? '' : `-${suffix}`}${extension}`
    if (occupied.has(name.toLowerCase())) continue
    try {
      // Recheck after enumeration: a different tab or application may have added a file.
      await directory.getFileHandle(name)
      continue
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error
    }
    const handle = await directory.getFileHandle(name, { create: true })
    // File System Access has no exclusive-create option. Refuse an unexpected populated file.
    if ((await handle.getFile()).size > 0) continue
    await writeContent(handle, content)
    return name
  }
}

export async function overwriteDirectoryProject(directory: DirectoryHandle, name: string, expectedContent: string, content: string): Promise<void> {
  checkContentSize(content)
  let handle: DirectoryFileHandle
  try { handle = await directory.getFileHandle(name) }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') throw new Error('The project file was removed or renamed outside Playwood. Save a copy or resync and open it again.')
    throw error
  }
  if (await readContent(handle) !== expectedContent) throw new Error('The project file changed outside Playwood. Save a copy to keep your edits, or resync and open the file again.')
  await writeContent(handle, content)
}

export function directorySyncError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Directory access was denied or expired. Click Resync to grant read and write access again.'
    if (error.name === 'NotFoundError') return 'The file or directory was removed or renamed. Resync or choose the directory again.'
    if (error.name === 'QuotaExceededError') return 'There is not enough space to save. Free some space and try again.'
    if (error.name === 'AbortError') return 'The file operation was interrupted. Try saving again.'
    if (error.name === 'InvalidStateError' || error.name === 'NoModificationAllowedError') return 'The file is busy or cannot be written. Close other editors and try again.'
  }
  return error instanceof Error ? error.message : 'The directory could not be read or saved. Try resyncing.'
}
