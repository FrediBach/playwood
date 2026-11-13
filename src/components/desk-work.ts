/**
 * A deterministic desk-work story shared by a seated person and the screen they
 * use. Both sides evaluate the same seed and clock, so keystrokes, cursor moves,
 * clicks and scrolling line up without the components talking to each other.
 * Screen positions are normalised: u runs left to right, v top to bottom.
 */

export type WorkActivity = 'typing' | 'reading' | 'pointing' | 'thinking'

/** One story repeats every cycle with a new plan, document and words. */
export const WORK_CYCLE = 42
const PLANS: readonly (readonly (readonly [WorkActivity, number])[])[] = [
  [['typing', 10], ['pointing', 4], ['reading', 8], ['typing', 9], ['thinking', 4], ['pointing', 3], ['reading', 4]],
  [['reading', 8], ['pointing', 4], ['typing', 12], ['thinking', 5], ['typing', 8], ['pointing', 5]],
  [['pointing', 4], ['typing', 11], ['reading', 9], ['thinking', 4], ['typing', 9], ['pointing', 5]],
]

export const SIDEBAR_ITEMS = 6
export const TOOLBAR_BUTTONS = 5
export const CHAR_WIDTH = 0.0112
export const LINE_HEIGHT = 0.052
export const CONTENT = { left: 0.3, right: 0.95, top: 0.2, bottom: 0.96 } as const
export const VISIBLE_LINES = Math.floor((CONTENT.bottom - CONTENT.top) / LINE_HEIGHT)
export const CHARS_PER_LINE = Math.floor((CONTENT.right - CONTENT.left) / CHAR_WIDTH)
/** Where the pointer rests while the person reads or types. */
export const POINTER_HOME: readonly [number, number] = [0.66, 0.62]

export const sidebarItem = (index: number): [number, number] => [0.12, 0.17 + index * 0.085]
export const toolbarButton = (index: number): [number, number] => [0.33 + index * 0.06, 0.125]

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const mix = (...parts: number[]) => parts.reduce((hash, part) => Math.imul(hash ^ (part >>> 0), 16777619) >>> 0, 2166136261)
const smooth = (value: number) => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t) }

interface Typing {
  /** Seconds into the segment of every key, including the space after each word. */
  times: number[]
  /** -1 is the person's left hand, 1 the right; the space bar uses the thumb of the last hand. */
  hands: (-1 | 1)[]
  /** Across the keyboard, -1 at the person's left to 1 at the right. */
  columns: number[]
  words: number[]
  /** Pauses longer than half a second, as [start, end]. */
  pauses: [number, number][]
}

const typingCache = new Map<number, Typing>()
function simulateTyping(key: number, duration: number): Typing {
  const cached = typingCache.get(key)
  if (cached) return cached
  const next = random(key)
  const typing: Typing = { times: [], hands: [], columns: [], words: [], pauses: [] }
  let time = 0.4 + next() * 0.4, sincePause = 0, pauseAfter = 4 + Math.floor(next() * 5)
  while (true) {
    const length = 2 + Math.floor(next() * 7)
    if (time + length * 0.15 > duration - 0.35) break
    for (let index = 0; index < length; index++) {
      const hand = next() < 0.5 ? -1 : 1
      typing.times.push(time)
      typing.hands.push(hand)
      typing.columns.push(hand * (0.15 + next() * 0.75))
      time += 0.08 + next() * 0.12
    }
    typing.times.push(time)
    typing.hands.push(typing.hands[typing.hands.length - 1])
    typing.columns.push(0)
    typing.words.push(length)
    time += 0.1 + next() * 0.14
    if (++sincePause >= pauseAfter) {
      const pause = 0.7 + next() * 1.3
      typing.pauses.push([time, time + pause])
      time += pause
      sincePause = 0
      pauseAfter = 4 + Math.floor(next() * 5)
    }
  }
  if (typingCache.size > 64) typingCache.clear()
  typingCache.set(key, typing)
  return typing
}

interface Move { start: number; end: number; from: [number, number]; to: [number, number]; target: 'sidebar' | 'toolbar' | 'home'; index: number }
function simulatePointing(key: number, duration: number): Move[] {
  const next = random(key)
  const moves: Move[] = []
  let time = 0.2 + next() * 0.3, at: [number, number] = [...POINTER_HOME]
  const count = duration >= 4.5 ? 3 : 2
  for (let index = 0; index < count; index++) {
    const last = index === count - 1
    const sidebar = !last && (index === 0 || next() < 0.5)
    const slot = Math.floor(next() * (sidebar ? SIDEBAR_ITEMS : TOOLBAR_BUTTONS))
    const to: [number, number] = last ? [...POINTER_HOME] : sidebar ? sidebarItem(slot) : toolbarButton(slot)
    const travel = 0.45 + Math.hypot(to[0] - at[0], to[1] - at[1]) * 0.9 + next() * 0.2
    moves.push({ start: time, end: time + travel, from: at, to, target: last ? 'home' : sidebar ? 'sidebar' : 'toolbar', index: slot })
    time += travel + 0.35 + next() * 0.5
    at = to
  }
  // Squeeze a short segment so the pointer is home again before it ends.
  const scale = Math.min(1, (duration - 0.25) / time)
  return moves.map(move => ({ ...move, start: move.start * scale, end: move.end * scale }))
}

function scrollTicks(key: number, duration: number) {
  const next = random(key)
  const ticks: [number, number][] = []
  for (let time = 1 + next() * 0.8; time < duration - 0.4; time += 1.1 + next() * 1.1) ticks.push([time, 2 + Math.floor(next() * 3)])
  return ticks
}

/** Lines of the document that exist before anyone types, as fractions of a full line. */
export function documentLines(docSeed: number) {
  const next = random(docSeed)
  const lines: number[] = []
  const paragraphs = 3 + Math.floor(next() * 3)
  for (let paragraph = 0; paragraph < paragraphs; paragraph++) {
    const count = 2 + Math.floor(next() * 4)
    for (let line = 0; line < count; line++) lines.push(line === count - 1 ? 0.25 + next() * 0.5 : 0.82 + next() * 0.17)
    lines.push(0)
  }
  return lines
}

/** Word lengths laid out into lines; returns the line and column after the last character. */
export function layoutWords(words: readonly number[]) {
  const lines: number[][] = [[]]
  let column = 0
  for (const length of words) {
    if (column > 0 && column + length > CHARS_PER_LINE) { lines.push([]); column = 0 }
    lines[lines.length - 1].push(length)
    column += length + 1
  }
  return { lines, column: Math.max(0, column - 1) }
}

export interface WorkFrame {
  activity: WorkActivity
  /** Seconds into the activity and its length. */
  elapsed: number
  duration: number
  /** The sidebar item, and so the document, in front. */
  selection: number
  docSeed: number
  /** Word lengths typed into this document; the last may be partial. */
  typed: number[]
  /** The caret is at the end of a word, waiting for the next one. */
  afterSpace: boolean
  caretVisible: boolean
  /** Lines scrolled out at the top of the document view. */
  scroll: number
  cursor: [number, number]
  cursorVisible: boolean
  /** Seconds since the last click, and where it happened. */
  clickAge: number
  clicked: { target: 'sidebar' | 'toolbar' | 'home'; index: number } | null
  /** Seconds since each hand last struck a key, [left, right]. */
  keyAge: [number, number]
  keyColumn: number
  /** Typing has paused for a moment. */
  pausing: boolean
  /** Where the person looks on the screen; v may go above the screen when thinking. */
  gaze: [number, number]
}

const segmentKey = (seed: number, cycle: number, segment: number) => mix(seed, cycle, segment)

/** The caret's line in document coordinates, after the existing lines. */
export function caretLine(docSeed: number, typed: readonly number[]) {
  return documentLines(docSeed).length + layoutWords(typed).lines.length - 1
}

function typedUntil(typing: Typing, elapsed: number) {
  const words: number[] = []
  let keys = 0
  while (keys < typing.times.length && typing.times[keys] <= elapsed) keys++
  let remaining = keys, afterSpace = false
  for (const length of typing.words) {
    if (remaining <= 0) break
    if (remaining <= length) { words.push(remaining); remaining = 0; break }
    words.push(length)
    remaining -= length + 1
    afterSpace = remaining >= 0
  }
  return { words, keys, afterSpace: remaining === 0 && afterSpace }
}

/** Seed 0 at time 0 starts a cycle; the seed also offsets the clock so desks do not move in step. */
export function workFrame(seed: number, clock: number): WorkFrame {
  const time = clock + (seed % 997) * 0.37
  const cycle = Math.floor(time / WORK_CYCLE)
  const within = time - cycle * WORK_CYCLE
  const plan = PLANS[mix(seed, cycle) % PLANS.length]
  let selection = mix(seed, cycle, 7) % SIDEBAR_ITEMS
  let typed: number[] = [], scroll = 0, start = 0, cursor: [number, number] = [...POINTER_HOME]
  let clickAge = Infinity, clicked: WorkFrame['clicked'] = null

  const docOf = (index: number) => mix(seed, cycle, 101 + index)
  const maxScroll = (doc: number, words: readonly number[]) => Math.max(0, caretLine(doc, words) + 2 - VISIBLE_LINES)
  const caretScroll = (doc: number, words: readonly number[]) => Math.max(0, caretLine(doc, words) + 3 - VISIBLE_LINES)

  for (let segment = 0; segment < plan.length; segment++) {
    const [activity, duration] = plan[segment]
    const end = start + duration
    const current = within < end
    const elapsed = current ? within - start : duration
    const key = segmentKey(seed, cycle, segment)
    const doc = docOf(selection)
    let frame: WorkFrame | null = null
    const base = (): WorkFrame => ({
      activity, elapsed, duration, selection, docSeed: doc, typed, afterSpace: false, caretVisible: false, scroll, cursor,
      cursorVisible: true, clickAge, clicked, keyAge: [Infinity, Infinity], keyColumn: 0, pausing: false, gaze: [0.6, 0.5],
    })

    if (activity === 'typing') {
      const typing = simulateTyping(key, duration)
      const now = typedUntil(typing, elapsed)
      const words = [...typed]
      // A word continued from before the space starts a new word.
      words.push(...now.words)
      if (current) {
        const keyAge: [number, number] = [Infinity, Infinity]
        for (let index = now.keys - 1; index >= 0; index--) {
          const hand = typing.hands[index] < 0 ? 0 : 1
          if (keyAge[hand] === Infinity) keyAge[hand] = elapsed - typing.times[index]
          if (keyAge[0] !== Infinity && keyAge[1] !== Infinity) break
        }
        const pausing = typing.pauses.some(([from, to]) => elapsed >= from && elapsed < to) || elapsed < typing.times[0]
        const nextScroll = now.keys ? caretScroll(doc, words) : scroll
        const layout = layoutWords(words)
        const line = documentLines(doc).length + layout.lines.length - 1 - nextScroll
        const caret: [number, number] = [CONTENT.left + layout.column * CHAR_WIDTH, CONTENT.top + (line + 0.5) * LINE_HEIGHT]
        frame = {
          ...base(), typed: words, afterSpace: now.afterSpace, scroll: nextScroll, cursorVisible: false, keyAge,
          keyColumn: now.keys ? typing.columns[now.keys - 1] : 0, pausing,
          // Blink while paused; a steady caret while keys arrive.
          caretVisible: !pausing || Math.floor(elapsed * 1.9) % 2 === 0,
          // During a pause the eyes drift back over the paragraph just written.
          gaze: pausing ? [CONTENT.left + 0.2 + 0.15 * Math.sin(elapsed * 1.3), caret[1] - LINE_HEIGHT] : caret,
        }
      } else {
        typed = words
        if (now.keys) scroll = caretScroll(doc, words)
      }
    } else if (activity === 'pointing') {
      const moves = simulatePointing(key, duration)
      let at = cursor
      for (const move of moves) {
        if (elapsed < move.start) break
        const t = smooth((elapsed - move.start) / (move.end - move.start))
        // A slight arc, as a hand pushing a mouse makes.
        const lift = Math.sin(t * Math.PI) * 0.04
        at = [move.from[0] + (move.to[0] - move.from[0]) * t, move.from[1] + (move.to[1] - move.from[1]) * t - lift]
        if (elapsed >= move.end && move.target !== 'home') {
          clickAge = elapsed - move.end
          clicked = { target: move.target, index: move.index }
          if (move.target === 'sidebar' && move.index !== selection) {
            selection = move.index
            typed = []
            scroll = 0
          }
        }
      }
      cursor = at
      if (current) frame = { ...base(), selection, docSeed: docOf(selection), typed, scroll, cursor: at, clickAge, clicked, gaze: at }
      else { cursor = [...POINTER_HOME]; clickAge = Infinity; clicked = null }
    } else if (activity === 'reading') {
      const limit = maxScroll(doc, typed)
      let offset = 0
      for (const [tick, lines] of scrollTicks(key, duration)) offset += lines * smooth((elapsed - tick) / 0.35)
      const read = Math.min(Math.max(limit, scroll), scroll + offset)
      if (current) {
        // Eyes run along a line and drop to the next one every couple of seconds.
        const line = Math.floor(elapsed / 2.1) % 6
        const along = (elapsed % 2.1) / 2.1
        frame = { ...base(), scroll: read, gaze: [CONTENT.left + 0.04 + along * 0.55, CONTENT.top + (2.5 + line) * LINE_HEIGHT] }
      } else scroll = read
    } else if (current) {
      // Thinking: the gaze drifts above and beside the screen.
      frame = { ...base(), caretVisible: Math.floor(elapsed * 1.9) % 2 === 0, cursorVisible: false,
        gaze: [0.5 + 0.35 * Math.sin(elapsed * 0.7), -0.25 + 0.1 * Math.cos(elapsed * 0.9)] }
    }
    if (frame) return frame
    start = end
  }
  // Floating point can land exactly on the cycle end; begin the next cycle.
  return workFrame(seed, clock + 1e-6)
}

/** A representative moment for previews that do not animate: mid-sentence. */
export function staticWorkTime(seed: number) {
  const offset = (seed % 997) * 0.37
  for (let cycle = 0; cycle < 8; cycle++) {
    const plan = PLANS[mix(seed, cycle) % PLANS.length]
    let start = 0
    for (const [activity, duration] of plan) {
      if (activity === 'typing') return cycle * WORK_CYCLE + start + Math.min(6, duration - 1) - offset
      start += duration
    }
  }
  return 6 - offset
}
