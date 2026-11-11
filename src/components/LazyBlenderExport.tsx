import { Component,lazy,Suspense,type ReactNode } from 'react'
import type { Project } from '@/lib/types'

const BlenderExport=lazy(()=>import('./BlenderExport').then(module=>({default:module.BlenderExport})))
class ExportOptionsBoundary extends Component<{children:ReactNode},{error:boolean}> {
  state={error:false}
  static getDerivedStateFromError(){return {error:true}}
  render(){return this.state.error?<p role="alert">3D export options could not load. Project and parts exports are still available. Reload to retry 3D export.</p>:this.props.children}
}
export function LazyBlenderExport({project}:{project:Project}) {
  return <ExportOptionsBoundary><Suspense fallback={<p role="status">Loading 3D export options…</p>}><BlenderExport project={project}/></Suspense></ExportOptionsBoundary>
}
