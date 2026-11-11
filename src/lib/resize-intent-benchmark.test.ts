import { writeFileSync } from 'node:fs'
import { cpus, platform, arch } from 'node:os'
import { performance } from 'node:perf_hooks'
import { afterAll, describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { evaluateDesignConstraints } from './design-constraints'
import { roundTripProject } from '../test/project-round-trip'
import { getPhysicalConnectors } from './connector-selection'
import { resolvePanels, validateProject } from './model'
import { getResizeAlternatives, resizePanelEdge, resizePanels } from './structure-edit'
import { resizeIntentCorpus, targetPanel } from '../test/resize-intent-corpus'
import type { Project } from './types'

const tolerance = 0.001 // mm; reported geometry is rounded, assertions use full precision.
const rounded = (value: number) => Math.round(value * 1e6) / 1e6
const reports: unknown[] = []
const reportPath = process.env.RESIZE_BENCHMARK_REPORT

function hardware(project: Project) {
  const panels = resolvePanels(project)
  return getPhysicalConnectors(project).map(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    const slide = connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    return { id: piece.id, position: new Vector3(...rail.placements[piece.index].position)
      .addScaledVector(new Vector3(...rail.tangent), slide),
    fraction: (rail.along[piece.index] + slide - rail.lower) / (rail.upper - rail.lower) }
  })
}

function hardwareChange(source: Project, candidate: Project) {
  const before = hardware(source), after = hardware(candidate)
  return { installed: after.length,
    maxWorldMovementMm: rounded(Math.max(0, ...after.map((piece, index) => piece.position.distanceTo(before[index].position)))),
    maxRailFractionChange: rounded(Math.max(0, ...after.map((piece, index) => Math.abs(piece.fraction - before[index].fraction)))) }
}

function changes(source: Project, candidate: Project) {
  const original = new Map(resolvePanels(source).map(panel => [panel.id, panel]))
  return resolvePanels(candidate).flatMap(panel => {
    const before = original.get(panel.id)!
    const cuts = (['width', 'height', 'thickness'] as const).flatMap(dimension =>
      Math.abs(panel[dimension] - before[dimension]) > tolerance ? [{ dimension, before: rounded(before[dimension]), after: rounded(panel[dimension]) }] : [])
    const translation = panel.position.map((value, axis) => rounded(value - before.position[axis]))
    return cuts.length || translation.some(value => Math.abs(value) > tolerance) ? [{ panel: panel.name, cuts, translation }] : []
  })
}

// Policy characterization and physical compatibility deliberately remain separate.
// Future planner tests should consume the labels, not promote current cuts to intent.
describe('stage 0 resize intent benchmark', () => {
  for (const scenario of resizeIntentCorpus) it(scenario.id, () => {
    const source = scenario.source(), snapshot = structuredClone(source)
    const panel = targetPanel(source, scenario)
    const run = () => scenario.operation === 'numeric'
      ? resizePanels(source, [panel.id], { [scenario.target.dimension]: scenario.target.value })
      : resizePanelEdge(source, panel.id, scenario.target.dimension, 1,
        scenario.target.value - panel[scenario.target.dimension], scenario.operation === 'local-edge')
    const attempt = () => {
      try { return { project: run(), error: null } }
      catch (error) {
        if (!(error instanceof Error)) throw error
        return { project: null, error: error.message }
      }
    }
    const start = performance.now(), result = attempt(), firstMs = performance.now() - start
    const reviewStart = performance.now()
    const review = scenario.operation === 'numeric'
      ? getResizeAlternatives(source, [panel.id], { [scenario.target.dimension]: scenario.target.value }) : null
    const reviewMs = performance.now() - reviewStart
    expect(result.project === null).toBe(scenario.current.rejected ?? false)
    if (scenario.current.rejected) expect(result.error).toMatch(scenario.id === 'stock-limit' ? /panel size limits/ : /design rules/)
    expect(review?.alternatives.length ?? 0).toBe(scenario.current.reviewCount)
    const candidates = [result.project, ...review?.alternatives.map(alternative => alternative.project) ?? []]
      .filter((candidate): candidate is Project => candidate !== null)
    const baselineIssues = validateProject(source)
    for (const candidate of candidates) {
      const before = resolvePanels(source), after = resolvePanels(candidate)
      expect(candidate.panels.map(item => item.id)).toEqual(source.panels.map(item => item.id))
      expect(candidate.connections.map(item => item.id)).toEqual(source.connections.map(item => item.id))
      expect(getPhysicalConnectors(candidate).map(piece => piece.id)).toEqual(getPhysicalConnectors(source).map(piece => piece.id))
      expect(candidate.constraints).toEqual(source.constraints)
      expect(roundTripProject(candidate)).toEqual(candidate)
      const priorRules = evaluateDesignConstraints(source.constraints, before)
      for (const rule of evaluateDesignConstraints(candidate.constraints, after)) {
        expect(rule.violation).toBeLessThanOrEqual(priorRules.find(old => old.constraint.id === rule.constraint.id)!.violation + tolerance)
      }
      if (scenario.operation === 'local-edge') {
        expect(hardwareChange(source, candidate).maxWorldMovementMm).toBeLessThan(tolerance)
        for (const other of before.filter(item => item.id !== panel.id)) {
          expect(after.find(item => item.id === other.id)).toEqual(other)
        }
      }
      if (scenario.id === 'unrelated-equal-cut') expect(after.find(item => item.id === 'peer')).toEqual(before.find(item => item.id === 'peer'))
      expect(validateProject(candidate).filter(issue => !baselineIssues.some(old => old.id === issue.id))).toEqual([])
      for (const item of after) {
        const old = before.find(previous => previous.id === item.id)!
        expect(item.rotation).toEqual(old.rotation)
        for (const dimension of ['width', 'height', 'thickness'] as const) {
          if (!scenario.allowedAdaptingCuts.includes(`${item.name}.${dimension}`)) {
            expect(Math.abs(item[dimension] - old[dimension]), `${item.name}.${dimension}`).toBeLessThan(tolerance)
          }
        }
      }
      for (const [cut, value] of Object.entries(scenario.current.cuts)) {
        // Fixture names may contain periods (Upright 1.1).
        const separator = cut.lastIndexOf('.')
        const actual = after.find(item => item.name === cut.slice(0, separator))!
        expect(actual[cut.slice(separator + 1) as 'width' | 'height'], cut).toBeCloseTo(value, 3)
      }
      const resized = after.find(item => item.id === panel.id)!
      const expectedCenter = new Vector3(...panel.position)
      if (scenario.operation !== 'numeric') {
        const axis = new Vector3(scenario.target.dimension === 'width' ? 1 : 0, scenario.target.dimension === 'height' ? 1 : 0, 0)
          .applyEuler(new Euler(...panel.rotation))
        expectedCenter.addScaledVector(axis, (scenario.target.value - panel[scenario.target.dimension]) / 2)
      }
      expect(new Vector3(...resized.position).distanceTo(expectedCenter)).toBeLessThan(tolerance)
    }
    expect(source).toEqual(snapshot)
    // Repeat from the same source; sample solve time only, excluding validation/reporting.
    const samples: number[] = []
    for (let index = 0; index < (reportPath ? 20 : 1); index++) {
      const started = performance.now(), repeated = attempt()
      samples.push(performance.now() - started)
      expect(repeated).toEqual(result)
    }
    expect(source).toEqual(snapshot)
    samples.sort((a, b) => a - b)
    reports.push({ id: scenario.id, family: scenario.family, target: scenario.target, operation: scenario.operation,
      anchor: scenario.anchor, allowedAdaptingCuts: scenario.allowedAdaptingCuts, invariants: scenario.invariants,
      acceptableAlternatives: scenario.acceptableAlternatives, ambiguity: scenario.ambiguity, policy: scenario.policy,
      source: { panels: source.panels.length, connections: source.connections.length, issues: baselineIssues },
      observed: { error: result.error, changes: result.project ? changes(source, result.project) : [],
        issues: result.project ? validateProject(result.project) : null,
        hardware: result.project ? hardwareChange(source, result.project) : null,
        alternatives: review?.alternatives.map(alternative => ({ description: alternative.relaxed.description,
          changes: changes(source, alternative.project), hardware: hardwareChange(source, alternative.project), issues: validateProject(alternative.project) })) ?? [] },
      timingMs: { first: rounded(firstMs), warmMedian: rounded(samples[Math.floor(samples.length / 2)]),
        warmP95: rounded(samples[Math.ceil(samples.length * 0.95) - 1]), review: rounded(reviewMs), samples: samples.length } })
  })
})

afterAll(() => {
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify({
    measuredAt: new Date().toISOString(), environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    method: 'Single Vitest worker. First invocation is not process-cold. 20 repeated solves from the same source; review measured once separately. No latency gate.',
    toleranceMm: tolerance, cases: reports,
  }, null, 2)}\n`)
})
