# Architecture and development documentation

Playwood is a browser-local furniture editor. Its saved model describes panels, physical joints, reusable assemblies, and their appearance; React and Three.js turn that model into an editable workspace.

These documents describe the implementation in this repository. Source links point to the modules responsible for each behavior. The root [README](../README.md) remains the guide to using the app, and [AGENTS.md](../AGENTS.md) provides working instructions for coding agents.

## Reading order

| Document | What it explains |
| --- | --- |
| [Architecture overview](architecture.md) | Runtime boundaries, component and module responsibilities, data flow, content, assets, and deployment |
| [Domain model and geometry](domain-model-and-geometry.md) | Coordinates, panel and connector semantics, constrained edits, linked assemblies, validation, and geometry limitations |
| [State and persistence](state-and-persistence.md) | Project history, preview transactions, selection, storage, project and assembly files, and compatibility |
| [Rendering and interaction](rendering-and-interaction.md) | Scene composition, mesh ownership, materials, cameras, input, workers, and realistic preview |
| [Development and verification](development.md) | Setup, actual package scripts, focused tests, browser checks, change recipes, and deployment assets |
| [Startup performance](startup-performance.md) | Production profiling method, measurements, payload budget, and timing targets |
| [Focused quality assessment](quality-assessment.md) | Dated code and UX findings, evidence, priorities, and proposed regression coverage |

## Where to start for a change

| Task | Start here |
| --- | --- |
| Change a panel dimension or joint placement | [Domain model and geometry](domain-model-and-geometry.md), then `model.ts` and `structure-edit.ts` |
| Add a persisted property or fix an import | [State and persistence](state-and-persistence.md), then `types.ts` and the relevant parser |
| Change reusable modules or their editable controls | [Domain model and geometry](domain-model-and-geometry.md), then `assemblies.ts` and `assembly-parameters.ts` |
| Add an editor gesture or preview | [Rendering and interaction](rendering-and-interaction.md) and [State and persistence](state-and-persistence.md) |
| Change materials, scene lighting, or camera behavior | [Rendering and interaction](rendering-and-interaction.md) |
| Add a library example or illustrated guide | [Architecture overview](architecture.md) and [Development and verification](development.md) |
| Choose checks for a patch | [Development and verification](development.md) |

## Documentation maintenance

Update the relevant document when changing a persisted field, operation boundary, input rule, storage key, asset pipeline, or development command. Keep the root agent guide concise and link here for detail. Document implemented behavior and limitations; mark proposals explicitly rather than presenting them as current architecture.
