export type Vec3 = [number, number, number]
export type RotationAxis = 'x' | 'y' | 'z'
export type Material = 'birch' | 'oak' | 'walnut' | 'mdf' | 'osb' | 'nazena' | 'painted'
export type Pattern = 'solid' | 'pegboard' | 'slots'
export type Side = 'left' | 'right' | 'top' | 'bottom' | 'front' | 'back'
export type ConnectorType = '90' | '105' | '150' | 't' | 'cross'
export type ConnectorMaterial = 'plastic' | 'metal'
/** Panel-relative coordinates, from the top-left corner, in the range 0–1. */
export interface OutlinePoint { x: number; y: number }
/** A fixed-size purchased insert. Centers are millimeters from the panel's top-left. */
export interface TrofastInsert {
  id: string; itemId: string; colorId: string; x: number; y: number;
  quarterTurn?: boolean;
  /** Local Z face carrying the rim; it must face upward in the installed project. */
  face: 1 | -1;
}
export interface Panel {
  id: string; name: string; width: number; height: number; thickness: number;
  material: Material; color: string; pattern: Pattern;
  /** 0 keeps the natural texture; 1 covers it with solid color. Defaults to 0. */
  finishCoverage?: number;
  position: Vec3; rotation: Vec3; visible: boolean;
  holeSize: number; holeSpacing: number; cornerRadius?: number;
  customOutline?: OutlinePoint[];
  trofastInserts?: TrofastInsert[];
}
export interface Connection {
  id: string; parentId: string; childId: string; type: ConnectorType;
  /** Supplemental hardware that does not determine the child's transform. */
  role?: 'support';
  /** A supplemental T/cross joint may leave unused clamp openings. */
  partial?: boolean;
  /** Child's width/height axes are turned 90 degrees within its clamp plane. */
  quarterTurn?: boolean;
  /** Child custom-outline edge for a 90° rim joint or either branch of a complete T with the rim as its stem. */
  outlineEdge?: number;
  side: Side; offset: number; inset: number; flip: boolean;
  color: string; count: number;
  /** Omitted in older projects; defaults to plastic. Metal is available for 90° only. */
  material?: ConnectorMaterial;
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
export interface ConnectorOverride { color?: string; type?: ConnectorType; material?: ConnectorMaterial; removed?: boolean; slide?: number }
export type ListKind = 'panels' | 'connectors'
/** Flat organizational folders; independent of physical assemblies and joints. */
export interface ListGroup { id: string; name: string; kind: ListKind; itemIds: string[] }
export interface PaletteColor { id: string; name: string; color: string }
export interface NiceValuesSettings { enabled: boolean; step: number }
export type ConstraintReference = 'min' | 'center' | 'max'
/** Omitted relation preserves the original exact floor/dimension save format. */
export type ConstraintRequirement =
  | { relation?: 'exact'; value: number }
  | { relation: 'minimum' | 'maximum'; value: number }
  | { relation: 'range'; min: number; max: number }
interface DesignConstraintBase { id: string; enabled: boolean }
/** User-authored design requirements, distinct from physical connector joints. */
export type DesignConstraint = DesignConstraintBase & (
  | ({ kind: 'floor'; panelId: string; reference: ConstraintReference } & ConstraintRequirement)
  | ({ kind: 'dimension'; panelId: string; dimension: 'width' | 'height' } & ConstraintRequirement)
  | { kind: 'equal-dimension'; panelIds: [string, string]; dimension: 'width' | 'height' }
  | { kind: 'level'; panelIds: [string, string]; references: [ConstraintReference, ConstraintReference] }
  /** Ordered from the first panel's maximum to the second panel's minimum. */
  | ({ kind: 'gap'; panelIds: [string, string]; axis: 'x' | 'y' | 'z'; relation: 'exact' | 'minimum' | 'maximum' | 'range' } & ConstraintRequirement)
)
export interface SpaceConstraint { enabled: boolean; width: number; height: number; depth: number; centerX: number; centerZ: number }

export interface Project {
  spaceConstraint?: SpaceConstraint;
  version: 1; name: string; panels: Panel[]; connections: Connection[]; assemblies?: AssemblyData;
  /** Additional panel finish swatches, saved with this project. */
  customColors?: PaletteColor[];
  /** Per-piece hardware edits, keyed by serialized [connectionId, placementIndex].
   * Joint connections retain the layout independently of the installed hardware. */
  connectorOverrides?: Record<string, ConnectorOverride>;
  listGroups?: ListGroup[];
  connectorOrder?: string[];
  /** Optional in legacy saves; measurements and status are derived from resolved geometry. */
  constraints?: DesignConstraint[];
  /** Rounds editable lengths on acceptance; omitted legacy saves leave it off. */
  niceValues?: NiceValuesSettings;
}
export interface AttachmentOptions { side: Side; type: ConnectorType; offset: number; inset: number; flip: boolean; color: string; count: number; material?: ConnectorMaterial }
export interface ValidationIssue { id: string; severity: 'warning' | 'error'; message: string; panelIds: string[] }
export type CameraView = 'perspective' | 'front' | 'top' | 'right'
