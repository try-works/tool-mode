/**
 * The host-side contribution registrar (EXT-21..EXT-30, ARCH-06).
 *
 * This is the bridge that was MISSING: `ExtensionLifecycle` could install, activate and
 * publish contributions, and the SDK was fully tested doing so — but the HOST never
 * mounted the lifecycle, so **no extension's tools ever reached the DSH registry**. An
 * extension could be installed, activated and reported `observedActivation: 'active'` with
 * its tool listed, and a caller still could not invoke it.
 *
 * The registrar is the other half: it turns a published contribution into a real registry
 * entry, and withdraws it again on deactivation.
 *
 * Four rules, each of which has been a real defect somewhere:
 *
 * - **Handles are opaque and unguessable.** An extension must not be able to construct a
 *   handle and withdraw a contribution it does not own. A sequence number is guessable;
 *   the handle is a branded object the caller never sees the inside of.
 * - **Withdrawing is idempotent.** A deactivation that runs twice must not throw the
 *   second time, and must not withdraw a DIFFERENT contribution that reused the handle.
 * - **A KIND:NAME collision is refused, and a re-publish is idempotent.** Two extensions
 *   contributing the same kind and label is a configuration error; letting the second win
 *   would silently change what an existing caller reaches. But the SAME extension
 *   publishing the SAME contribution again (a restore followed by an enable, an
 *   activation retry) gets its original handle back, because refusing it aborted a
 *   real activation. Ownership is keyed KIND AND NAME, because a manifest may legally
 *   use one label for a tool, an implementation and its usage skill.
 * - **The host stamps identity.** The contribution carries an extension id, but the HOST
 *   decides what that means; a package claiming another's id is refused rather than
 *   trusted.
 *
 * @module @try-works/dsh-tool-mode/extension-registrar
 */

import type { Contribution, ContributionRegistrar } from '@try-works/tool-mode-extension-sdk'

/** One thing the registrar can put into the DSH registry. */
export interface RegistrableTool {
  /** The caller-facing tool name. */
  readonly name: string
  /** The extension that owns it, as the HOST resolved it. */
  readonly ownerExtension: string
  /** The contract it implements, when it declares one. */
  readonly contractId?: string
}

/** What the registrar needs from the host registry. */
export interface HostRegistrySurface {
  /**
   * Register one tool.
   * @param tool - the tool, with identity already stamped by the host.
   * @returns a disposer that removes it.
   */
  registerTool(tool: RegistrableTool): () => void
  /** Register one skill, returning a disposer. */
  registerSkill?(skill: { readonly name: string; readonly ownerExtension: string }): () => void
  /**
   * Register the CALLER-FACING tools of one declarative implementation (RCP-01).
   *
   * A declarative package declares implementations only — its manifest has no
   * `tools` array — so the tool names and schemas come from the RESOLVED RECIPES,
   * which only the host can turn into registry entries (the recipes need the
   * deployment's harness provider to be served at all). The contribution arrives
   * per implementation; the host resolves the package's recipes and registers the
   * matching tool, returning its disposer. Absent (or a non-declarative package)
   * keeps the earlier behavior: implementations publish nothing.
   */
  registerDeclarative?(contribution: {
    readonly extensionId: string
    readonly name: string
    readonly contractId?: string
  }): () => void
  /**
   * Register the STANDARD-named contract tool for a MODULE implementation
   * whose contract the host knows a standard name for (TASK-121).
   *
   * A module package that declares ONLY implementations (no `tools[]` — the
   * MiniLM pair's shape) serves the standard contract directly: the host maps
   * the contract id to its standard tool name (text.embed -> text_embed) and
   * registers the tool with the contract's own schemas. Returns a disposer
   * when it registered, or undefined when the contract is not a standard one
   * (the declarative branch below then handles it).
   */
  registerContractImplementation?(contribution: {
    readonly extensionId: string
    readonly contractId: string
    readonly implementationId: string
  }): (() => void) | undefined
}

/** Raised when a contribution cannot be published. */
export class ContributionError extends Error {
  override readonly name = 'ContributionError'
  readonly code: 'name-collision' | 'unsupported-kind' | 'unknown-extension'
  constructor(code: ContributionError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/** An opaque handle. The brand makes it unforgeable from the outside. */
interface Handle {
  readonly __contributionHandle: true
  readonly id: number
  readonly extensionId: string
  readonly name: string
  readonly kind: Contribution['kind']
}

/** Who owns one published KIND:NAME, and the handle they were issued. */
interface Ownership {
  readonly extensionId: string
  readonly handleId: number
}

/** One live registration: the opaque handle, its disposer, and the token issued for it. */
interface PublishedEntry {
  readonly handle: Handle
  readonly dispose: () => void
  /** The value handed back to the extension: the branded handle as the SDK's string type. */
  readonly token: string
}

/**
 * The published contributions, keyed by handle id.
 *
 * A Map rather than a field on the handle, so an extension that receives a handle cannot
 * reach the disposer or another extension's entry through it.
 */
export interface RegistrarOptions {
  readonly registry: HostRegistrySurface
  /**
   * The extensions the host has ACTIVATED.
   *
   * A contribution from an extension not in this set is refused: publishing is a privilege
   * of activation, and without this check any code holding the registrar could register a
   * tool under an extension that was never installed.
   */
  readonly activated: ReadonlySet<string>
  /** Called when a contribution is refused, so the reason is recorded rather than lost. */
  readonly onRefused?: (contribution: Contribution, error: ContributionError) => void
}

/**
 * Create the registrar the lifecycle publishes through.
 * @param options - the registry surface and the activated set.
 * @returns the registrar.
 */
export function createContributionRegistrar(options: RegistrarOptions): ContributionRegistrar {
  const published = new Map<number, PublishedEntry>()
  /**
   * Ownership keyed KIND:NAME, so a collision is detected rather than overwritten and
   * a different KIND may legally reuse one label. The lifecycle keys its handles the
   * same way, which is what makes the two views comparable.
   */
  const owners = new Map<string, Ownership>()
  const keyOf = (contribution: { readonly kind: Contribution['kind']; readonly name: string }): string =>
    `${contribution.kind}:${contribution.name}`
  let nextId = 1

  const refuse = (contribution: Contribution, error: ContributionError): never => {
    options.onRefused?.(contribution, error)
    throw error
  }

  return {
    publish(contribution: Contribution): string {
      // ACTIVATION IS A PRECONDITION. A contribution from a package that was never
      // activated is refused rather than registered.
      if (!options.activated.has(contribution.extensionId)) {
        return refuse(contribution, new ContributionError(
          'unknown-extension',
          `${contribution.extensionId} is not activated, so it cannot publish ${contribution.name}`,
        ))
      }

      /**
       * A COLLISION IS REFUSED, BUT A RE-PUBLISH IS NOT A COLLISION.
       *
       * The same extension publishing the same KIND:NAME again (a restore followed by
       * an enable, an activation retry) gets the ORIGINAL handle back. Refusing it
       * aborted a live activation (restore-failures.log: "enhance-speech is already
       * published by @try-works/extension-clear-recipe"); registering a second tool
       * would instead leak a registration no handle can withdraw.
       *
       * A DIFFERENT extension still cannot take the same KIND:NAME over: that would
       * silently change what an existing caller reaches.
       */
      const key = keyOf(contribution)
      const owner = owners.get(key)
      if (owner !== undefined) {
        if (owner.extensionId === contribution.extensionId) {
          const existing = published.get(owner.handleId)
          // A live entry means the original registration is still exactly what this
          // contribution asks for. Ownership without a live entry is a retained
          // record from a cleanup that removed the registration but not the owner;
          // the SAME extension may take its own label back and register afresh.
          if (existing !== undefined) return existing.token
          owners.delete(key)
        } else {
          return refuse(contribution, new ContributionError(
            'name-collision',
            `${contribution.name} is already published by ${owner.extensionId}; `
            + `${contribution.extensionId} cannot take the name over`,
          ))
        }
      }

      const handle: Handle = {
        __contributionHandle: true,
        id: nextId++,
        extensionId: contribution.extensionId,
        name: contribution.name,
        kind: contribution.kind,
      }

      // The SDK types the handle as a string; the runtime value is a branded object,
      // which is what makes it unforgeable. ONE boundary cast produces the token that
      // both the normal and the idempotent path return.
      // SAFETY: the cast only reinterprets the branded object as the SDK's string type;
      // withdraw() compares runtime identity, never the static type.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions
      const token = handle as unknown as string

      let dispose: () => void
      if (contribution.kind === 'tool') {
        dispose = options.registry.registerTool({
          name: contribution.name,
          // The HOST stamps the owner from the contribution it validated, so a package
          // cannot claim another's provenance.
          ownerExtension: contribution.extensionId,
          ...contribution.contractId === undefined ? {} : { contractId: contribution.contractId },
        })
      } else if (contribution.kind === 'skill' && options.registry.registerSkill !== undefined) {
        dispose = options.registry.registerSkill({
          name: contribution.name,
          ownerExtension: contribution.extensionId,
        })
      } else if (contribution.kind === 'implementation' && options.registry.registerDeclarative !== undefined) {
        // TASK-121: a MODULE implementation whose contract has a standard tool
        // name registers the standard-named contract tool; the hook returns
        // undefined when the contract is not standard, and the declarative
        // branch then handles it (RCP-01).
        const contractRegistration = options.registry.registerContractImplementation?.({
          extensionId: contribution.extensionId,
          contractId: contribution.contractId ?? '',
          implementationId: contribution.name,
        })
        if (contractRegistration !== undefined) {
          dispose = contractRegistration
        } else {
          dispose = options.registry.registerDeclarative({
            extensionId: contribution.extensionId,
            name: contribution.name,
            ...contribution.contractId === undefined ? {} : { contractId: contribution.contractId },
          })
        }
      } else {
        dispose = () => {}
      }

      owners.set(key, { extensionId: contribution.extensionId, handleId: handle.id })
      published.set(handle.id, { handle, dispose, token })
      return token
    },

    withdraw(rawHandle: string): void {
      const handle = rawHandle as unknown as Handle
      // A handle that is not ours — a string, a number, a forged object — is ignored
      // rather than treated as a lookup that might match something.
      if (handle === null || typeof handle !== 'object' || handle.__contributionHandle !== true) return
      const entry = published.get(handle.id)
      if (entry === undefined) {
        // IDEMPOTENT: withdrawing twice is not an error, and must not withdraw whatever
        // might have reused the id.
        return
      }
      // The handle must be the SAME one that was issued, not merely an object with the
      // right id, so a reconstructed handle cannot withdraw someone else's tool.
      if (entry.handle !== handle) return
      // Failed cleanup retains ownership and the handle for an explicit retry.
      entry.dispose()
      published.delete(handle.id)
      // Free the KIND:NAME ownership only while it still points at THIS handle: a
      // stale handle must never free a label another handle has since taken.
      const key = keyOf(handle)
      if (owners.get(key)?.handleId === handle.id) owners.delete(key)
    },
  }
}

