export const GUIDE_CATEGORIES = ['Getting started', 'Connect & build', 'Shape & arrange', 'Reusable assemblies', 'Review & save'] as const

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number]
export type GuideId = 'workspace' | 'first-panel' | 'attach' | 'angles' | 'auto-connect' | 'connect-panel' | 'close-hole' | 'split-panels' | 'move-snap' | 'resize' | 'rotate' | 'copy-paste' | 'multi-select' | 'finishes' | 'custom-outline' | 'groups' | 'assemblies' | 'assembly-attach' | 'assembly-values' | 'assembly-edit' | 'assembly-controls' | 'assembly-files' | 'connectors' | 'review' | 'save-export'

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
