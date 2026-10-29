export type Vec3 = [number, number, number]
export type RotationAxis = 'x' | 'y' | 'z'
export type Material = 'birch' | 'oak' | 'walnut' | 'mdf' | 'painted'
export type Pattern = 'solid' | 'pegboard' | 'slots'
export type Side = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back'
export type ConnectorType = '90' | '105' | '150' | 't' | 'cross'
export interface Panel {
  id: string; name: string; width: number; height: number; thickness: number;
  material: Material; color: string; pattern: Pattern;
  position: Vec3; rotation: Vec3; visible: boolean;
  holeSize: number; holeSpacing: number;
}
export interface Connection {
  id: string; parentId: string; childId: string; type: ConnectorType;
  /** Supplemental hardware that does not determine the child's transform. */
  role?: 'support';
  side: Side; offset: number; inset: number; flip: boolean;
  color: string; count: number;
}
export interface AssemblyPort { id: string; connectionId: string; label: string }
export interface AssemblyDefinition { id: string; name: string; panels: Panel[]; connections: Connection[]; ports: AssemblyPort[] }
export interface AssemblyFinish { color?: string; material?: Material }
export interface AssemblyInstance {
  id: string; definitionId: string; name: string; position: Vec3; rotation: Vec3;
  /** Stable definition-panel ID to materialized project-panel ID mapping. */
  panelIds: Record<string, string>;
  /** Stable local-connection to materialized-connection IDs, including suppressed corners. */
  connectionIds?: Record<string, string>;
  finish?: AssemblyFinish;
}
export interface AssemblyEndpoint { instanceId: string; portId: string }
export interface AssemblyLink { id: string; a: AssemblyEndpoint; b: AssemblyEndpoint }
export interface AssemblyData { definitions: AssemblyDefinition[]; instances: AssemblyInstance[]; links: AssemblyLink[] }
export interface Project { version: 1; name: string; panels: Panel[]; connections: Connection[]; assemblies?: AssemblyData }
export interface AttachmentOptions { side: Side; type: ConnectorType; offset: number; inset: number; flip: boolean; color: string; count: number }
export interface ValidationIssue { id: string; severity: 'warning' | 'error'; message: string; panelIds: string[] }
export type CameraView = 'perspective' | 'front' | 'top' | 'right'
