export type Vec3 = [number, number, number]
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
export interface Project { version: 1; name: string; panels: Panel[]; connections: Connection[] }
export interface AttachmentOptions { side: Side; type: ConnectorType; offset: number; inset: number; flip: boolean; color: string; count: number }
export interface ValidationIssue { id: string; severity: 'warning' | 'error'; message: string; panelIds: string[] }
export type CameraView = 'perspective' | 'front' | 'top' | 'right'
