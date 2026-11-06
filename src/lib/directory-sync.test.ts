import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAssemblyFile } from './assembly-file'
import { createExampleProject } from './example-library'
import { createPanel, createStarterProject } from './model'
import {
  directorySyncError, isDirectorySyncSupported, overwriteDirectoryProject, pickSyncDirectory,
  readDirectoryAssembly, readDirectoryProject, scanSyncDirectory, writeNewDirectoryFile,
  type DirectoryFileHandle, type DirectoryHandle,
} from './directory-sync'

class MemoryDirectory implements DirectoryHandle {
  kind = 'directory' as const
  name = 'Furniture'
  files = new Map<string, string>()
  folders = new Set<string>()
  writes: string[] = []
  aborted: string[] = []
  failWrite = false
  failClose = false
  permission: PermissionState = 'granted'

  async queryPermission() { return this.permission }
  async requestPermission() { return this.permission }
  async *values() {
    for (const name of this.files.keys()) yield await this.getFileHandle(name)
    for (const name of this.folders) yield { name, kind: 'directory' as const }
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<DirectoryFileHandle> {
    if (this.permission !== 'granted') throw new DOMException('No access', 'NotAllowedError')
    if (this.folders.has(name)) throw new DOMException('Is a directory', 'TypeMismatchError')
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException('Not found', 'NotFoundError')
      this.files.set(name, '')
    }
    return {
      kind: 'file', name,
      getFile: async () => {
        const content = this.files.get(name)
        if (content === undefined) throw new DOMException('Not found', 'NotFoundError')
        return new File([content], name)
      },
      createWritable: async () => {
        let candidate = ''
        return {
          write: async content => {
            if (this.failWrite) throw new DOMException('Disk full', 'QuotaExceededError')
            candidate = content
          },
          close: async () => {
            if (this.failClose) throw new DOMException('Could not close', 'NoModificationAllowedError')
            this.files.set(name, candidate)
            this.writes.push(name)
          },
          abort: async () => { this.aborted.push(name) },
        }
      },
    }
  }
}

const blank = () => ({ ...createStarterProject('blank'), name: 'My cabinet' })
const moduleFile = () => {
  const project = createExampleProject('assembly-cube')
  return createAssemblyFile(project, project.assemblies!.instances[0].id)
}

afterEach(() => vi.unstubAllGlobals())

describe('directory sync files', () => {
  it('lists valid projects and assemblies separately, including ordinary JSON filenames', async () => {
    const directory = new MemoryDirectory()
    directory.files.set('cabinet.playwood.json', JSON.stringify(blank()))
    directory.files.set('older.json', JSON.stringify({ ...blank(), name: 'Another cabinet' }))
    directory.files.set('cube.playwood-assembly.json', JSON.stringify(moduleFile()))
    directory.files.set('settings.json', '{"color":"red"}')
    directory.files.set('notes.json', 'Notes, not JSON')
    directory.files.set('image.png', 'not a project')
    directory.folders.add('nested.playwood.json')
    const listing = await scanSyncDirectory(directory)
    expect(listing.projects).toEqual([
      { name: 'older.json', title: 'Another cabinet' },
      { name: 'cabinet.playwood.json', title: 'My cabinet' },
    ])
    expect(listing.assemblies).toEqual([{ name: 'cube.playwood-assembly.json', title: 'Cube module' }])
    expect(listing.errors).toEqual([])
    expect(directory.writes).toEqual([])
  })

  it('reports malformed Playwood files while keeping valid neighboring files available', async () => {
    const directory = new MemoryDirectory()
    directory.files.set('valid.playwood.json', JSON.stringify(blank()))
    directory.files.set('broken.playwood.json', '{')
    directory.files.set('bad-assembly.playwood-assembly.json', JSON.stringify({ ...moduleFile(), version: 99 }))
    directory.files.set('bad-topology.json', JSON.stringify({ ...blank(), connections: [{ parentId: 'missing' }] }))
    directory.files.set('too-large.playwood.json', ' '.repeat(2_000_001))
    const listing = await scanSyncDirectory(directory)
    expect(listing.projects).toHaveLength(1)
    expect(listing.assemblies).toHaveLength(0)
    expect(listing.errors).toHaveLength(4)
    expect(listing.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('broken.playwood.json'), expect.stringContaining('bad-assembly.playwood-assembly.json'),
      expect.stringContaining('bad-topology.json'), expect.stringContaining('2 MB'),
    ]))
  })

  it('validates files on every open and never reads an assembly as a project', async () => {
    const directory = new MemoryDirectory()
    directory.files.set('cabinet.playwood.json', JSON.stringify(blank()))
    const listing = await scanSyncDirectory(directory)
    directory.files.set('cabinet.playwood.json', '{"version":1}')
    await expect(readDirectoryProject(directory, listing.projects[0].name)).rejects.toThrow(/not a playwood/)
    directory.files.set('cube.playwood-assembly.json', JSON.stringify(moduleFile()))
    await expect(readDirectoryProject(directory, 'cube.playwood-assembly.json')).rejects.toThrow(/Import assembly/)
  })

  it('keeps the raw disk content for conflict detection while adopting legacy palette colors', async () => {
    const directory = new MemoryDirectory()
    const project = { ...blank(), panels: [createPanel({ color: '#123456' })] }
    const content = JSON.stringify(project, null, 2)
    directory.files.set('cabinet.playwood.json', content)
    const opened = await readDirectoryProject(directory, 'cabinet.playwood.json')
    expect(opened.content).toBe(content)
    expect(opened.project.customColors).toContainEqual(expect.objectContaining({ color: '#123456' }))
    expect(opened.project.panels[0].id).toBe(project.panels[0].id)
    expect(directory.files.get('cabinet.playwood.json')).toBe(content)
  })

  it('imports independent assembly definitions and rejects a full project as an assembly', async () => {
    const directory = new MemoryDirectory()
    const assembly = moduleFile()
    directory.files.set('cube.playwood-assembly.json', JSON.stringify(assembly))
    const first = await readDirectoryAssembly(directory, 'cube.playwood-assembly.json')
    const second = await readDirectoryAssembly(directory, 'cube.playwood-assembly.json')
    expect(first.id).not.toBe(second.id)
    expect(first.panels).toEqual(second.panels)
    directory.files.set('cabinet.playwood.json', JSON.stringify(blank()))
    await expect(readDirectoryAssembly(directory, 'cabinet.playwood.json')).rejects.toThrow(/Import project/)
  })

  it('saves duplicates to a unique name without touching valid, invalid, or differently cased files and directories', async () => {
    const directory = new MemoryDirectory()
    directory.files.set('MY-CABINET.playwood.json', 'Do not replace this unrelated file')
    directory.files.set('my-cabinet-2.playwood.json', JSON.stringify(blank()))
    directory.folders.add('my-cabinet-3.playwood.json')
    const original = new Map(directory.files)
    const content = JSON.stringify(blank(), null, 2)
    const filename = await writeNewDirectoryFile(directory, 'My cabinet', 'project', content)
    expect(filename).toBe('my-cabinet-4.playwood.json')
    expect(directory.files.get(filename)).toBe(content)
    for (const [name, value] of original) expect(directory.files.get(name)).toBe(value)
    expect(directory.writes).toEqual([filename])
  })

  it('uses portable filenames and the standalone assembly extension', async () => {
    const directory = new MemoryDirectory()
    const content = JSON.stringify(moduleFile())
    const filename = await writeNewDirectoryFile(directory, '../Box / with: brackets?!', 'assembly', content)
    expect(filename).toBe('box-with-brackets.playwood-assembly.json')
    expect(directory.files.get(filename)).toBe(content)
  })

  it('refuses to overwrite external edits or recreate a removed current file', async () => {
    const directory = new MemoryDirectory()
    const original = JSON.stringify(blank())
    const changed = JSON.stringify({ ...blank(), name: 'Edited elsewhere' })
    directory.files.set('cabinet.playwood.json', changed)
    await expect(overwriteDirectoryProject(directory, 'cabinet.playwood.json', original, original)).rejects.toThrow(/changed outside Playwood/)
    expect(directory.files.get('cabinet.playwood.json')).toBe(changed)
    directory.files.delete('cabinet.playwood.json')
    await expect(overwriteDirectoryProject(directory, 'cabinet.playwood.json', original, changed)).rejects.toThrow(/removed or renamed/)
    expect(directory.files.has('cabinet.playwood.json')).toBe(false)
    expect(directory.writes).toEqual([])
  })

  it('saves only when the disk still matches the last read content', async () => {
    const directory = new MemoryDirectory()
    const original = JSON.stringify(blank())
    const changed = JSON.stringify({ ...blank(), name: 'Saved cabinet' })
    directory.files.set('cabinet.playwood.json', original)
    await overwriteDirectoryProject(directory, 'cabinet.playwood.json', original, changed)
    expect(directory.files.get('cabinet.playwood.json')).toBe(changed)
    await expect(overwriteDirectoryProject(directory, 'cabinet.playwood.json', original, 'stale')).rejects.toThrow(/changed outside Playwood/)
    expect(directory.writes).toEqual(['cabinet.playwood.json'])
  })

  it.each(['failWrite', 'failClose'] as const)('aborts a failed %s and retains the previous file', async failure => {
    const directory = new MemoryDirectory()
    const original = JSON.stringify(blank())
    directory.files.set('cabinet.playwood.json', original)
    directory[failure] = true
    await expect(overwriteDirectoryProject(directory, 'cabinet.playwood.json', original, 'replacement')).rejects.toBeInstanceOf(DOMException)
    expect(directory.files.get('cabinet.playwood.json')).toBe(original)
    expect(directory.aborted).toEqual(['cabinet.playwood.json'])
    expect(directory.writes).toEqual([])
  })

  it('enforces the import size limit before writing or opening oversized files', async () => {
    const directory = new MemoryDirectory()
    const oversized = 'é'.repeat(1_000_001)
    await expect(writeNewDirectoryFile(directory, 'Too big', 'project', oversized)).rejects.toThrow(/2 MB/)
    expect(directory.files.size).toBe(0)
    directory.files.set('oversized.playwood.json', oversized)
    await expect(readDirectoryProject(directory, 'oversized.playwood.json')).rejects.toThrow(/2 MB/)
  })

  it('surfaces revoked permission and leaves files untouched', async () => {
    const directory = new MemoryDirectory()
    const original = JSON.stringify(blank())
    directory.files.set('cabinet.playwood.json', original)
    directory.permission = 'denied'
    const error = await overwriteDirectoryProject(directory, 'cabinet.playwood.json', original, 'new').catch(error => error)
    expect(directorySyncError(error)).toMatch(/Resync.*read and write access/)
    expect(directory.files.get('cabinet.playwood.json')).toBe(original)
  })
})

describe('directory picker support', () => {
  it('detects unsupported browsers without affecting ordinary project imports', async () => {
    vi.stubGlobal('window', {})
    expect(isDirectorySyncSupported()).toBe(false)
    await expect(pickSyncDirectory()).rejects.toThrow(/unavailable in this browser/)
  })

  it('requests directory read/write permission from the user-initiated picker', async () => {
    const directory = new MemoryDirectory()
    const picker = vi.fn().mockResolvedValue(directory)
    vi.stubGlobal('window', { showDirectoryPicker: picker })
    expect(isDirectorySyncSupported()).toBe(true)
    expect(await pickSyncDirectory()).toBe(directory)
    expect(picker).toHaveBeenCalledWith({ id: 'playwood-projects', mode: 'readwrite' })
  })
})
