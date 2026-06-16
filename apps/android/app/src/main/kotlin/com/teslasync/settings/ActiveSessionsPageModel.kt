// Pure, framework-free model + projection for the ActiveSessionsPage settings surface — the native analogue of
// the join the web page performs before it hands the active-sessions query to <ActiveSessionsSection />
// (web/src/features/settings/pages/ActiveSessionsPage.tsx, a thin promotion wrapper around
// web/src/features/settings/components/ActiveSessionsSection.tsx). No Compose, no Android framework, no HTTP
// lives here: every declaration is exercised off-device, keeping the composable a thin render layer.
//
// The page itself owns no API hook of its own — it embeds the shared A3 ActiveSessionsSection feature view,
// which consumes the cross-platform P1/S8 [SessionsStore] (the port of the web `useSessions` domain). The one
// derivation this wrapper owes is the adapter from the shared-core list value
// ([io.teslasync.shared.core.presentation.sessions.ActiveSessionsResponse], the open-mode vs forward-auth
// union) to the feature view's render-ready [ActiveSessionsData] input, plus the [Resource] freshness-preserving
// map that carries it. No session field is unit-bearing (ids, ISO timestamps, a user-agent, an IP, a current
// flag), so there is no SI conversion — timestamp localization is a render-boundary concern owned by the
// feature view (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/settings —
// the P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling ChannelsPage /
// ArchivedPage surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.settings.sessions

import io.teslasync.android.featureviews.activesessionssection.ActiveSessionsData
import io.teslasync.android.featureviews.activesessionssection.SessionMode
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.sessions.ActiveSessionsResponse
import io.teslasync.android.featureviews.activesessionssection.ActiveSession as SessionRow
import io.teslasync.shared.core.presentation.sessions.ActiveSession as CoreActiveSession

/**
 * Canonical metadata for the ActiveSessionsPage surface. The web page is a first-class account route, not a
 * draggable dashboard widget, so there is no web registry row to mirror — this object carries the cross-cutting
 * concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires (already a metadata-only
 * destination at Destinations.kt `page("accountSessions", "/account/sessions", …)`) and the diagnostics [SLUG]
 * emitted with the one-shot `view.opened` event (P1/S11).
 */
object ActiveSessionsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("accountSessions", "/account/sessions", …)`). */
    const val ROUTE_ID: String = "accountSessions"

    /** The web route this surface mirrors (deep-link target + the copy-link payload). */
    const val WEB_PATH: String = "/account/sessions"

    /** Diagnostics surface slug emitted with the page's `view.opened` event (P1/S11). */
    const val SLUG: String = "ActiveSessionsPage"
}

/**
 * Adapts the shared-core active-sessions value to the feature view's render-ready input — the open-mode advisory
 * (web `{ mode: 'open' }`) maps to [SessionMode.Open] with no rows, and the forward-auth list (web
 * `{ mode: 'session', sessions }`) maps to [SessionMode.Session] with each row carried verbatim (the device
 * label, IP fallback, and timestamp formatting are the feature view's render-boundary job). Row order is
 * preserved exactly as the backend sent it, matching the web hook which applies no sort.
 */
internal fun ActiveSessionsResponse.toFeatureData(): ActiveSessionsData =
    when (this) {
        ActiveSessionsResponse.Open -> ActiveSessionsData(mode = SessionMode.Open)
        is ActiveSessionsResponse.Session ->
            ActiveSessionsData(
                mode = SessionMode.Session,
                sessions = sessions.map { it.toFeatureRow() },
            )
    }

/** Copies one shared-core [CoreActiveSession] into the feature view's [SessionRow] (identical field-for-field). */
private fun CoreActiveSession.toFeatureRow(): SessionRow =
    SessionRow(
        id = id,
        userAgent = userAgent,
        ip = ip,
        createdAt = createdAt,
        lastSeenAt = lastSeenAt,
        current = current,
    )

/** Maps a [Resource]'s `data`/`cached` payload through [transform], preserving the freshness flags (ADR-013). */
internal fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * The forward-auth empty guard reused by the page ViewModel's [UiState] projection — a session-mode value with
 * no rows is "empty" (web `emptyMessage` branch), while the open-mode advisory is never empty (it always renders
 * its panel). Kept here so the predicate is unit-tested off-device and agrees with the feature view's own
 * Content/Empty split.
 */
internal fun ActiveSessionsData.isEmptyList(): Boolean = mode == SessionMode.Session && sessions.isEmpty()

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ActiveSessionsPageRegistration.SLUG]
 * (P1/S11); carries no session id, IP, or user-agent. The composable calls it from its first-composition effect.
 */
internal fun recordActiveSessionsPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ActiveSessionsPageRegistration.SLUG))
}
