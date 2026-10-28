import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import type { ConnectorType } from '@/lib/types'

export function IconButton({label,children,...props}: React.ComponentProps<typeof Button>&{label:string}) {return <Tooltip label={label}><Button variant="ghost" size="icon" aria-label={label} {...props}>{children}</Button></Tooltip>}
export function ConnectorGlyph({type}: {type:ConnectorType}) {return <svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">{type==='90'?<path d="M10 7v19h19"/>:type==='105'?<path d="M13 7 8 26h21"/>:type==='150'?<path d="m5 14 12 12h15"/>:type==='t'?<path d="M5 12h26M18 12v19"/>:<path d="M5 18h26M18 5v26"/>}</g></svg>}
