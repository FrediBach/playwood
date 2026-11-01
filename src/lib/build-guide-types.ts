export const GUIDE_CATEGORIES = ['Getting started', 'Connect & build', 'Shape & arrange', 'Reusable assemblies', 'Review & save'] as const

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number]
export type GuideId = 'workspace' | 'projects' | 'first-panel' | 'attach' | 'angles' | 'auto-connect' | 'connect-panel' | 'close-hole' | 'split-panels' | 'grid-split' | 'move-snap' | 'snap-settings' | 'resize' | 'rotate' | 'move-creation' | 'rescale' | 'copy-paste' | 'multi-select' | 'box-select' | 'finishes' | 'palette' | 'custom-outline' | 'groups' | 'assemblies' | 'assembly-attach' | 'assembly-values' | 'assembly-edit' | 'assembly-controls' | 'assembly-files' | 'connectors' | 'review' | 'room-preview' | 'save-export'

export interface GuideStep {
  title: string
  instruction: string
  explanation: string
  result: string
  caption: string
  controls?: { label: string; value: string }[]
  tip?: string
}

export interface BuildGuide {
  id: GuideId
  category: GuideCategory
  title: string
  summary: string
  duration: string
  startingPoint: string
  steps: [GuideStep, GuideStep, GuideStep, GuideStep]
  related: GuideId[]
}
