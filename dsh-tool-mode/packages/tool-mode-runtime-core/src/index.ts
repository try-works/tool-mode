/**
 * The runtime's shared contract package.
 *
 * Phase 0 is this package: contracts, errors, readiness, the provider service
 * shape and the control-plane ports with local implementations. It imports no
 * host, no Alchemy and no Tardigrade, so every later runtime package can depend
 * on it without dragging a deployment tool along.
 *
 * @module index
 */

export * from './contracts.ts'
export * from './errors.ts'
export * from './readiness.ts'
export * from './provider.ts'
export * from './ports.ts'
