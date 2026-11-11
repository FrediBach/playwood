import type { Project } from './types'

export const MAX_PROJECT_PANELS=200
export const MAX_PROJECT_CONNECTIONS=400
export const MAX_SAVED_NAME_LENGTH=120

export function assertProjectCounts(panels:number,connections:number) {
  if(panels>MAX_PROJECT_PANELS||connections>MAX_PROJECT_CONNECTIONS)
    throw new Error(`Projects support up to ${MAX_PROJECT_PANELS} panels and ${MAX_PROJECT_CONNECTIONS} connections.`)
}
export function savedNameWithSuffix(name:string,suffix:string) {
  return `${name.slice(0,Math.max(0,MAX_SAVED_NAME_LENGTH-suffix.length))}${suffix}`
}
/** Serialization bounds only; physical fit remains the domain commands' job. */
export function assertProjectSaveBounds(project:Project) {
  assertProjectCounts(project.panels.length,project.connections.length)
  const name=(value:string,label:string)=>{
    if(!value.trim()||value.length>MAX_SAVED_NAME_LENGTH)throw new Error(`${label} must contain 1–${MAX_SAVED_NAME_LENGTH} characters.`)
  }
  name(project.name,'Project name')
  project.panels.forEach(panel=>name(panel.name,'Panel name'))
  project.assemblies?.definitions.forEach(definition=>{
    name(definition.name,'Assembly name')
    assertProjectCounts(definition.panels.length,definition.connections.length)
    definition.panels.forEach(panel=>name(panel.name,'Panel name'))
  })
  project.assemblies?.instances.forEach(instance=>name(instance.name,'Assembly name'))
}
