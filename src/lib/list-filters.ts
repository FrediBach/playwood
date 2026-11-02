export interface ListFiltersState {
  search: string; colors: string[]; types: string[]; materials: string[]; patterns: string[]; thicknesses: string[]
  visibility: string; selection: string; minArea: number; maxArea: number | null
}
export const emptyFilters = (): ListFiltersState => ({ search: '', colors: [], types: [], materials: [], patterns: [], thicknesses: [], visibility: '', selection: '', minArea: 0, maxArea: null })
export const filterCount = (filters: ListFiltersState) => Object.entries(filters).filter(([key, value]) => key === 'maxArea' ? value !== null : Array.isArray(value) ? value.length > 0 : !!value).length
export const matchesChoice = (choices: string[], value: string) => !choices.length || choices.includes(value)
export const matchesCommon = (filters: ListFiltersState, name: string, color: string, visible: boolean, selected: boolean) =>
  name.toLowerCase().includes(filters.search.trim().toLowerCase()) && matchesChoice(filters.colors, color.toLowerCase()) &&
  (!filters.visibility || visible === (filters.visibility === 'visible')) && (!filters.selection || selected === (filters.selection === 'selected'))

