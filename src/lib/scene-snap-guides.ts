import { getPhysicalConnectors } from './connector-selection'
import { snapTargets, panelSnapPoints } from './preview-snap'
import type { Project, Vec3 } from './types'

interface GuideProps {
  panels: Project['panels']
  connections: Project['connections']
  connectorOverrides?: Project['connectorOverrides']
  resizeHandles?: { id: string; position: Vec3 }[]
  snapProbe?: { position: Vec3; direction: Vec3 }
  snapDirection?: Vec3
}
interface ActiveSelection {
  connectorSelection: boolean
  activePanelIds: readonly string[]
  activeConnectorIds: readonly string[]
}

/** Resolve guide coordinates in millimeters; transient feedback must match the active selection. */
export function getSceneSnapGuides(props: GuideProps, {connectorSelection, activePanelIds, activeConnectorIds}: ActiveSelection,
  keyboardSnap: { direction: Vec3; handleId?: string } | null) {
  const activePanelIdSet = new Set(activePanelIds)
  const activeConnectorIdSet = new Set(activeConnectorIds)
  const guideProject: Project = { version: 1, name: '', panels: props.panels, connections: props.connections, connectorOverrides: props.connectorOverrides }
  const guideTargets = snapTargets(guideProject, activePanelIds, activeConnectorIds, connectorSelection)
  const keyboardProbe = keyboardSnap?.handleId
    ? props.resizeHandles?.find(handle => handle.id === keyboardSnap.handleId) : undefined
  const probe = props.snapProbe ?? keyboardProbe
  const guideSources = probe ? [probe.position] : connectorSelection
    ? snapTargets(guideProject, [], getPhysicalConnectors(guideProject).filter(piece => !activeConnectorIdSet.has(piece.id)).map(piece => piece.id), true)
    : props.panels.filter(panel => panel.visible && activePanelIdSet.has(panel.id)).flatMap(panelSnapPoints)
  const guideDirection = props.snapProbe?.direction ?? props.snapDirection ?? (keyboardSnap?.direction ?? [0, 0, 0]) as Vec3
  return { targets: guideTargets, sources: guideSources, direction: guideDirection }
}
