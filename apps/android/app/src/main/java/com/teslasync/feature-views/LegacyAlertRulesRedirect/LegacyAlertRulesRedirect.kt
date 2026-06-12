// The native Jetpack Compose + Material 3 LegacyAlertRulesRedirect feature view — a parity port of
// web/src/features/notifications/components/LegacyAlertRulesRedirect.tsx. The web component is a route-level
// redirect: it reads `useLocation().search` and returns `<Navigate to={`/notifications/rules${search}`}
// replace />`, sending the legacy `/alert-rules` URL to the canonical notification-rules page while carrying
// any query string across and swapping (not pushing) the history entry.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook (its only web hook is
// `useLocation`, modelled as the [LegacyLocation] the host supplies from the NavBackStackEntry). Like the
// sibling QuickNav port, it never touches the NavController directly: it computes the redirect via the pure
// [LegacyAlertRulesRedirectProjection] and emits it once through [onRedirect], which the host wires to a
// pop-and-replace navigation (web `replace`). Because the surface has no data source, there is no
// loading / error / stale / offline data lifecycle to render — modelling those would invent behaviour the web
// spec does not have (honesty covenant: no silent drift). What it does render is the one genuine, honest
// visual: a brief, accessible "redirecting" affordance for the frame between emitting the target and the host
// completing the navigation, so the route is never a blank box. A defensive empty fallback covers the
// (unreachable for the static alias) case of an unresolved target, mirroring the sibling QuickNav empty guard.
//
// Reduced motion: the redirecting affordance honors the platform / app reduced-motion preference (P1 a11y) —
// an animated brand spinner normally, swapped for a static labeled status row when motion is reduced. Both
// branches expose the same single accessible name so TalkBack announces the localized status either way.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LegacyAlertRulesRedirect — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path, exactly as the sibling
// feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.legacyalertrulesredirect

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point for the legacy alert-rules redirect. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), computes the redirect target from [location] (the web `useLocation().search`), and
 * renders the transient redirect affordance. The surface binds no data of its own; it emits the resolved
 * [LegacyAlertRulesRedirectTarget] through [onRedirect] exactly once (web `<Navigate replace>`), and the host
 * performs the pop-and-replace navigation.
 *
 * @param onRedirect invoked once with the resolved target; the host navigates (the view never touches the
 *   NavController).
 * @param location the current location (web `useLocation()`); defaults to no query — the common bare
 *   `/alert-rules` visit. The host supplies the real query from the NavBackStackEntry to preserve it.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LegacyAlertRulesRedirect(
    onRedirect: (LegacyAlertRulesRedirectTarget) -> Unit,
    modifier: Modifier = Modifier,
    location: LegacyLocation = LegacyLocation.None,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LegacyAlertRulesRedirectDiagnostics.recordViewOpened(logger) }
    val target = remember(location) { LegacyAlertRulesRedirectProjection.resolve(location) }
    LegacyAlertRulesRedirectContent(target = target, onRedirect = onRedirect, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Fires the redirect once for a non-null
 * [target] (web `<Navigate replace>`) and shows the transient redirecting affordance; when [target] is null
 * (an unresolved override — never the static alias) it shows a friendly empty state so the surface is never a
 * blank box. [reduceMotion] defaults to the active platform/app preference and is overridable for tests.
 */
@Composable
fun LegacyAlertRulesRedirectContent(
    target: LegacyAlertRulesRedirectTarget?,
    onRedirect: (LegacyAlertRulesRedirectTarget) -> Unit,
    modifier: Modifier = Modifier,
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    if (target == null) {
        GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
            EmptyState(
                message = stringResource(R.string.translation_common_noData),
                icon = TeslaGlyphs.Info,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        return
    }
    LaunchedEffect(target) { onRedirect(target) }
    RedirectingIndicator(reduceMotion = reduceMotion, modifier = modifier)
}

/**
 * The transient redirect affordance — the honest native representation of the frame between emitting the
 * target and the host completing the navigation. (The web `<Navigate>` renders null because React Router
 * redirects synchronously within the same render pass; native navigation is event-driven, so this brief
 * status is shown instead of a blank box.) Honors reduced motion: an animated brand [Spinner] normally, a
 * static labeled row when motion is reduced. Both expose the same single localized accessible name.
 */
@Composable
private fun RedirectingIndicator(
    reduceMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(R.string.translation_common_loading)
    Box(
        modifier = modifier.fillMaxWidth().padding(Spacing.xl2),
        contentAlignment = Alignment.Center,
    ) {
        if (reduceMotion) {
            Row(
                modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = label },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Icon(imageVector = TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Md)
                BodyText(label)
            }
        } else {
            Spinner(size = SpinnerSize.Md, label = label)
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Redirecting", showBackground = true)
@Composable
private fun LegacyAlertRulesRedirectContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LegacyAlertRulesRedirectContent(
            target = LegacyAlertRulesRedirectProjection.resolve(LegacyLocation(search = "?tab=active")),
            onRedirect = {},
            reduceMotion = false,
        )
    }
}

@Preview(name = "Redirecting (reduced motion)", showBackground = true)
@Composable
private fun LegacyAlertRulesRedirectReducedMotionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LegacyAlertRulesRedirectContent(
            target = LegacyAlertRulesRedirectProjection.resolve(LegacyLocation.None),
            onRedirect = {},
            reduceMotion = true,
        )
    }
}

@Preview(name = "Unresolved fallback", showBackground = true)
@Composable
private fun LegacyAlertRulesRedirectFallbackPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LegacyAlertRulesRedirectContent(target = null, onRedirect = {})
    }
}
