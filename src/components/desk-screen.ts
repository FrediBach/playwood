import {
  CHAR_WIDTH, CHARS_PER_LINE, CONTENT, LINE_HEIGHT, SIDEBAR_ITEMS, TOOLBAR_BUTTONS, VISIBLE_LINES,
  documentLines, layoutWords, sidebarItem, toolbarButton, type WorkFrame,
} from './desk-work'

/*
 * A small, abstract word processor drawn into a canvas: bars stand in for
 * words, so the screen reads as text at preview distance without tiny glyphs.
 */

const COLORS = {
  desktop: '#5b7470', chrome: '#e6e3da', sidebar: '#d9ddd5', sidebarItem: '#a9b3aa', selected: '#4f7d78',
  page: '#f7f5ef', ink: '#8d958e', heading: '#4c5c58', typed: '#3f4644', caret: '#24302d', button: '#c3c8bf', pressed: '#6f9a93',
} as const

function wordsOfLine(seed: number, fraction: number) {
  let state = seed >>> 0
  const next = () => { state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return state / 4294967296 }
  const words: number[] = []
  const limit = Math.round(fraction * CHARS_PER_LINE)
  for (let column = 0; column < limit;) {
    const length = Math.min(limit - column, 2 + Math.floor(next() * 8))
    words.push(length)
    column += length + 1
  }
  return words
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2))
  context.fill()
}

export function drawWorkScreen(context: CanvasRenderingContext2D, width: number, height: number, frame: WorkFrame) {
  const X = (u: number) => u * width, Y = (v: number) => v * height
  context.fillStyle = COLORS.desktop
  context.fillRect(0, 0, width, height)

  // Window chrome.
  context.fillStyle = COLORS.chrome
  context.fillRect(0, 0, width, Y(0.07))
  ;['#d0866d', '#d7b46a', '#8fb18a'].forEach((color, index) => {
    context.fillStyle = color
    context.beginPath()
    context.arc(X(0.025 + index * 0.025), Y(0.035), Y(0.014), 0, Math.PI * 2)
    context.fill()
  })

  // Sidebar with the open document highlighted.
  context.fillStyle = COLORS.sidebar
  context.fillRect(0, Y(0.07), X(0.24), height)
  const flash = frame.clicked && frame.clickAge < 0.25 ? frame.clicked : null
  for (let index = 0; index < SIDEBAR_ITEMS; index++) {
    const [u, v] = sidebarItem(index)
    const selected = index === frame.selection
    if (selected || (flash?.target === 'sidebar' && flash.index === index)) {
      context.fillStyle = selected ? COLORS.selected : COLORS.pressed
      roundRect(context, X(0.015), Y(v - 0.032), X(0.21), Y(0.064), Y(0.015))
    }
    context.fillStyle = selected ? '#eef3ef' : COLORS.sidebarItem
    roundRect(context, X(u - 0.08), Y(v - 0.01), X(0.08 + ((index * 37) % 7) * 0.012), Y(0.02), Y(0.01))
  }

  // Toolbar.
  context.fillStyle = COLORS.chrome
  context.fillRect(X(0.24), Y(0.07), width, Y(0.1))
  for (let index = 0; index < TOOLBAR_BUTTONS; index++) {
    const [u, v] = toolbarButton(index)
    context.fillStyle = flash?.target === 'toolbar' && flash.index === index ? COLORS.pressed : COLORS.button
    roundRect(context, X(u - 0.02), Y(v - 0.025), X(0.04), Y(0.05), Y(0.01))
  }

  // Page and text.
  context.fillStyle = COLORS.page
  context.fillRect(X(CONTENT.left - 0.03), Y(CONTENT.top - 0.02), X(CONTENT.right - CONTENT.left + 0.05), height)
  context.save()
  context.beginPath()
  context.rect(X(CONTENT.left - 0.03), Y(CONTENT.top - 0.02), X(CONTENT.right - CONTENT.left + 0.05), height)
  context.clip()
  const existing = documentLines(frame.docSeed)
  const typed = layoutWords(frame.typed)
  const first = Math.floor(frame.scroll), shift = frame.scroll - first
  const barHeight = Y(LINE_HEIGHT * 0.36)
  for (let row = -1; row <= VISIBLE_LINES + 1; row++) {
    const line = first + row
    if (line < 0) continue
    const top = Y(CONTENT.top + (row - shift + 0.5) * LINE_HEIGHT) - barHeight / 2
    let words: readonly number[]
    if (line < existing.length) {
      words = line === 0 ? [Math.round(CHARS_PER_LINE * 0.45)] : wordsOfLine(frame.docSeed + line * 7919, existing[line])
      context.fillStyle = line === 0 ? COLORS.heading : COLORS.ink
    } else {
      const index = line - existing.length
      if (index >= typed.lines.length) break
      words = typed.lines[index]
      context.fillStyle = COLORS.typed
    }
    const thick = line === 0 ? barHeight * 1.5 : barHeight
    let column = 0
    for (const length of words) {
      roundRect(context, X(CONTENT.left + column * CHAR_WIDTH), top - (thick - barHeight) / 2, X(length * CHAR_WIDTH) - 1, thick, thick / 2)
      column += length + 1
    }
  }
  if (frame.caretVisible) {
    const line = existing.length + typed.lines.length - 1
    const column = typed.column + (frame.afterSpace ? 1 : 0)
    context.fillStyle = COLORS.caret
    context.fillRect(X(CONTENT.left + column * CHAR_WIDTH) + 1, Y(CONTENT.top + (line - frame.scroll + 0.12) * LINE_HEIGHT), Math.max(1.5, width / 220), Y(LINE_HEIGHT * 0.76))
  }
  context.restore()

  // Scrollbar position.
  const total = Math.max(VISIBLE_LINES, existing.length + typed.lines.length + 2)
  context.fillStyle = COLORS.button
  roundRect(context, X(0.975), Y(CONTENT.top + (CONTENT.bottom - CONTENT.top) * (frame.scroll / total)),
    X(0.008), Y((CONTENT.bottom - CONTENT.top) * Math.min(1, VISIBLE_LINES / total)), X(0.004))

  if (frame.cursorVisible) {
    const [u, v] = frame.cursor
    const x = X(u), y = Y(v), size = height * 0.075
    // A click ripple, then the arrow.
    if (frame.clickAge < 0.35) {
      context.strokeStyle = `rgba(255,255,255,${0.8 * (1 - frame.clickAge / 0.35)})`
      context.lineWidth = Math.max(1, size * 0.08)
      context.beginPath()
      context.arc(x, y, size * (0.3 + frame.clickAge * 2), 0, Math.PI * 2)
      context.stroke()
    }
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x, y + size)
    context.lineTo(x + size * 0.28, y + size * 0.74)
    context.lineTo(x + size * 0.62, y + size * 0.72)
    context.closePath()
    context.fillStyle = '#1d2422'
    context.strokeStyle = '#ffffff'
    context.lineWidth = Math.max(1, size * 0.09)
    context.stroke()
    context.fill()
  }
}

/** A cheap fingerprint of what drawWorkScreen would show, to skip identical redraws. */
export function workScreenKey(frame: WorkFrame, width: number, height: number) {
  const typedChars = frame.typed.reduce((sum, length) => sum + length, 0)
  return [frame.selection, frame.docSeed, typedChars, frame.typed.length, frame.afterSpace, frame.caretVisible,
    Math.round(frame.scroll * height * LINE_HEIGHT), frame.cursorVisible && Math.round(frame.cursor[0] * width),
    frame.cursorVisible && Math.round(frame.cursor[1] * height), frame.clickAge < 0.35 ? Math.round(frame.clickAge * 30) : -1,
  ].join(':')
}
