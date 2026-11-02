import { useMemo, useState } from 'react'
import { Box3, Vector3 } from 'three'
import { Button } from './ui/button'
import { DialogDescription, DialogTitle } from './ui/dialog'
import { NumberField } from './fields'
import { getProjectBounds } from '@/lib/model'
import { getRoomLayout } from './room-layout'
import type { Panel, Vec3 } from '@/lib/types'

export function MoveCreation({ panels, onMove, onCancel }: {
  panels: Panel[]
  onMove: (delta: Vec3) => void
  onCancel: () => void
}) {
  const [delta, setDelta] = useState<Vec3>([0, 0, 0])
  const { bounds, room } = useMemo(() => {
    const visiblePanels = panels.filter(panel => panel.visible)
    const visibleBounds = getProjectBounds(visiblePanels)
    const roomBounds = visiblePanels.length
      ? new Box3(new Vector3(...visibleBounds.min).multiplyScalar(0.001), new Vector3(...visibleBounds.max).multiplyScalar(0.001))
      : new Box3(new Vector3(-0.4, 0, -0.3), new Vector3(0.4, 0.7, 0.3))
    return { bounds: getProjectBounds(panels), room: getRoomLayout(roomBounds) }
  }, [panels])
  return <>
    <DialogTitle>Move creation</DialogTitle>
    <DialogDescription>Move all panels and connectors together, including hidden panels.</DialogDescription>
    <div className="dialog-form">
      {['Left / right · X', 'Down / up · Y', 'Back / forward · Z'].map((label, index) => <NumberField key={label} label={label} value={delta[index]} onChange={value => setDelta(current => current.map((v, i) => i === index ? value : v) as Vec3)}/>)}
    </div>
    <p className="dialog-note">Negative X moves left; negative Z moves toward the back wall.</p>
    <div className="flex flex-wrap gap-2 mt-4">
      <Button variant="outline" onClick={() => setDelta(current => [-(bounds.min[0] + bounds.max[0]) / 2, current[1], current[2]])}>Center horizontally</Button>
      <Button variant="outline" onClick={() => setDelta(current => [current[0], current[1], room.backZ * 1000 + 50 - bounds.min[2]])}>Near back wall</Button>
      <Button variant="outline" onClick={() => setDelta(current => [current[0], -bounds.min[1], current[2]])}>Place on floor</Button>
    </div>
    <p className="dialog-note">Wall clearance: 50 mm. Undo is available.</p>
    <div className="dialog-footer">
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      <Button disabled={delta.every(value => value === 0)} onClick={() => onMove(delta)}>Move creation</Button>
    </div>
  </>
}
