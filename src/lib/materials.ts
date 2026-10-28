import type { Material } from './types'

export const MATERIALS: {id:Material;name:string;color:string;detail:string}[] = [
  {id:'birch',name:'Birch plywood',color:'#d9bb87',detail:'Light, layered & versatile'},
  {id:'oak',name:'Oak plywood',color:'#bc945e',detail:'A warm, natural grain'},
  {id:'walnut',name:'Walnut plywood',color:'#79563d',detail:'Rich & characterful'},
  {id:'mdf',name:'Natural MDF',color:'#bca17c',detail:'Smooth & uniform'},
  {id:'painted',name:'Painted board',color:'#e8e5db',detail:'Your color, your way'},
]
export const COLORS = [{name:'Natural',color:'#d9bb87'},{name:'Chalk',color:'#e8e5db'},{name:'Charcoal',color:'#414641'},{name:'Sage',color:'#94a18c'},{name:'Terracotta',color:'#bc6c50'},{name:'Blue gray',color:'#778b99'}]

