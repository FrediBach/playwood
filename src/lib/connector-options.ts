import type { ConnectorType, Side } from './types'

export const SIDES: Side[] = ['left','right','top','bottom','front','back']
export const CONNECTORS: {id:ConnectorType;name:string;description:string}[] = [{id:'90',name:'90°',description:'Right angle'},{id:'105',name:'105°',description:'Open angle'},{id:'150',name:'150°',description:'Wide angle'},{id:'t',name:'T',description:'3-way joint'},{id:'cross',name:'Cross',description:'4-way joint'}]
