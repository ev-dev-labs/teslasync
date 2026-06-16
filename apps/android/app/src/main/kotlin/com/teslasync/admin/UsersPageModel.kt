// Pure, framework-free model + diagnostics for the UsersPage admin surface — the native analogue of everything
// the web page derives before it returns JSX (web/src/features/admin/pages/UsersPage.tsx, the admin Subjects
// list). No Compose, no Android UI, no HTTP lives here: the feed arrives as the shared, already-decoded S8
// payload (the KMP `ImpersonationStore.candidates` ▸ `GET /admin/impersonate/candidates`, a typed
// `ImpersonationCandidatesResponse`), so this file owns only the client-side derivations the web component does
// inline — the subjects projection (web `candidates.data?.mode === 'session' ? candidates.data.candidates : []`)
// and the empty-subjects guard (web `subjects.length === 0`) — plus the surface's navigation identity and the
// one PII-safe `view.opened` diagnostic. The opaque subject identifier carries no display-unit fields, so there
// is no SI conversion (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling admin surfaces do. `MatchingDeclarationName` is suppressed for the co-located derivations + recorder.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.users

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.impersonation.ImpersonationCandidate
import io.teslasync.shared.core.presentation.impersonation.ImpersonationCandidatesResponse

/**
 * Canonical metadata for this surface. The web page ships UNROUTED — it has no `routeRegistry.ts` entry, so the
 * parity manifest records its web route as `(unrouted)` and the web file notes "a follow-up change will register
 * the route". This object therefore carries the surface's forward-looking navigation [ROUTE_ID] (reserved for
 * the future Destinations entry the host wires when the route lands) and the diagnostics [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11). There is no live `Destinations` row yet, by design — adding one would
 * break the generated 137-route parity lock — so [UsersPageHost] registers the content dormantly, mirroring the
 * web page's own "shipped but unrouted" status verbatim.
 */
object UsersPageRegistration {
    /** The navigation destination id reserved for this surface; no live Destinations row yet (web unrouted). */
    const val ROUTE_ID: String = "adminUsers"

    /** The web route this surface mirrors — `(unrouted)`, matching the parity manifest record verbatim. */
    const val WEB_PATH: String = "(unrouted)"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no subject identifier. */
    const val SLUG: String = "UsersPage"
}

/**
 * The impersonatable subjects to render — the native fold of the web
 * `candidates.data?.mode === 'session' ? candidates.data.candidates : []`. A non-session response (the open-mode
 * sentinel) yields an empty list exactly as the web ternary collapses a non-`session` mode to `[]`.
 */
fun ImpersonationCandidatesResponse.subjects(): List<ImpersonationCandidate> =
    (this as? ImpersonationCandidatesResponse.Session)?.candidates ?: emptyList()

/**
 * Whether the candidates response carries no actionable subject — gates the native Empty phase (web
 * `subjects.length === 0`). A non-session response (open-mode sentinel) or a session with no candidates (the
 * single-subject install where the actor is excluded) is empty; a session with at least one subject is content
 * (the list).
 */
val ImpersonationCandidatesResponse.isEmptyCandidates: Boolean
    get() = subjects().isEmpty()

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [UsersPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no subject identifier — an opaque-but-still-sensitive value — so a diagnostics line can
 * never leak who an admin could impersonate.
 */
fun recordUsersPageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to UsersPageRegistration.SLUG))
}

internal const val EVENT_VIEW_OPENED = "view.opened"
internal const val FIELD_SURFACE = "surface"
