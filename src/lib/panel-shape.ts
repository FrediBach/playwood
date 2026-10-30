import type { Panel } from './types'

/** Clamp at use time so resizing and older project files stay compatible. */
export function panelCornerRadius(panel: Pick<Panel, 'width' | 'height' | 'cornerRadius'>): number {
  return Math.min(Math.max(0, panel.cornerRadius ?? 0), panel.width / 2, panel.height / 2)
}
