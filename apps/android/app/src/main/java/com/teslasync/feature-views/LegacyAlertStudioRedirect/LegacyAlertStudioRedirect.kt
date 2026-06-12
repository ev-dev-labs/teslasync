// The native Jetpack Compose + Material 3 LegacyAlertStudioRedirect feature view — a parity port of
// web/src/features/notifications/components/LegacyAlertStudioRedirect.tsx. The web component is a legacy-route
// bridge: mounted at `/alert-studio`, it reads the current URL's query string via react-router's `useLocation`
// and immediately redirects to `/notifications/studio`, preserving that query string verbatim and REPLACING the
// history entry so the back button skips the dead legacy URL —
//
//     const { search } = useLocation();
//     return <Navigate to={`/notifications/studio${search}`} replace />;
//
// keeping existing draft-restore deep links + email CTAs (`/alert-studio?rule=42`, `?signals=…&from=signal-diff`,
// `?id=42`) working after the studio moved under the notifications section.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no S8 data store (its only web hook is
// `useLocation`, the URL-location hook — navigation-framework state, not data; the incoming query string is
// supplied by the host from the current back-stack entry, the platform analogue of `useLocation().search`). The
// pure [LegacyAlertStudioRedirectProjection] turns that query into the redirect [LegacyAlertStudioRedirectTarget]
// (route `notifications/studio`, the preserved query, `replace = true`); this composable is a thin layer that
// fires the redirect once and renders the transient "redirecting" affordance.
//
// Decoupling: the web `<Navigate to=… replace />` becomes a one-shot [onRedirect] emission the host wires to a
// replace navigation (the view never touches the NavController) — the same decoupling the sibling QuickNav port
// uses for its `onNavigate` callback.
//
// States: the web source performs no fetch and has no async / error / empty / stale / offline branch — it is a
// pure synchronous redirect. Inventing those data-lifecycle states would fabricate behaviour the web spec lacks
// (honesty covenant: no parity shortcuts, no silent drift), exactly as the sibling QuickNav port documents for
// its own zero-data-source surface. The single genuine state is the transient redirect, rendered as the brand
// [PageLoader] — the native analogue of the web Suspense/route fallback shown while the lazy redirect chunk
// loads — so the surface is never a blank box and carries an accessible "Loading" label for TalkBack.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LegacyAlertStudioRedirect — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path, exactly as the sibling feature-view
// surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.legacyalertstudioredirect

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point for the legacy `/alert-studio` → `/notifications/studio` redirect. Records the one-shot
 * PII-safe `view.opened` diagnostic (P1/S11), resolves the redirect target from the incoming query string (web
 * `useLocation().search`), and emits it once through [onRedirect] (web `<Navigate replace />`) for the host to
 * navigate — the view never touches the NavController. While that one-frame redirect is in flight it renders the
 * transient "redirecting" affordance so the surface is never a blank box.
 *
 * @param onRedirect invoked with the resolved [LegacyAlertStudioRedirectTarget]; the host performs the replace
 *   navigation (web `<Navigate to={…} replace />`).
 * @param search the incoming query string from the current back-stack entry (web `useLocation().search`); the
 *   leading `?` is optional and the inner params are preserved verbatim. Defaults to no query.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LegacyAlertStudioRedirect(
    onRedirect: (LegacyAlertStudioRedirectTarget) -> Unit,
    modifier: Modifier = Modifier,
    search: String = "",
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LegacyAlertStudioRedirectDiagnostics.recordViewOpened(logger) }
    val target = remember(search) { LegacyAlertStudioRedirectProjection.target(search) }
    LaunchedEffect(target) { onRedirect(target) }
    LegacyAlertStudioRedirectContent(modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the only thing the user ever sees of
 * this redirect: the transient "redirecting" affordance, rendered as the brand [PageLoader] (the native analogue
 * of the web Suspense/route fallback shown while the lazy redirect chunk loads). The loader carries the localized
 * loading label (P1/S10), which doubles as its single accessible name so TalkBack announces "Loading" rather
 * than a silent, unlabeled box.
 */
@Composable
fun LegacyAlertStudioRedirectContent(modifier: Modifier = Modifier) {
    PageLoader(modifier = modifier, label = stringResource(R.string.translation_common_loading))
}

// ── Preview (tooling-only; exercises the single render branch) ──────────────────────────────────────

@Preview(name = "Redirecting", showBackground = true)
@Composable
private fun LegacyAlertStudioRedirectContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LegacyAlertStudioRedirectContent()
    }
}
