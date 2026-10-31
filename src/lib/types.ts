export type Vec3 = [number, number, number]
export type RotationAxis = 'x' | 'y' | 'z'
export type Material = 'birch' | 'oak' | 'walnut' | 'mdf' | 'painted'
export type Pattern = 'solid' | 'pegboard' | 'slots'
export type Side = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back'
export type ConnectorType = '90' | '105' | '150' | 't' | 'cross'
/** Panel-relative coordinates, from the top-left corner, in the range 0–1. */
export interface OutlinePoint { x: number; y: number }
export interface Panel {
  id: string; name: string; width: number; height: number; thickness: number;
  material: Material; color: string; pattern: Pattern;
  /** 0 keeps the natural texture; 1 covers it with solid color. Defaults to 0. */
  finishCoverage?: number;
  position: Vec3; rotation: Vec3; visible: boolean;
  holeSize: number; holeSpacing: number; cornerRadius?: number;
  customOutline?: OutlinePoint[];
}
export interface Connection {
  id: string; parentId: string; childId: string; type: ConnectorType;
  /** Supplemental hardware that does not determine the child's transform. */
  role?: 'support';
  /** A supplemental T/cross joint may leave unused clamp openings. */
  partial?: boolean;
  /** Child's width/height axes are turned 90 degrees within its clamp plane. */
  quarterTurn?: boolean;
  side: Side; offset: number; inset: number; flip: boolean;
  color: string; count: number;
}
export interface AssemblyPort { id: string; connectionId: string; label: string }
export type AssemblyDimension = 'width' | 'height' | 'thickness'
export interface AssemblyParameterBinding { panelId: string; dimension: AssemblyDimension; scale: number; offset: number }
export interface AssemblyParameter { id: string; name: string; defaultValue: number; bindings: AssemblyParameterBinding[] }
export interface AssemblyDefinition { id: string; name: string; panels: Panel[]; connections: Connection[]; ports: AssemblyPort[]; parameters?: AssemblyParameter[] }
export interface AssemblyFinish { color?: string; material?: Material; finishCoverage?: number }
export interface AssemblyInstance {
  id: string; definitionId: string; name: string; position: Vec3; rotation: Vec3;
  /** Stable definition-panel ID to materialized project-panel ID mapping. */
  panelIds: Record<string, string>;
  /** Stable local-connection to materialized-connection IDs, including suppressed corners. */
  connectionIds?: Record<string, string>;
  finish?: AssemblyFinish;
  /** Per-instance values; absent entries inherit the source default. */
  parameterValues?: Record<string, number>;
}
/** Without an instanceId, portId refers to a baked corner on ordinary panels. */
export interface AssemblyEndpoint { instanceId?: string; portId: string }
export interface AssemblyLoosePort { id: string; connection: Connection }
export interface AssemblyLink { id: string; a: AssemblyEndpoint; b: AssemblyEndpoint }
export interface AssemblyData { definitions: AssemblyDefinition[]; instances: AssemblyInstance[]; links: AssemblyLink[]; loosePorts?: AssemblyLoosePort[] }
export interface ConnectorOverride { color?: string; type?: ConnectorType; removed?: boolean; slide?: number }
export type ListKind = 'panels' | 'connectors'
/** Flat organizational folders; independent of physical assemblies and joints. */
export interface ListGroup { id: string; name: string; kind: ListKind; itemIds: string[] }
export interface Project {
  version: 1; name: string; panels: Panel[]; connections: Connection[]; assemblies?: AssemblyData;
  /** Per-piece hardware edits, keyed by serialized [connectionId, placementIndex].
   * Joint connections retain the layout independently of the installed hardware. */
  connectorOverrides?: Record<string, ConnectorOverride>;
  listGroups?: ListGroup[];
  connectorOrder?: string[];
}
export interface AttachmentOptions { side: Side; type: ConnectorType; offset: number; inset: number; flip: boolean; color: string; count: number }
export interface ValidationIssue { id: string; severity: 'warning' | 'error'; message: string; panelIds: string[] }
export type CameraView = 'perspective' | 'front' | 'top' | 'right'
