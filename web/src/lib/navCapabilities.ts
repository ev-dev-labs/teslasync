/**
 * navCapabilities
 * ───────────────
 * Capability resolution for navigation grouping.
 *
 * Navigation must be role/capability aware WITHOUT deleting destinations.
 * TeslaSync is self-hosted: in open mode the single local operator owns the
 * deployment and therefore owns every administrative surface. Behind a
 * ForwardAuth identity provider the deployment advertises what the current
 * principal may do through `GET /api/v1/system/auth-mode`
 * (`AuthModeCapabilities`), which is the ONLY permission contract the SPA
 * has. This module maps that contract (plus the user's chosen product
 * persona) onto the small set of capabilities the navigation shell needs.
 *
 * Contract
 * --------
 * - Capabilities NEVER remove a route from the catalog, the Feature Hub, or
 *   the command palette. They only decide whether an *advanced* navigation
 *   group is promoted (rendered in place, expandable) or demoted (sorted to
 *   the bottom and collapsed by default).
 * - `core` is granted unconditionally so the everyday hierarchy is identical
 *   for every principal.
 * - Resolution FAILS CLOSED: until the contract confirms a mode, privileged
 *   capabilities are withheld. A failed or in-flight request therefore looks
 *   like "no admin yet", never like "admin".
 *
 * Everything here is pure — no React, no i18n, no DOM.
 */
import type { AuthModeCapabilities, AuthModeResponse } from '@/api/types'
import type { ProductPersona } from './productPreferences'

/** Capability keys a navigation group may require. */
export const NAV_CAPABILITIES = [
  'core',
  'account',
  'administration',
  'developer',
] as const

export type NavCapability = (typeof NAV_CAPABILITIES)[number]

/** The two deployment auth modes the backend contract can report. */
export const NAV_AUTH_MODES = ['open', 'forward_auth'] as const
export type NavAuthMode = (typeof NAV_AUTH_MODES)[number]

export interface NavCapabilityInput {
  /**
   * CONFIRMED deployment auth mode.
   *
   * `undefined` / `null` means the `/system/auth-mode` contract has not
   * resolved (still loading, request failed, or an unrecognized mode string
   * came back). That is NOT the same as confirmed open mode: privileged
   * capabilities stay withheld until the contract answers, so a failed or
   * slow request can never flash administrative surfaces into the primary
   * navigation. Fail closed, then upgrade.
   */
  authMode?: NavAuthMode | null
  /** Capability envelope from the auth-mode contract (may be undefined while loading). */
  authCapabilities?: Partial<AuthModeCapabilities> | null
  /** User-selected product persona (ordering hint, never a grant on its own). */
  persona?: ProductPersona
}

/** Narrow an arbitrary contract value onto a known mode, or `null`. */
export function normalizeNavAuthMode(value: unknown): NavAuthMode | null {
  return typeof value === 'string' && (NAV_AUTH_MODES as readonly string[]).includes(value)
    ? (value as NavAuthMode)
    : null
}

/**
 * Resolve the capability set for the current principal.
 *
 * | capability       | granted when                                                          |
 * | ---------------- | --------------------------------------------------------------------- |
 * | `core`           | always                                                                |
 * | `account`        | CONFIRMED forward-auth mode (per-user identity surfaces exist)        |
 * | `administration` | CONFIRMED open mode (local operator) OR forward-auth advertising `rbac` |
 * | `developer`      | `administration` is granted (deployment-level operator surfaces)      |
 *
 * An unresolved contract grants `core` only.
 */
export function resolveNavCapabilities(
  input: NavCapabilityInput = {},
): ReadonlySet<NavCapability> {
  const mode = normalizeNavAuthMode(input.authMode)
  const rbac = input.authCapabilities?.rbac === true

  const granted = new Set<NavCapability>(['core'])
  if (mode === 'forward_auth') granted.add('account')

  // Confirmed open mode has no principal to authorize against — the person
  // running the container IS the operator. Behind ForwardAuth we defer to the
  // deployment's advertised RBAC capability. An unknown mode grants nothing.
  if (mode === 'open' || (mode === 'forward_auth' && rbac)) {
    granted.add('administration')
    granted.add('developer')
  }

  return granted
}

/** `true` once the auth-mode contract has produced a usable answer. */
export function isNavAuthModeResolved(
  authMode: AuthModeResponse | undefined | null,
): boolean {
  return normalizeNavAuthMode(authMode?.mode) !== null
}

/** Convenience wrapper that reads the raw auth-mode envelope. */
export function resolveNavCapabilitiesFromAuthMode(
  authMode: AuthModeResponse | undefined | null,
  persona?: ProductPersona,
): ReadonlySet<NavCapability> {
  return resolveNavCapabilities({
    authMode: normalizeNavAuthMode(authMode?.mode),
    authCapabilities: authMode?.capabilities ?? null,
    persona,
  })
}

/** `true` when `capability` is granted. Missing set → only `core` is granted. */
export function hasNavCapability(
  granted: ReadonlySet<NavCapability> | undefined | null,
  capability: NavCapability | undefined,
): boolean {
  if (!capability || capability === 'core') return true
  if (!granted) return false
  return granted.has(capability)
}
