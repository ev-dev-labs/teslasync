// The native Jetpack Compose + Material 3 LegacyNotificationsRedirect feature view — a parity port of
// web/src/features/notifications/components/LegacyNotificationsRedirect.tsx. The web component is a smart,
// query-aware redirect: it reads the legacy `/notifications?tab=…` location and renders `<Navigate to={to}
// replace />`, forwarding the remaining search params so filter/search state survives. It draws NO visible UI of
// its own (a `<Navigate>` element returns null), performs NO HTTP, and binds NO data hook — its only web hook is
// `useLocation`, mapped here to the incoming legacy query string the host hands in.
//
// This port keeps that contract end to end. All of the resolution — which tab the legacy query selects, which
// params are forwarded — lives in the pure [LegacyNotificationsRedirectProjection]; this composable is a thin
// layer that (1) resolves the target once, (2) records the PII-safe `view.opened` diagnostic (P1/S11), and
// (3) emits the resolved [LegacyNotificationsRedirectTarget] through [onRedirect] — the native analogue of the
// web `<Navigate replace>` — which the host turns into a real `replace`-style navigation (the view never touches
// the NavController, exactly as the sibling QuickNav port emits a destination instead of navigating itself).
//
// States: like the sibling QuickNav port (another zero-data-source surface), this redirect has no data fetch and
// its resolution is total — the two `?? inbox` fallbacks mean it can never fail or resolve to "nothing" — so
// there is no loading-from-network / error / empty / stale / offline lifecycle to render; modelling those would
// invent behaviour the web spec does not have (honesty covenant: no silent drift). The one visible state is the
// brief redirect-in-progress affordance shown for the frame before the host navigates away: rather than the web
// `<Navigate>`'s literal null (which would be a blank box on a native screen, and silent to TalkBack), it shows a
// centered, accessible progress mark naming the destination it is forwarding to. The surface's genuine variation
// — which of the three Notifications pages it lands on — is exercised per-branch by the unit + UI tests.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LegacyNotificationsRedirect — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path, exactly as the sibling feature-view
// surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.legacynotificationsredirect

import androidx.annotation.StringRes
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
 * Stateful entry point for the legacy notifications redirect. Resolves the target from the incoming legacy
 * [search] string (web `useLocation().search`), records the one-shot PII-safe `view.opened` diagnostic (P1/S11),
 * and emits the resolved [LegacyNotificationsRedirectTarget] through [onRedirect] — the native analogue of the
 * web `<Navigate to={to} replace />`. The host performs the actual `replace`-style navigation; this view never
 * touches the NavController. While the host navigates, it renders the redirect-in-progress affordance.
 *
 * @param search the legacy location's query string (with or without a leading `?`; `null`/empty for bare
 *   `/notifications`), supplied by the host navigation seam — the `useLocation` parity boundary.
 * @param onRedirect invoked once with the resolved target; the host navigates to [target.routeWithQuery] with
 *   `replace` semantics (web `replace`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LegacyNotificationsRedirect(
    search: String?,
    onRedirect: (LegacyNotificationsRedirectTarget) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val target = remember(search) { LegacyNotificationsRedirectProjection.resolve(search) }
    LaunchedEffect(target) {
        LegacyNotificationsRedirectDiagnostics.recordViewOpened(logger, target.tab)
        onRedirect(target)
    }
    LegacyNotificationsRedirectContent(target = target, modifier = modifier)
}

/**
 * Stateless renderer — the preview + UI-test entry point. Shows the redirect-in-progress affordance for the
 * frame before the host navigates away: a centered, accessible progress mark naming the destination [target] it
 * is forwarding to, so the surface is never a blank box and TalkBack announces where the redirect leads. Side-
 * effect-free (it neither records diagnostics nor triggers navigation), so previews and tests render it freely.
 */
@Composable
fun LegacyNotificationsRedirectContent(
    target: LegacyNotificationsRedirectTarget,
    modifier: Modifier = Modifier,
) {
    PageLoader(modifier = modifier, label = stringResource(tabLabelRes(target.tab)))
}

/**
 * Destination tab → localized label (P1/S10). The web surface is anonymous (it renders no text), so each tab
 * resolves to its canonical Notifications nav label — the same localized string the drawer uses for that page —
 * giving the redirect affordance a real, translated destination name rather than an English literal.
 */
@StringRes
private fun tabLabelRes(tab: LegacyNotificationsTab): Int =
    when (tab) {
        LegacyNotificationsTab.Inbox -> R.string.translation_nav_notificationsInbox
        LegacyNotificationsTab.Archived -> R.string.translation_nav_notificationsArchived
        LegacyNotificationsTab.Channels -> R.string.translation_nav_notificationsChannels
    }

// ── Previews (tooling-only; @Preview entry points exercise each redirect target) ────────────────────

@Preview(name = "Inbox", showBackground = true)
@Composable
private fun LegacyNotificationsRedirectInboxPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LegacyNotificationsRedirectContent(LegacyNotificationsRedirectProjection.resolve("tab=inbox"))
    }
}

@Preview(name = "Archived", showBackground = true)
@Composable
private fun LegacyNotificationsRedirectArchivedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LegacyNotificationsRedirectContent(LegacyNotificationsRedirectProjection.resolve("tab=archived"))
    }
}

@Preview(name = "Channels", showBackground = true)
@Composable
private fun LegacyNotificationsRedirectChannelsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LegacyNotificationsRedirectContent(LegacyNotificationsRedirectProjection.resolve("tab=channels"))
    }
}
