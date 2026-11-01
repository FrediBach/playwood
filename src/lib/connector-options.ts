import type { ConnectorMaterial, ConnectorType, Side } from './types'

export const SIDES: Side[] = ['left','right','top','bottom','front','back']
export const CONNECTORS: {id:ConnectorType;name:string;description:string}[] = [{id:'90',name:'90°',description:'Right angle'},{id:'105',name:'105°',description:'Open angle'},{id:'150',name:'150°',description:'Wide angle'},{id:'t',name:'T',description:'3-way joint'},{id:'cross',name:'Cross',description:'4-way joint'}]

// Screenshot palette converted to sRGB, plus the available black and white finishes.
export const CONNECTOR_COLORS = [
  { name: 'Red', color: '#ff0000' },
  { name: 'Green', color: '#008002' },
  { name: 'Dark green', color: '#114a11' },
  { name: 'Blue', color: '#0000ff' },
  { name: 'Black', color: '#000000' },
  { name: 'White', color: '#ffffff' },
] as const
export const DEFAULT_CONNECTOR_COLOR = CONNECTOR_COLORS[0].color

export const METAL_CONNECTOR_COLOR = '#b7bcc2'
export const CONNECTOR_MATERIALS = [
  { id: 'plastic', name: 'Plastic', detail: 'Reinforced · colored' },
  { id: 'metal', name: 'Metal', detail: 'Cast silver · 90°' },
] as const

/** Also handles hardware automatically upgraded to T/cross joints. */
export function getConnectorMaterial(type: ConnectorType, material?: ConnectorMaterial): ConnectorMaterial {
  return type === '90' && material === 'metal' ? 'metal' : 'plastic'
}

export function connectorDisplayColor(connector: { type: ConnectorType; color: string; material?: ConnectorMaterial }) {
  return getConnectorMaterial(connector.type, connector.material) === 'metal' ? METAL_CONNECTOR_COLOR : connector.color
}
