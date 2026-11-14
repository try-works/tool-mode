# @try-works/tool-mode-runtime-recipes

Validates the `model-runtime` recipe of a CODE-FREE model package and resolves the
provider factory that package ships for it. Phase 2 of the runtime plan: a package with
`execution.kind = "declarative"` and no module entry registers a model tool from JSON
alone, and the host never declares an engine dependency.

```ts
import { loadProviderFactory, parseModelRuntimeRecipe } from '@try-works/tool-mode-runtime-recipes'

const parsed = parseModelRuntimeRecipe(JSON.parse(recipeText))
if (!parsed.ok) throw new Error(parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))

const loaded = await loadProviderFactory({ packageDir, recipe: parsed.recipe })
if (!loaded.ok) throw new Error(`${loaded.reason}: ${loaded.detail}`)

// The host calls the factory with the verified assets; the factory owns the engine.
const provider = loaded.factory(parsed.recipe, assets)
```

See `docs/runtime/PLAN.md` and `docs/runtime/PHASE2.md` in the repository for the contract.
