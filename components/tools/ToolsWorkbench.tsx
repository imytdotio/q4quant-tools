'use client'

import ToolSourceLink from './ToolSourceLink'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import BayesTrainer from './BayesTrainer'
import MarketMakingGame from './MarketMakingGame'
import OrderBookSimulator from './OrderBookSimulator'
import PokerTrainer from './PokerTrainer'
import { TOOLS, type ToolId, type ToolLock } from './catalog'
import { surfaceVolatility, projectSurface, type SurfaceShape } from '@/lib/volatility-surface'
import { DEFAULT_OPTION, optionPrice, type OptionInputs, type OptionKind } from '@/lib/options-pricing'

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const apps = TOOLS
type AppId = ToolId

// Interpolate from the current frame so repeated slider updates never snap back.
function useAnimatedValues(target: number[]) {
  const [values, setValues] = useState(target)
  const current = useRef(target)
  const key = JSON.stringify(target)
  useEffect(() => {
    const next = JSON.parse(key) as number[]
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const finish = () => { cancelAnimationFrame(frame); current.current = next; setValues(next) }
    if (media.matches) { finish(); return }
    const from = current.current, start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / 480, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      current.current = next.map((v, i) => (from[i] ?? v) + (v - (from[i] ?? v)) * ease)
      setValues(current.current)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    media.addEventListener('change', finish)
    return () => { cancelAnimationFrame(frame); media.removeEventListener('change', finish) }
  }, [key])
  return values
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return <label className="tool-control"><span>{label}<output>{unit === '$' ? money(value) : `${value}${unit}`}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /><small><span>{min}{unit === '$' ? ' USD' : unit}</span><span>{max}{unit === '$' ? ' USD' : unit}</span></small></label>
}

export default function ToolsWorkbench({ locks = {} }: { locks?: Partial<Record<ToolId, ToolLock>> } = {}) {
  const [app, setApp] = useState<AppId>('options')
  const [history, setHistory] = useState<{ stack: AppId[]; index: number }>({ stack: ['options'], index: 0 })
  const [pinned, setPinned] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const chromeRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const current = apps.find(item => item.id === app)!

  // Deep link: /tools#order-book opens that tab.
  useEffect(() => {
    const sync = () => {
      const fromHash = apps.find(item => item.slug === window.location.hash.slice(1))
      if (fromHash) { setApp(fromHash.id); setHistory({ stack: [fromHash.id], index: 0 }) }
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  // As the browser chrome reaches the site header it pushes the header up and out of view,
  // then pins at the very top. At the end of the tools the header slides back as the chrome leaves.
  // Where supported this is a scroll-driven CSS animation (runs on the compositor, so the header and
  // the sticky chrome move in the same frame); JS only measures the scroll offsets on layout changes.
  useEffect(() => {
    const root = rootRef.current, header = document.querySelector<HTMLElement>('.momentum-header')
    if (!root) return
    const browser = root.querySelector<HTMLElement>('.tools-browser')
    const cssDriven = typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()') && CSS.supports('animation-range: 0px 1px')
    const SHADOW = 32 // extra travel so the header's drop shadow clears the top edge too
    let frame = 0

    const measure = () => {
      if (!header || !browser) return
      const height = header.offsetHeight
      const top = root.getBoundingClientRect().top + window.scrollY
      const bottom = browser.getBoundingClientRect().bottom + window.scrollY
      const vars: Record<string, string> = {
        '--push-start': `${Math.max(top - height, 0)}px`,
        '--push-end': `${Math.max(top + SHADOW, 1)}px`,
        '--release-start': `${bottom - height - SHADOW}px`,
        '--release-end': `${bottom}px`,
        '--push-distance': `${height + SHADOW}px`,
      }
      for (const [key, value] of Object.entries(vars)) header.style.setProperty(key, value)
    }

    const update = () => {
      frame = 0
      const chrome = chromeRef.current
      const top = root.getBoundingClientRect().top
      if (chrome) setPinned(chrome.getBoundingClientRect().top <= .5 && top < 0)
      if (!header || cssDriven) return
      const height = header.offsetHeight
      const pushed = Math.min(Math.max(height - top, 0), height)
      const release = chrome ? Math.min(Math.max(chrome.getBoundingClientRect().bottom, 0), height) : height
      const hidden = header.contains(document.activeElement) ? 0 : Math.min(pushed, release)
      header.style.transform = hidden ? `translate3d(0, ${-hidden}px, 0)` : ''
      header.style.visibility = hidden >= height ? 'hidden' : ''
    }
    // Fallback path: read and write in the scroll event itself rather than a frame later.
    const onScroll = () => { if (cssDriven) { if (!frame) frame = requestAnimationFrame(update) } else update() }

    if (header && cssDriven) { measure(); header.dataset.toolsPush = '' }
    update()
    const observer = new ResizeObserver(() => { measure(); update() })
    observer.observe(root)
    if (header) observer.observe(header)
    observer.observe(document.body)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    header?.addEventListener('focusin', onScroll)
    header?.addEventListener('focusout', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      header?.removeEventListener('focusin', onScroll)
      header?.removeEventListener('focusout', onScroll)
      if (header) {
        delete header.dataset.toolsPush
        header.style.transform = ''; header.style.visibility = ''
        for (const key of ['--push-start', '--push-end', '--release-start', '--release-end', '--push-distance']) header.style.removeProperty(key)
      }
    }
  }, [])

  const show = (id: AppId, record = true) => {
    if (id === app) return
    setApp(id)
    if (record) setHistory(h => ({ stack: [...h.stack.slice(0, h.index + 1), id], index: h.index + 1 }))
    const slug = apps.find(item => item.id === id)!.slug
    tabRefs.current[id]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    window.history.replaceState(null, '', `#${slug}`)
    // If the reader has scrolled into a tool, bring the new one's top into view under the bar pinned at the top.
    const root = rootRef.current, chrome = chromeRef.current
    if (root && chrome && root.getBoundingClientRect().top < 0) {
      const top = window.scrollY + root.getBoundingClientRect().top
      window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }
  const go = (step: -1 | 1) => {
    const index = history.index + step
    if (index < 0 || index >= history.stack.length) return
    setHistory(h => ({ ...h, index }))
    show(history.stack[index], false)
  }
  const onTabKey = (e: ReactKeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? (i + 1) % apps.length : e.key === 'ArrowLeft' ? (i - 1 + apps.length) % apps.length : e.key === 'Home' ? 0 : e.key === 'End' ? apps.length - 1 : null
    if (next === null) return
    e.preventDefault()
    show(apps[next].id)
    tabRefs.current[apps[next].id]?.focus()
  }

  return <section className="tools-workbench" id="workbench" aria-label="Interactive tools" ref={rootRef}>
    <div className="tools-browser">
      <div className={`tools-browser-chrome ${pinned ? 'is-pinned' : ''}`} ref={chromeRef}>
        <div className="tools-tabstrip" role="tablist" aria-label="Tools">
          {apps.map((item, i) => <button key={item.id} ref={el => { tabRefs.current[item.id] = el }} role="tab" id={`tool-tab-${item.id}`} aria-selected={app === item.id} aria-controls="tool-panel" tabIndex={app === item.id ? 0 : -1} onClick={() => show(item.id)} onKeyDown={e => onTabKey(e, i)} className={`tools-tab ${app === item.id ? 'is-active' : ''}`}>
            <span className="tools-tab-glyph" aria-hidden="true">{item.glyph}</span>
            <span className="tools-tab-title">{item.title}</span>
            <span className="tools-tab-number" aria-hidden="true">{item.number}</span>
          </button>)}
        </div>
        <div className="tools-browser-toolbar">
          <div className="tools-browser-nav">
            <button onClick={() => go(-1)} disabled={history.index === 0} aria-label="Previous tool">←</button>
            <button onClick={() => go(1)} disabled={history.index >= history.stack.length - 1} aria-label="Next tool">→</button>
          </div>
          <div className="tools-browser-address" aria-label="Current tool address"><span aria-hidden="true">⌂</span>q4quant.studio<b>/tools/{current.slug}</b></div>
          <span className="tools-browser-count" aria-hidden="true">{current.number} / {String(apps.length).padStart(2, '0')}</span>
        </div>
      </div>
      <div className="tool-app" id="tool-panel" role="tabpanel" aria-labelledby={`tool-tab-${app}`} key={app}>{app === 'options' ? <OptionsApp /> : app === 'surface' ? <VolatilitySurface /> : app === 'poker' ? <PokerTrainer lock={locks.poker} /> : app === 'bayes' ? <BayesTrainer lock={locks.bayes} /> : app === 'book' ? <OrderBookSimulator /> : <MarketMakingGame lock={locks.market} />}</div>
    </div>
  </section>
}

export function OptionsApp() {
  const [inputs, setInputs] = useState<OptionInputs>(DEFAULT_OPTION)
  const [kind, setKind] = useState<OptionKind>('call')
  const [view, setView] = useState<'heatmap' | 'curves'>('heatmap')
  const [activeCell, setActiveCell] = useState<number | null>(null)
  const [crosshair, setCrosshair] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [curveIndex, setCurveIndex] = useState<number | null>(null)
  const heatmapRef = useRef<HTMLDivElement>(null)
  const spots = useMemo(() => Array.from({ length: 9 }, (_, i) => inputs.spot * (.6 + i * .1)), [inputs.spot])
  const vols = [60, 50, 40, 30, 20, 10, 0]
  const curveSpots = useMemo(() => Array.from({ length: 81 }, (_, i) => inputs.spot * (.5 + i / 80)), [inputs.spot])
  const prices = vols.flatMap(volatility => spots.map(spot => optionPrice({ ...inputs, volatility, spot }, kind)))
  const curve = curveSpots.map(spot => optionPrice({ ...inputs, spot }, kind))
  const payoff = curveSpots.map(spot => Math.max(kind === 'call' ? spot - inputs.strike : inputs.strike - spot, 0))
  const value = optionPrice(inputs, kind)
  const intrinsic = Math.max(kind === 'call' ? inputs.spot - inputs.strike : inputs.strike - inputs.spot, 0)
  const animated = useAnimatedValues([value, intrinsic, value - intrinsic, ...prices, ...curve, ...payoff])
  const heat = animated.slice(3, 66), line = animated.slice(66, 147), expiry = animated.slice(147)
  const maxHeat = Math.max(...heat, .01), maxY = Math.max(...line, ...expiry, 1) * 1.12
  const x = (i: number) => 58 + i / 80 * 642
  const y = (v: number) => 290 - v / maxY * 246
  const path = (data: number[]) => data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const update = (key: keyof OptionInputs, value: number) => setInputs(old => ({ ...old, [key]: value }))
  const selection = activeCell === null ? null : { spot: spots[activeCell % 9], vol: vols[Math.floor(activeCell / 9)], price: heat[activeCell] }
  const activeCol = activeCell === null ? null : activeCell % 9
  const activeRow = activeCell === null ? null : Math.floor(activeCell / 9)
  const placeCrosshair = (cell: HTMLElement, index: number) => {
    const grid = heatmapRef.current
    if (!grid) return
    const gridRect = grid.getBoundingClientRect()
    const cellRect = cell.getBoundingClientRect()
    setActiveCell(index)
    setCrosshair({ x: cellRect.left - gridRect.left, y: cellRect.top - gridRect.top, w: cellRect.width, h: cellRect.height })
  }
  const clearCrosshair = () => { setActiveCell(null); setCrosshair(null) }

  return <>
    <div className="tool-app-heading"><div><p className="tools-eyebrow">01 / DERIVATIVES</p><h2>Options pricing</h2><p>One model. A whole landscape of possibilities.</p></div><ToolSourceLink /></div>
    <div className="pricing-workspace">
      <aside className="pricing-inputs"><div className="input-heading"><h3>Your assumptions</h3><button onClick={() => { setInputs(DEFAULT_OPTION); setKind('call'); clearCrosshair(); setCurveIndex(null) }}>Reset ↺</button></div>
        <div className="tool-segment" aria-label="Option type">{(['call', 'put'] as const).map(v => <button key={v} aria-pressed={kind === v} onClick={() => setKind(v)}>{v === 'call' ? 'Call option' : 'Put option'}</button>)}</div>
        <Slider label="Spot price" value={inputs.spot} min={10} max={300} unit="$" onChange={v => update('spot', v)} />
        <Slider label="Strike price" value={inputs.strike} min={10} max={300} unit="$" onChange={v => update('strike', v)} />
        <Slider label="Time to expiry" value={inputs.days} min={0} max={730} unit=" days" onChange={v => update('days', v)} />
        <Slider label="Volatility" value={inputs.volatility} min={0} max={100} unit="%" onChange={v => update('volatility', v)} />
        <Slider label="Risk-free rate" value={inputs.rate} min={-5} max={15} step={.25} unit="%" onChange={v => update('rate', v)} />
        <Slider label="Dividend yield" value={inputs.yield} min={0} max={15} step={.25} unit="%" onChange={v => update('yield', v)} />
        <p className="input-note">European exercise · annualised inputs<br />USD per underlying unit · 365-day year</p>
      </aside>
      <div className="pricing-results">
        <div className="pricing-metrics">{['Theoretical price', 'Intrinsic value', 'Price less intrinsic'].map((label, i) => <div key={label}><span>{label}</span><strong>{money(animated[i])}</strong><small>{i === 0 ? `European ${kind}` : i === 1 ? 'Exercise value today' : 'Includes carry and optionality'}</small></div>)}</div>
        <div className="chart-toolbar"><div><h3>{view === 'heatmap' ? 'The price landscape' : 'Price meets payoff'}</h3><p>{view === 'heatmap' ? 'Spot × volatility · hover or focus a cell' : 'Underlying price → option value'}</p></div><div className="tool-segment" aria-label="Chart view">{(['heatmap', 'curves'] as const).map(v => <button key={v} aria-pressed={view === v} onClick={() => { setView(v); clearCrosshair(); setCurveIndex(null) }}>{v === 'heatmap' ? 'Heatmap' : 'Curves'}</button>)}</div></div>
        <div className="chart-stage" key={view}>
          {view === 'heatmap' ? <>
            <div className="heatmap-scroll"><div className="heatmap-axis-title">VOLATILITY (%)</div><div className="heatmap-grid" ref={heatmapRef} onPointerLeave={clearCrosshair}><span />{spots.map((s, i) => <span className={`heatmap-tick ${activeCol === i ? 'is-cross' : ''}`} key={i}>{s.toFixed(0)}</span>)}{vols.map((vol, row) => <div className="heatmap-row" key={vol}><span className={`heatmap-tick ${activeRow === row ? 'is-cross' : ''}`}>{vol}%</span>{spots.map((spot, col) => { const index = row * 9 + col; const t = heat[index] / maxHeat; return <button key={col} className={`heatmap-cell ${activeCell === index ? 'is-active' : ''}`} style={{ backgroundColor: `rgb(${Math.round(239 - t * 202)}, ${Math.round(245 - t * 146)}, ${Math.round(255 - t * 38)})`, color: t > .55 ? '#fff' : '#284669', '--cell-delay': `${(row + col) * 15}ms` } as CSSProperties} onPointerEnter={e => placeCrosshair(e.currentTarget, index)} onFocus={e => placeCrosshair(e.currentTarget, index)} onBlur={e => { if (!heatmapRef.current?.contains(e.relatedTarget as Node | null)) clearCrosshair() }} onClick={e => placeCrosshair(e.currentTarget, index)} aria-label={`Spot ${money(spot)}, volatility ${vol} percent, ${kind} price ${money(prices[index])}`}>{heat[index].toFixed(2)}</button> })}</div>)}{crosshair && <div className="heatmap-crosshair" style={{ '--cx': `${crosshair.x}px`, '--cy': `${crosshair.y}px`, '--cw': `${crosshair.w}px`, '--ch': `${crosshair.h}px` } as CSSProperties} aria-hidden="true"><span className="heatmap-crosshair-col" /><span className="heatmap-crosshair-row" /></div>}</div><div className="heatmap-axis-bottom">UNDERLYING PRICE (USD)</div></div>
            <div className="heatmap-legend"><span>{money(0)}</span><i /><span>{money(maxHeat)}</span><span>Option value</span></div>
            <div className="chart-readout" aria-live="polite">{selection ? <><span>Spot <b>{money(selection.spot)}</b></span><span>Volatility <b>{selection.vol}%</b></span><span>{kind} value <b>{money(selection.price)}</b></span></> : <span>Explore any cell to inspect a scenario.</span>}</div>
          </> : <>
            <div className="curve-legend"><span><i /> Theoretical value</span><span><i /> Payoff at expiry</span></div>
            <svg className="option-curve" viewBox="0 0 740 335" role="img" aria-label={`${kind} option value and expiry payoff versus underlying price`} onPointerMove={e => { const bounds = e.currentTarget.getBoundingClientRect(); setCurveIndex(Math.max(0, Math.min(80, Math.round(((e.clientX - bounds.left) / bounds.width * 740 - 58) / 642 * 80)))) }} onPointerLeave={() => setCurveIndex(null)}>
              <defs><linearGradient id="option-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#2563d9" stopOpacity=".16" /><stop offset="100%" stopColor="#2563d9" stopOpacity="0" /></linearGradient></defs>
              {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="58" x2="700" y1={y(maxY * i / 4)} y2={y(maxY * i / 4)} stroke="#e5ebf3" /><text x="46" y={y(maxY * i / 4) + 4} textAnchor="end">{(maxY * i / 4).toFixed(0)}</text><text x={58 + i * 160.5} y="313" textAnchor="middle">{(inputs.spot * (.5 + i / 4)).toFixed(0)}</text></g>)}
              <text x="58" y="20">OPTION VALUE (USD)</text>
              <path d={`${path(line)} L700,290 L58,290 Z`} fill="url(#option-fill)" />
              <path d={path(expiry)} fill="none" stroke="#97a6bd" strokeWidth="2" strokeDasharray="5 5" />
              <path className="option-line" d={path(line)} fill="none" stroke="#2563d9" strokeWidth="3" pathLength="1" />
              {curveIndex !== null && <g className="curve-crosshair"><line x1={x(curveIndex)} x2={x(curveIndex)} y1="34" y2="290" stroke="#9db8e3" strokeDasharray="3 4" /><circle cx={x(curveIndex)} cy={y(line[curveIndex])} r="5" fill="#2563d9" stroke="white" strokeWidth="2" /></g>}
            </svg>
            <label className="curve-scrub">Inspect underlying price<input aria-label="Inspect curve price" type="range" min={0} max={80} value={curveIndex ?? 40} onChange={e => setCurveIndex(Number(e.target.value))} /></label>
            <div className="chart-readout"><span>Spot <b>{money(curveSpots[curveIndex ?? 40])}</b></span><span>Option <b>{money(line[curveIndex ?? 40])}</b></span><span>At expiry <b>{money(expiry[curveIndex ?? 40])}</b></span></div>
          </>}
        </div>
        <div className="chart-footnote"><span>↗</span><p>{view === 'heatmap' ? 'Read across for a change in spot. Read down for a change in volatility. Strike, time, rate and yield stay at your assumptions.' : 'The solid curve is the model value today. The dashed line is the exercise payoff at expiry; it excludes the premium paid.'}</p></div>
      </div>
    </div>
    <details className="tool-model-notes"><summary>About this model <span>+</span></summary><p>Black–Scholes–Merton values European calls and puts with constant volatility, continuously compounded interest and a continuous dividend yield. It excludes fees, discrete dividends and early exercise. These are theoretical scenarios, not market quotes. At zero time the price equals payoff; at zero volatility it equals discounted deterministic payoff. <a href="https://la.mathworks.com/help/finance/blsprice.html" target="_blank" rel="noreferrer">Model reference ↗</a></p></details>
  </>
}

const SURFACE_PRESETS = {
  smile: { label: 'Smile', atm: 20, skew: -.25, curvature: 3, term: .08 },
  skew: { label: 'Downside skew', atm: 25, skew: -1, curvature: 1.5, term: -.08 },
  flat: { label: 'Flat', atm: 20, skew: 0, curvature: 0, term: 0 },
} as const
const STRIKES = Array.from({ length: 25 }, (_, i) => .6 + i / 30)
const EXPIRIES = Array.from({ length: 19 }, (_, i) => 1 / 12 + i / 18 * (2 - 1 / 12))
const DEFAULT_CAMERA = { yaw: .65, tilt: .55 }
const SURFACE_THEMES = {
  blue: { label: 'Blue', stops: [[184, 214, 251], [37, 99, 217]] },
  'blue-red': { label: 'Blue / red', stops: [[37, 99, 217], [236, 238, 244], [205, 45, 55]] },
  'red-green': { label: 'Red / green', stops: [[26, 150, 75], [246, 226, 140], [205, 45, 55]] },
} as const
type SurfaceTheme = keyof typeof SURFACE_THEMES
const surfaceColor = (theme: SurfaceTheme, t: number) => {
  const stops = SURFACE_THEMES[theme].stops
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(Math.floor(x), stops.length - 2), f = x - i
  return `rgb(${stops[i].map((c, j) => Math.round(c + (stops[i + 1][j] - c) * f)).join(',')})`
}
const surfaceGradient = (theme: SurfaceTheme) => `linear-gradient(90deg,${SURFACE_THEMES[theme].stops.map(c => `rgb(${c.join(',')})`).join(',')})`

export function VolatilitySurface() {
  const [shape, setShape] = useState<SurfaceShape>(SURFACE_PRESETS.smile)
  const [forward, setForward] = useState(100)
  const [selected, setSelected] = useState({ strike: 12, expiry: 9 })
  const [preset, setPreset] = useState('smile')
  const [camera, setCamera] = useState(DEFAULT_CAMERA)
  const [theme, setTheme] = useState<SurfaceTheme>('blue')
  const drag = useRef<{ x: number; y: number; yaw: number; tilt: number } | null>(null)
  const target = EXPIRIES.flatMap(t => STRIKES.map(k => surfaceVolatility(k, t, shape)))
  const values = useAnimatedValues(target)
  const min = Math.min(...values), max = Math.max(...values)
  const ceiling = Math.max(30, max * 1.12)
  const project = (x: number, t: number, z: number) => projectSurface(x, t, z, camera.yaw, camera.tilt)
  const points = values.map((v, i) => project((i % 25) / 12 - 1, Math.floor(i / 25) / 9 - 1, v / ceiling))
  const coords = (p: { x: number; y: number }) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`
  const faces = EXPIRIES.slice(0, -1).flatMap((_, row) => STRIKES.slice(0, -1).map((_, col) => {
    const indices = [row * 25 + col, row * 25 + col + 1, (row + 1) * 25 + col + 1, (row + 1) * 25 + col]
    const average = indices.reduce((sum, i) => sum + values[i], 0) / 4
    const intensity = (average - min) / Math.max(max - min, 1)
    return { key: row * 25 + col, row, col, points: indices.map(i => coords(points[i])).join(' '), depth: indices.reduce((sum, i) => sum + points[i].depth, 0) / 4,
      fill: surfaceColor(theme, intensity) }
  })).sort((a, b) => a.depth - b.depth)
  const index = selected.expiry * 25 + selected.strike
  const point = points[index]
  const basePoint = project(selected.strike / 12 - 1, selected.expiry / 9 - 1, 0)
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${coords(a)} L${coords(b)}`
  const choosePreset = (key: keyof typeof SURFACE_PRESETS) => { setShape(SURFACE_PRESETS[key]); setPreset(key) }
  const update = (key: keyof SurfaceShape, v: number) => { setShape(old => ({ ...old, [key]: v })); setPreset('custom') }
  return <>
    <div className="tool-app-heading"><div><p className="tools-eyebrow">02 / IMPLIED VOLATILITY</p><h2>Volatility surface</h2><p>A new dimension to the shape of uncertainty.</p></div><ToolSourceLink /></div>
    <div className="pricing-workspace">
      <aside className="pricing-inputs"><div className="input-heading"><h3>Shape your surface</h3><button onClick={() => { choosePreset('smile'); setForward(100); setCamera(DEFAULT_CAMERA); setSelected({ strike: 12, expiry: 9 }) }}>Reset ↺</button></div>
        <div className="smile-presets" aria-label="Surface presets">{Object.entries(SURFACE_PRESETS).map(([key, item]) => <button key={key} aria-pressed={preset === key} onClick={() => choosePreset(key as keyof typeof SURFACE_PRESETS)}>{item.label}</button>)}</div>
        <Slider label="Forward price" value={forward} min={10} max={300} unit="$" onChange={setForward} />
        <Slider label="1-year ATM volatility" value={shape.atm} min={5} max={60} unit="%" onChange={v => update('atm', v)} />
        <Slider label="Skew" value={shape.skew} min={-1.5} max={1.5} step={.05} onChange={v => update('skew', v)} />
        <Slider label="Curvature" value={shape.curvature} min={0} max={5} step={.1} onChange={v => update('curvature', v)} />
        <Slider label="Term slope" value={shape.term} min={-.3} max={.3} step={.02} onChange={v => update('term', v)} />
        <p className="input-note">1–24 months · annualised volatility<br />Constant forward across expiries.</p>
      </aside>
      <div className="pricing-results">
        <div className="pricing-metrics">{[{ label: 'Selected volatility', value: values[index], note: `${(EXPIRIES[selected.expiry] * 12).toFixed(1)} months · ${money(STRIKES[selected.strike] * forward)} strike` }, { label: 'Surface low', value: min, note: 'Across displayed grid' }, { label: 'Surface high', value: max, note: 'Across displayed grid' }].map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value.toFixed(2)}%</strong><small>{item.note}</small></div>)}</div>
        <div className="chart-toolbar"><div><h3>Implied volatility surface</h3><p>Drag to rotate · hover to inspect · arrow keys to orbit</p></div><div className="surface-controls"><div className="tool-segment" aria-label="Surface colour theme">{(Object.keys(SURFACE_THEMES) as SurfaceTheme[]).map(key => <button key={key} aria-pressed={theme === key} onClick={() => setTheme(key)}>{SURFACE_THEMES[key].label}</button>)}</div><button className="surface-reset" onClick={() => setCamera(DEFAULT_CAMERA)}>Reset view ↺</button></div></div>
        <div className="surface-frame">
          <svg className="volatility-surface" viewBox="0 0 760 520" role="img" tabIndex={0} aria-label="Interactive 3D volatility surface. Strike price, time to maturity, and implied volatility. Drag or use arrow keys to rotate; use the sliders below to inspect points."
            onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setCamera(c => ({ yaw: Math.max(.15, Math.min(1.35, c.yaw + (e.key === 'ArrowLeft' ? -.06 : e.key === 'ArrowRight' ? .06 : 0))), tilt: Math.max(.25, Math.min(.85, c.tilt + (e.key === 'ArrowUp' ? .04 : e.key === 'ArrowDown' ? -.04 : 0))) })) } }}
            onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, ...camera }; e.currentTarget.setPointerCapture(e.pointerId) }}
            onPointerMove={e => { const start = drag.current; if (start) setCamera({ yaw: Math.max(.15, Math.min(1.35, start.yaw + (e.clientX - start.x) * .006)), tilt: Math.max(.25, Math.min(.85, start.tilt + (e.clientY - start.y) * .004)) }) }}
            onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
            <defs><radialGradient id="surface-ground"><stop stopColor="#dce9fc" stopOpacity=".7" /><stop offset="1" stopColor="#f8fbff" stopOpacity="0" /></radialGradient></defs>
            <ellipse cx="380" cy="310" rx="300" ry="135" fill="url(#surface-ground)" />
            <polygon points={[project(-1,-1,0),project(1,-1,0),project(1,1,0),project(-1,1,0)].map(coords).join(' ')} fill="#f5f8fd" stroke="#d3deed" />
            {[0,1,2,3,4].map(i => { const n = i / 2 - 1; const z = i / 4; const tick = project(-1,1,z); const strike = project(n,1,0); const time = project(1,n,0); return <g key={i} className="surface-grid">
              <path d={line(project(n,-1,0),project(n,1,0))} /><path d={line(project(-1,n,0),project(1,n,0))} />
              <path d={line(project(-1,-1,z),project(-1,1,z))} strokeDasharray="3 5" />
              <text x={tick.x-12} y={tick.y+4} textAnchor="end">{(ceiling*z).toFixed(0)}%</text>
              <text x={strike.x} y={strike.y+20} textAnchor="middle">{(forward*(.6+i*.2)).toFixed(0)}</text>
              <text x={time.x+15} y={time.y+10}>{(1+i*23/4).toFixed(i===0||i===4?0:1)}m</text>
            </g> })}
            <path className="surface-axis" d={line(project(-1,1,0),project(-1,1,1))} />
            {faces.map(face => <polygon key={face.key} points={face.points} fill={face.fill} stroke="#ffffff" strokeOpacity=".22" strokeWidth=".55" strokeLinejoin="round" onPointerEnter={() => { if (!drag.current) setSelected({strike:face.col,expiry:face.row}) }} />)}
            <path d={line(basePoint,point)} stroke="#1f4e9b" strokeDasharray="3 4" strokeWidth="1" pointerEvents="none" />
            <circle cx={point.x} cy={point.y} r="5" fill="#fff" stroke="#174fbd" strokeWidth="2" pointerEvents="none" />
            <text className="surface-axis-title" x="28" y="45">IMPLIED VOLATILITY (%)</text>
            <text className="surface-axis-title" x={project(0,1,0).x} y={project(0,1,0).y+47} textAnchor="middle">STRIKE PRICE (USD)</text>
            <text className="surface-axis-title" x={project(1,0,0).x+22} y={project(1,0,0).y+48} textAnchor="middle">TIME TO MATURITY</text>
          </svg>
          <div className="surface-scale"><span>{min.toFixed(1)}%</span><i style={{ background: surfaceGradient(theme) }} /><span>{max.toFixed(1)}%</span><span>Implied volatility</span></div>
        </div>
        <div className="surface-inspect"><label className="curve-scrub">Inspect strike<input aria-label="Inspect surface strike" type="range" min={0} max={24} value={selected.strike} onChange={e => setSelected(s => ({...s,strike:Number(e.target.value)}))} /></label><label className="curve-scrub">Inspect expiry<input aria-label="Inspect surface expiry" type="range" min={0} max={18} value={selected.expiry} onChange={e => setSelected(s => ({...s,expiry:Number(e.target.value)}))} /></label></div>
        <div className="chart-readout"><span>Strike <b>{money(forward*STRIKES[selected.strike])}</b></span><span>Expiry <b>{(EXPIRIES[selected.expiry]*12).toFixed(1)} months</b></span><span>Implied vol <b>{values[index].toFixed(2)}%</b></span></div>
        <div className="chart-footnote"><span>↗</span><p>Short-dated wings are more pronounced. Term slope changes how ATM volatility evolves with maturity; skew and curvature shape the smile across strikes.</p></div>
      </div>
    </div>
    <details className="tool-model-notes"><summary>About this surface <span>+</span></summary><p>An illustrative surface, not market data or an arbitrage-free calibration. σ(K,T) = σ₁Y × exp[term × (T − 1) + (skew × m + curvature × m²) / √(T + 0.25)], where m = K/F − 1 and T is in years. The forward F is held constant across expiries. Height and colour both encode annualised volatility; the vertical scale adjusts to the displayed range.</p></details>
  </>
}
