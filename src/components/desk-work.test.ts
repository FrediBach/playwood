import { describe, expect, it } from 'vitest'
import { POINTER_HOME, WORK_CYCLE, staticWorkTime, workFrame, type WorkActivity } from './desk-work'
import { workScreenKey } from './desk-screen'

const typedChars = (typed: number[]) => typed.reduce((sum, length) => sum + length, 0)

describe('desk work story', () => {
  it('is a pure function of seed and time', () => {
    expect(workFrame(1234, 77.7)).toEqual(workFrame(1234, 77.7))
    expect(workFrame(1234, 77.7)).not.toEqual(workFrame(98, 77.7))
  })

  it('covers typing, pointing, reading and thinking', () => {
    for (const seed of [0, 17, 4242]) {
      const seen = new Set<WorkActivity>()
      // The seed offsets the clock, so two cycles always contain a whole one.
      for (let time = 0; time < WORK_CYCLE * 2; time += 0.25) seen.add(workFrame(seed, time).activity)
      expect([...seen].sort()).toEqual(['pointing', 'reading', 'thinking', 'typing'])
    }
  })

  it('only adds text while typing and strikes keys that the screen shows', () => {
    let previous = workFrame(31, 0)
    let typedDuringTyping = 0
    for (let time = 0.05; time < WORK_CYCLE * 2; time += 0.05) {
      const frame = workFrame(31, time)
      const sameDocument = frame.docSeed === previous.docSeed && frame.activity === previous.activity
      if (sameDocument && frame.activity !== 'typing') expect(typedChars(frame.typed)).toBe(typedChars(previous.typed))
      if (sameDocument && frame.activity === 'typing') {
        const added = typedChars(frame.typed) - typedChars(previous.typed)
        expect(added).toBeGreaterThanOrEqual(0)
        typedDuringTyping += added
        // A new character means one hand has just struck a key.
        if (added > 0) expect(Math.min(...frame.keyAge)).toBeLessThan(0.06)
        if (added > 0) expect(workScreenKey(frame, 384, 216)).not.toBe(workScreenKey(previous, 384, 216))
      }
      previous = frame
    }
    expect(typedDuringTyping).toBeGreaterThan(40)
  })

  it('moves the pointer out from its resting place and back, clicking on arrival', () => {
    let clicks = 0
    let last = workFrame(5, 0)
    for (let time = 0.05; time < WORK_CYCLE; time += 0.05) {
      const frame = workFrame(5, time)
      if (frame.activity !== 'pointing') {
        if (frame.cursorVisible) expect(frame.cursor).toEqual([...POINTER_HOME])
      } else {
        frame.cursor.forEach(value => { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1) })
        if (frame.clickAge < last.clickAge) clicks++
      }
      last = frame
    }
    expect(clicks).toBeGreaterThan(0)
  })

  it('shows a mid-sentence typing moment for still renders', () => {
    for (const seed of [0, 9, 812]) {
      const frame = workFrame(seed, staticWorkTime(seed))
      expect(frame.activity).toBe('typing')
      expect(typedChars(frame.typed)).toBeGreaterThan(0)
    }
  })
})
