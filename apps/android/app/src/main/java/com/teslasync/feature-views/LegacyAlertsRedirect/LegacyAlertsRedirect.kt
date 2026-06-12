// The native Jetpack Compose + Material 3 LegacyAlertsRedirect feature view — a parity port of
// web/src/features/notifications/components/LegacyAlertsRedirect.tsx. The web component is a query-aware
// `<Navigate to={to} replace />` from the legacy `/alerts` route to the new `/notifications/*` routes: it reads
// the current location (its only hook, `useLocation`), maps the old `?tab=` parameter to the matching new route,
// forwards every other search param, and redirects with `replace`.
//
// This port keeps that contract. All redirect LOGIC lives in the pure [LegacyAlertsRedirectResolver]
// (LegacyAlertsRedirectModel.kt, off-device tested); this file is the thin render + effect layer. The web
// `<Navigate replace />` (which renders nothing) becomes a one-shot `onRedirect(LegacyAlertsTarget)` emitted from
// a first-composition effect — the host wires it to its NavController and pops the legacy entry for `replace`
// semantics. The view performs NO HTTP and never touches navigation directly (the same hoisting the sibling
// QuickNav / RecentlyViewedWidget ports use).
//
// State honesty: `useLocation` is synchronous, so — exactly like the QuickNav port whose only hook is
// `useTranslation` — there is no loading / error / stale / offline data lifecycle in the source to reproduce
// (honesty covenant: no silent drift). While the host performs the redirect the surface shows the standard
// route-transition affordance (a centered brand [Spinner] with the localized loading label), so it is never a
// blank box — the visible analogue of web `<Navigate>` momentarily rendering nothing. Every string resolves
// through the i18n catalog (P1/S10); the affordance carries a single accessible "Loading" name for TalkBack. The
// one-shot `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LegacyAlertsRedirect) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.legacyalertsredirect

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point for the legacy `/alerts` redirect. Resolves the incoming location [search] to its
 * [LegacyAlertsTarget] (web `TAB_TO_ROUTE` mapping + param forwarding), records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11), emits the target through [onRedirect] for the host to navigate (web
 * `<Navigate replace />`), and renders the transient route-transition affordance until the host swaps the route.
 *
 * @param search the legacy location query string (e.g. `?tab=history&filter=foo`); the native analogue of the
 *   web `useLocation().search`, supplied by the host from the incoming back-stack entry. `null`/blank ⇒ defaults.
 * @param onRedirect invoked once with the resolved target; the host navigates and pops the legacy entry.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LegacyAlertsRedirect(
    search: String?,
    onRedirect: (LegacyAlertsTarget) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val target = remember(search) { LegacyAlertsRedirectResolver.resolve(search) }
    LaunchedEffect(Unit) { LegacyAlertsRedirectDiagnostics.recordViewOpened(logger) }
    LaunchedEffect(target) { onRedirect(target) }
    LegacyAlertsRedirectContent(modifier = modifier)
}

/**
 * Stateless renderer — the snapshot/UI-test and preview entry point. Shows the centered route-transition
 * affordance the surface displays while the host performs the redirect: a large brand [Spinner] with the
 * localized visible label and a single accessible "Loading" name, so the screen is never a blank box (the visible
 * analogue of web `<Navigate>` rendering nothing).
 */
@Composable
fun LegacyAlertsRedirectContent(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    val accessibleLabel = stringResource(R.string.translation_a11y_loading)
    Box(
        modifier = modifier.fillMaxSize().padding(Spacing.xl2),
        contentAlignment = Alignment.Center,
    ) {
        Spinner(size = SpinnerSize.Lg, label = label, accessibleLabel = accessibleLabel)
    }
}

@Preview(name = "Redirecting", showBackground = true)
@Composable
private fun LegacyAlertsRedirectContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LegacyAlertsRedirectContent()
    }
}
