import { parseProject } from '../lib/model'
import type { Project } from '../lib/types'

/** Exercise the saved JSON boundary, including omitted fields and parser validation.
 * This intentionally uses JSON rather than structuredClone: it is a persistence
 * check, not a general-purpose fixture copy.
 */
export function roundTripProject(project: unknown): Project {
  return parseProject(JSON.parse(JSON.stringify(project)))
}
