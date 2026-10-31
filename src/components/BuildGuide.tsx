import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Clock3, Keyboard, Lightbulb, Search, X } from 'lucide-react'
import { BUILD_GUIDES } from '@/lib/build-guides'
import { GUIDE_CATEGORIES, type BuildGuide as Guide, type GuideId } from '@/lib/build-guide-types'
import { DialogDescription, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { GuidePreview } from './GuidePreview'
import './build-guide.css'

const POSITION_KEY = 'playwood.build-guide.position.v1'
function rememberedPosition(): { id: GuideId; step: number } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(POSITION_KEY) ?? 'null')
    if (saved && BUILD_GUIDES.some(guide => guide.id === saved.id) && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < 4) return saved
  } catch { /* Help remains available when browser storage is disabled. */ }
  return { id: 'workspace', step: 0 }
}

export default function BuildGuide() {
  const [position, setPosition] = useState(rememberedPosition)
  const [section, setSection] = useState<'guides' | 'shortcuts'>('guides')
  const [query, setQuery] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)
  const article = useRef<HTMLElement>(null)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const guideHeading = useRef<HTMLHeadingElement>(null)
  const focusTarget = useRef<'step' | 'guide' | null>(null)
  const guide = BUILD_GUIDES.find(item => item.id === position.id) ?? BUILD_GUIDES[0]
  const step = guide.steps[position.step]
  const search = query.trim().toLocaleLowerCase()
  const matches = BUILD_GUIDES.filter(item => `${item.title} ${item.category} ${item.summary} ${item.steps.map(value => `${value.title} ${value.instruction}`).join(' ')}`.toLocaleLowerCase().includes(search))

  useEffect(() => {
    try { sessionStorage.setItem(POSITION_KEY, JSON.stringify(position)) } catch { /* Optional reading position. */ }
    article.current?.scrollTo({ top: 0 })
    if (focusTarget.current === 'step') stepHeading.current?.focus({ preventScroll: true })
    if (focusTarget.current === 'guide') guideHeading.current?.focus({ preventScroll: true })
    focusTarget.current = null
  }, [position])

  const chooseGuide = (id: GuideId) => {
    focusTarget.current = 'guide'
    setPosition({ id, step: 0 })
    setSection('guides')
    setBrowseOpen(false)
  }
  const chooseStep = (index: number) => {
    focusTarget.current = 'step'
    setPosition(current => ({ ...current, step: index }))
  }

  return <>
    <header className="guide-header">
      <div className="guide-heading-icon"><BookOpen size={23}/></div>
      <div><span className="guide-eyebrow">THE PLAYWOOD FIELD GUIDE</span><DialogTitle>Build with confidence.</DialogTitle>
        <DialogDescription>One technique at a time. See the change, learn the steps, make it your own.</DialogDescription></div>
    </header>
    <div className="guide-mode-bar" role="group" aria-label="Help sections">
      <button aria-pressed={section === 'guides'} onClick={() => setSection('guides')}><BookOpen size={16}/>Step-by-step guides<span>{BUILD_GUIDES.length}</span></button>
      <button aria-pressed={section === 'shortcuts'} onClick={() => setSection('shortcuts')}><Keyboard size={16}/>Keyboard shortcuts</button>
    </div>
    {section === 'guides' ? <div className="guide-layout">
      <aside className={`guide-sidebar${browseOpen ? ' is-open' : ''}`} aria-label="Guide library">
        <button className="guide-browse-toggle" aria-expanded={browseOpen} aria-controls="guide-library" onClick={() => setBrowseOpen(value => !value)}>
          <span>Browse {BUILD_GUIDES.length} techniques</span><ChevronDown size={17}/>
        </button>
        <div className="guide-library" id="guide-library">
          <label className="guide-search"><Search size={16}/><input type="search" aria-label="Search guides" placeholder="Find a technique…" value={query} onChange={event => setQuery(event.target.value)}/>
            {query && <button aria-label="Clear guide search" onClick={() => setQuery('')}><X size={14}/></button>}
          </label>
          <p className="guide-result-count" aria-live="polite">{search ? `${matches.length} ${matches.length === 1 ? 'guide' : 'guides'} found` : 'START HERE. BUILD FROM THERE.'}</p>
          <nav aria-label="Building techniques">
            {GUIDE_CATEGORIES.map(category => {
              const items = matches.filter(item => item.category === category)
              return items.length > 0 && <div className="guide-category" key={category}><h3>{category}</h3>{items.map(item => <button key={item.id} data-guide-id={item.id} aria-current={item.id === guide.id ? 'page' : undefined} onClick={() => chooseGuide(item.id)}>
                <span>{item.title}</span><ArrowRight size={14}/>
              </button>)}</div>
            })}
          </nav>
          {!matches.length && <div className="guide-empty"><p>No matching techniques.</p><p>Try “panel”, “copy”, or “connector”.</p><button onClick={() => setQuery('')}>Show all guides</button></div>}
        </div>
      </aside>
      <article className="guide-article" ref={article} aria-label={guide.title}>
        <div className="guide-article-heading">
          <div className="guide-meta"><span>{guide.category}</span><span><Clock3 size={13}/>{guide.duration}</span></div>
          <h2 ref={guideHeading} tabIndex={-1}>{guide.title}</h2><p>{guide.summary}</p>
          <div className="guide-start"><strong>Start here</strong><span>{guide.startingPoint}</span></div>
        </div>
        <nav className="guide-step-nav" aria-label="Lesson steps">
          {guide.steps.map((item, index) => <button key={item.title} aria-label={`Step ${index + 1}: ${item.title}`} aria-current={position.step === index ? 'step' : undefined} onClick={() => chooseStep(index)}>
            <span>{String(index + 1).padStart(2, '0')}</span><span>{item.title}</span>
          </button>)}
        </nav>
        <div className="guide-step-content">
          <div className="guide-illustration"><GuidePreview guideId={guide.id} step={position.step} caption={step.caption}/>
            <p className="guide-example-note">Illustrated example · your project stays as it is.</p>
          </div>
          <section className="guide-instructions" aria-labelledby="guide-step-title">
            <span className="guide-eyebrow">STEP {position.step + 1} OF 4</span>
            <h3 id="guide-step-title" ref={stepHeading} tabIndex={-1}>{step.title}</h3>
            <p className="guide-action">{step.instruction}</p>
            {step.controls && <dl className="guide-control-values">{step.controls.map(control => <div key={control.label}><dt>{control.label}</dt><dd>{control.value}</dd></div>)}</dl>}
            <p className="guide-explanation">{step.explanation}</p>
            <div className="guide-result"><Check size={16}/><p><strong>What you should see</strong>{step.result}</p></div>
            {step.tip && <div className="guide-tip"><Lightbulb size={16}/><p>{step.tip}</p></div>}
          </section>
        </div>
        <footer className="guide-lesson-footer">
          <Button variant="outline" disabled={position.step === 0} onClick={() => chooseStep(position.step - 1)}><ArrowLeft size={16}/>Previous</Button>
          <span aria-live="polite">Step {position.step + 1} of 4</span>
          {position.step < 3 ? <Button onClick={() => chooseStep(position.step + 1)}>Next step<ArrowRight size={16}/></Button>
            : <Button variant="outline" onClick={() => chooseStep(0)}>Read again<ArrowRight size={16}/></Button>}
        </footer>
        {position.step === 3 && <div className="guide-related"><span>Keep building</span>{guide.related.map(id => {
          const related = BUILD_GUIDES.find(item => item.id === id)
          return related && <button key={id} onClick={() => chooseGuide(id)}>{related.title}<ArrowRight size={14}/></button>
        })}</div>}
      </article>
    </div> : <ShortcutReference onChooseGuide={chooseGuide}/>}
  </>
}

const SHORTCUT_GROUPS = [
  { title: 'Look around', rows: [['Orbit in Perspective', 'Drag'], ['Pan', 'Right-drag / Pan view'], ['Zoom', 'Scroll / + / −'], ['Fit view', 'F']] },
  { title: 'Select & organize', rows: [['Select several panels', 'Shift-click / Ctrl / ⌘-click'], ['Select all', '⌘ / Ctrl A'], ['Rename a list item', 'F2'], ['List reorder: pick up / drop', 'Space / Enter'], ['List reorder: move', '↑ ↓ / Home / End']] },
  { title: 'Move & build', rows: [['Resize panel / connector', 'Drag resize arrow'], ['Move & snap', 'Ctrl + drag'], ['Move in preview · 1 cm', '↑ ↓ ← →'], ['Move further · 10 cm', 'Shift + arrows'], ['Rotate selection 90°', 'X / Y / Z'], ['Copy / paste at a +', '⌘ / Ctrl C / V'], ['Duplicate', '⌘ / Ctrl D']] },
  { title: 'Edit & recover', rows: [['Undo', '⌘ / Ctrl Z'], ['Redo', '⌘ / Ctrl Shift Z'], ['Remove selection', 'Delete / Backspace'], ['Cancel preview / clear selection', 'Esc'], ['Context menu', 'Right-click / Shift F10']] },
]

function ShortcutReference({ onChooseGuide }: { onChooseGuide: (id: Guide['id']) => void }) {
  return <div className="guide-reference">
    <div className="guide-reference-intro"><h2>A little less clicking.</h2><p>Click the model before using movement keys. Text fields keep their normal editing shortcuts. Resize handles use a plain drag on an orange arrow. On a Mac, move &amp; snap uses the Control key.</p></div>
    <div className="guide-shortcut-grid">{SHORTCUT_GROUPS.map(group => <section key={group.title}><h3>{group.title}</h3><dl>{group.rows.map(([label, key]) => <div key={label}><dt>{label}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl></section>)}</div>
    <div className="guide-system-note"><h3>Understand the connection.</h3><p>Angled joints turn one panel away from another. T and cross joints add continuation panels too. Start with the same 18 mm panel thickness throughout a practice build, and inspect each preview before committing.</p><button onClick={() => onChooseGuide('angles')}>Learn the connector types<ArrowRight size={15}/></button><p>The previews explain the editor’s geometry. Material strength, loading, manufacturing tolerances, and screw tightening are not simulated.</p>
      <a href="https://www.playwood.it/site/assets/files/18237/technical_information_playwood_connectors.pdf" target="_blank" rel="noreferrer">Official technical drawings<ArrowRight size={14}/></a>
    </div>
  </div>
}
