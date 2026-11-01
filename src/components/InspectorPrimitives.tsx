import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

// Keep presentation preferences for this session, independently of project edits.
const expansion = new Map<string, boolean>()

export function InspectorDisclosure({ title, summary, preferenceKey, defaultOpen = false, children, className = '', lazy = false, openRequest = 0, focusTarget }: {
  title: string; summary?: string; preferenceKey?: string; defaultOpen?: boolean;
  children: ReactNode; className?: string; lazy?: boolean; openRequest?: number; focusTarget?: string;
}) {
  const [open, setOpen] = useState(() => preferenceKey ? expansion.get(preferenceKey) ?? defaultOpen : defaultOpen)
  const [mounted, setMounted] = useState(open)
  const details = useRef<HTMLDetailsElement>(null)
  const focusedRequest = useRef(0)
  useEffect(() => { if (openRequest) { setOpen(true); setMounted(true) } }, [openRequest])
  useEffect(() => {
    if (!open || !openRequest || focusedRequest.current === openRequest) return
    focusedRequest.current = openRequest
    if (focusTarget) details.current?.querySelector<HTMLElement>(focusTarget)?.focus()
  }, [open, openRequest, focusTarget])
  return <details ref={details} className={`inspector-disclosure ${className}`} open={open} onToggle={event => {
    const next = event.currentTarget.open
    setOpen(next)
    if (next) setMounted(true)
    if (preferenceKey) expansion.set(preferenceKey, next)
  }}>
    <summary aria-label={title}><span className="inspector-disclosure-label"><ChevronRight size={15}/><span>{title}</span></span>{summary && <span className="inspector-disclosure-summary">{summary}</span>}</summary>
    <div className="inspector-disclosure-content">{(!lazy || mounted || open) && children}</div>
  </details>
}
