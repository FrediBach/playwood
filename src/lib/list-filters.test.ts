import { describe, expect, it } from 'vitest'
import { emptyFilters, filterCount, matchesChoice, matchesCommon } from './list-filters'

describe('list filters', () => {
  it('creates independent filter drafts', () => {
    const first = emptyFilters(), second = emptyFilters()
    first.colors.push('#ffffff')
    expect(second.colors).toEqual([])
    expect(filterCount(second)).toBe(0)
  })

  it('counts active categories and treats a zero maximum area as a limit', () => {
    expect(filterCount({ ...emptyFilters(), colors: ['#ffffff', '#000000'], maxArea: 0 })).toBe(2)
    expect(filterCount({ ...emptyFilters(), minArea: 0, maxArea: null })).toBe(0)
  })

  it('combines normalized search and color with visibility and selection', () => {
    const filters = { ...emptyFilters(), search: '  shelf ', colors: ['#abcdef'], visibility: 'hidden', selection: 'unselected' }
    expect(matchesCommon(filters, 'Upper SHELF', '#ABCDEF', false, false)).toBe(true)
    expect(matchesCommon(filters, 'Side panel', '#ABCDEF', false, false)).toBe(false)
    expect(matchesCommon(filters, 'Upper shelf', '#ffffff', false, false)).toBe(false)
    expect(matchesCommon(filters, 'Upper shelf', '#ABCDEF', true, false)).toBe(false)
    expect(matchesCommon(filters, 'Upper shelf', '#ABCDEF', false, true)).toBe(false)
  })

  it('accepts all choices until a category is filtered', () => {
    expect(matchesChoice([], 'plywood')).toBe(true)
    expect(matchesChoice(['plywood', 'painted'], 'plywood')).toBe(true)
    expect(matchesChoice(['plywood', 'painted'], 'mdf')).toBe(false)
  })
})
