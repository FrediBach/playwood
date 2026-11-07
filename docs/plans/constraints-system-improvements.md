# Constraints system improvements

## Implementation progress

- Step 1 implemented: stock bounds participate in every structural solve and its local-anchor retry, independently of saved design rules. Regression coverage checks both cut limits, release after reversing a resize, equivalence with a redundant rule, and atomic rejection of impossible cascades. Existing placement fallback policy is retained.
- Step 2 implemented: protective dimension intervals no longer authorize recutting loose peers during movement or gap reconciliation. Exact/equal dimensions, repair of violated limits, and physically connected cascades remain supported. Cut-preservation locks survive placement fallback; a conflicting gap/position edit rejects atomically.
- Step 3 implemented for numeric cut edits: inferred setbacks, alignments, and compartment fits have distinct provenance. Blocked edits can offer individually validated single-relationship alternatives, with affected cuts/positions, explicit acceptance, cancellation, stale-source protection, and new-overlap rejection. Protective defaults and the overlap threshold remain unchanged; gestures and assembly parameters do not offer alternatives yet. The bounded search does not combine releases.
- Steps 4–6 and broader gesture feedback/overlap work remain planned.

## Original analysis

Yes. **There is room for more cascading, but the main improvement is separating physical constraints from assumptions about the user’s intent.** The solver already handles substantial cascades, including closed grids, angled joints, supported inserts, and fitted outlines.

I found three reproducible behaviors that show where to start.

1. **Some feasible cascades are rejected unnecessarily.**

   In a valid T joint, increasing a parent panel from 100 to 200 mm fails with a size-limit error. Adding an already-satisfied rule—“parent width ≥40 mm”—makes the identical resize succeed, with the neighboring continuation shrinking safely to 40 mm.

   Stock limits participate in the solver only when saved design rules exist. Otherwise, the solver chooses a result and checks its dimensions afterward. [Source](/Users/fredibach/Projects/playwood/src/lib/structure-edit.ts:267)

   **Recommendation:** always solve with stock bounds. This unlocks additional cascades while retaining the existing joints and anchoring behavior. It is the clearest first improvement.

2. **A protective limit can unexpectedly become permission to distort a panel.**

   I tested two loose, 600 mm wide panels with a minimum gap of 200 mm. Moving the first panel toward the second produces:

   | Saved rules | What happens to the second panel |
   |---|---|
   | Minimum gap only | Moves 100 mm; stays 600 mm wide |
   | Same gap, plus width ≥500 mm | Moves 50 mm **and shrinks to 500 mm** |

   Both results pass validation. Any dimension rule currently makes that dimension available for resizing, and the objective makes resizing relatively cheap. [Source](/Users/fredibach/Projects/playwood/src/lib/structure-edit.ts:230)

   **Recommendation:** separate **allowed dimensions** from **preferred behavior**. A minimum-width rule should preserve the current cut when movement alone can satisfy the edit. Resizing should follow an explicit dimensional relationship or the needs of the connected construction.

3. **Inferred relationships can change abruptly with tiny geometry differences.**

   With one centered 90° joint, increasing the parent’s depth from 400 to 500 mm:

   - A child initially 200 mm deep stays 200 mm.
   - A child initially **200.01 mm** deep grows to **300.01 mm**.

   Crossing the “more than half the edge overlaps” threshold makes both existing setbacks mandatory. [Source](/Users/fredibach/Projects/playwood/src/lib/structure-edit.ts:305)

   The setback protection is useful—it prevents shelves gradually losing their alignment—but that threshold is weak evidence of intent.

   **Recommendation:** distinguish authored requirements from inferred alignments, setbacks, and compartment fits. Keep these protective defaults, then offer a specific alternative when they block an otherwise feasible edit: for example, “keep the front aligned; allow the rear overhang to change.”

For broader cascading, I would build on those fixes in this order:

4. **Expand the affected construction in stages.**

   Start with the selected panel and directly affected spans. Preserve neighboring cuts, reference faces, and other compartments where possible. Expand into adjacent compartments only when necessary.

   The current weighted objective measures numerical change; it does not understand which compartment should absorb it. Some fallback paths also release all automatic placement preferences together. [Source](/Users/fredibach/Projects/playwood/src/lib/structure-edit.ts:519)

   A staged approach would make behavior more predictable: moving an interior shelf first adjusts the spans above and below it; reaching a limit can offer to move the next shelf or grow the outer frame. Wider changes should become visible alternatives when they alter a meaningful boundary.

5. **Add relationships that describe furniture intent directly.**

   The most valuable additions would be:

   - **Keep clear openings equal** as the cabinet grows.
   - **Keep an opening or reference edge fixed** while neighboring bays absorb changes.
   - Match one panel’s **width to another’s height**, for differently oriented cuts.
   - Explicitly preserve a setback or proportional division.

   Currently, equal-dimension rules require the same local dimension on both panels, and equal-gap distribution is a one-time operation rather than a saved relationship. [Schema](/Users/fredibach/Projects/playwood/src/lib/types.ts:77)

   These relationships would enable deliberate cascades without guessing that similarly sized bays must remain equal.

6. **Resize linked assemblies through coordinated parameter edits.**

   A four-box closed loop rejects a single-instance resize, while changing the shared dimensions together succeeds. The individual-instance API validates after each edit, preventing some coordinated changes from being reached sequentially. [Source and existing regression](/Users/fredibach/Projects/playwood/src/lib/assembly-parameters.test.ts:119)

   Start with an atomic operation that changes several selected instances’ parameters together. Later automatic propagation should use their exposed parameters, preserve explicit overrides, and have a deliberate placement anchor.

Broader cascades also need clearer feedback. Edge-pull readouts currently show only the selected cut, and resize limiting discards the error explaining why movement stopped. Show affected cuts and movements, their causes, and the limiting joint or rule. [Readouts](/Users/fredibach/Projects/playwood/src/hooks/use-preview-resize.ts:50), [limit handling](/Users/fredibach/Projects/playwood/src/lib/preview-resize.ts:183)

One prerequisite is explicit handling of new overlaps: ordinary structural resizing rejects new validation **errors**, while panel collisions are generally **warnings**. Expanded cascades should check that consequence deliberately. [Validation](/Users/fredibach/Projects/playwood/src/lib/structure-edit.ts:674)

Analysis only; the worktree is unchanged. The main structural/constraint run passed **162 tests**, and assembly/resize-preview coverage passed **46 tests**. The targeted probes above also passed.
