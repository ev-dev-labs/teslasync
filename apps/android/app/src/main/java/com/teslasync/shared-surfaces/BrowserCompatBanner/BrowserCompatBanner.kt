// The native Jetpack Compose + Material 3 BrowserCompatBanner shared surface — a parity port of
// web/src/components/feedback/BrowserCompatBanner.tsx and the `@/components/feedback/AlertBanner` it renders. The
// web surface is a one-time, dismissable WARNING shown when the host platform is missing one or more capabilities
// TeslaSync depends on: a warning-tinted alert with a triangle glyph, a localized title + a body that
// interpolates the comma-joined missing-feature list and a recommendation, and a dismiss control — mounted as a
// sticky, `role="status"` / `aria-live="polite"` region.
//
// This surface is the native equivalent. All state flows through the shared [BrowserCompatBannerViewModel] over
// the [BrowserCompatSource] seam (P1/S8) — the view performs NO HTTP and reads no `PackageManager`/persistence
// directly. Every derivation flows through the pure [classify] / [joinFeatures]; the composable is a thin render
// layer. The faithful mapping of the web behaviour:
//   • `dismissed || missing.length === 0` → [BrowserCompatSurface.Hidden] → nothing is emitted (web `null`).
//   • otherwise → a warning [Surface] (the web `variant="warning"` AlertBanner) with the [TeslaGlyphs.Warning]
//     triangle, the `compat.banner.title`, the `compat.banner.body` interpolated with the missing-feature list +
//     `compat.banner.recommendation`, and a dismiss [IconButton] labelled `compat.banner.dismiss`.
//   • the web wrapper's `role="status"` + `aria-live="polite"` → the message region is a single merged,
//     POLITE live region carrying the [bannerAccessibilityLabel] announcement, while the dismiss button stays a
//     separately-focusable node with its own label (so every interactive element is labelled).
//
// The alert chrome is composed here from the shared atoms ([Surface], [Icon], [BodyText], [IconButton],
// [toneColors]/[toneGlyph]) rather than the shared [io.teslasync.android.components.feedback.AlertBanner],
// because that atom's flat structure (a single merged row) cannot host the web's split semantics — a polite live
// region over the MESSAGE plus an independently-labelled dismiss button — the same approach the sibling
// AiLimitBanner takes for its richer alert.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/BrowserCompatBanner) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.browsercompatbanner

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.feedback.toneGlyph
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the whole banner container — used by the instrumented per-state + a11y UI tests. */
const val BROWSER_COMPAT_BANNER_TEST_TAG: String = "browser-compat-banner"

/** Test tag identifying the dismiss control. */
const val BROWSER_COMPAT_BANNER_DISMISS_TAG: String = "browser-compat-banner-dismiss"

/** Web `border` on the alert — a 1 px hairline tinted to the warning severity. */
private val ALERT_BORDER_WIDTH: Dp = 1.dp

/**
 * Stateful entry point — the faithful port of the web `BrowserCompatBanner`. Binds the
 * [BrowserCompatBannerViewModel], records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved
 * [BrowserCompatSurface], and renders it. Renders nothing while the surface is [BrowserCompatSurface.Hidden]
 * (host supported OR dismissed — web returns `null`). Performs NO HTTP; [source] defaults to the production
 * `PackageManager` + compat-preferences binding and [logger] to the app's redacting logger.
 *
 * @param modifier optional layout modifier for the banner container.
 * @param source the detection + sticky-dismissal seam; defaults to [bindBrowserCompatSource] over the app context.
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun BrowserCompatBanner(
    modifier: Modifier = Modifier,
    source: BrowserCompatSource = rememberBrowserCompatSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: BrowserCompatBannerViewModel =
        viewModel(
            key = BROWSER_COMPAT_BANNER_SLUG,
            factory = BrowserCompatBannerViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val surface by viewModel.surface.collectAsStateWithLifecycle()
    BrowserCompatBannerContent(surface = surface, modifier = modifier, onDismiss = viewModel::dismiss)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Renders the warning for
 * [BrowserCompatSurface.Active] and emits nothing for [BrowserCompatSurface.Hidden] (web `null`). Hoisted out of
 * the ViewModel so each state is preview- and screenshot-testable.
 */
@Composable
fun BrowserCompatBannerContent(
    surface: BrowserCompatSurface,
    modifier: Modifier = Modifier,
    onDismiss: () -> Unit = {},
) {
    val active = surface as? BrowserCompatSurface.Active ?: return
    BrowserCompatAlert(active = active, onDismiss = onDismiss, modifier = modifier)
}

/**
 * The web AlertBanner chrome: a warning-tinted, bordered surface with the triangle glyph + title + body in a
 * single merged POLITE live region (the web `role="status"` / `aria-live="polite"` message), and an
 * independently-labelled dismiss control (the web `onClose` X).
 */
@Composable
private fun BrowserCompatAlert(
    active: BrowserCompatSurface.Active,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tone = Tone.Warning
    val colors = toneColors(tone)
    val title = stringResource(R.string.translation_compat_banner_title)
    val recommendation = stringResource(R.string.translation_compat_banner_recommendation)
    val body = stringResource(R.string.translation_compat_banner_body, active.features, recommendation)
    val dismissLabel = stringResource(R.string.translation_compat_banner_dismiss)
    val announcement = bannerAccessibilityLabel(title, body)

    Surface(
        modifier = modifier.fillMaxWidth().testTag(BROWSER_COMPAT_BANNER_TEST_TAG),
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(ALERT_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics(mergeDescendants = true) {
                            liveRegion = LiveRegionMode.Polite
                            contentDescription = announcement
                        },
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(toneGlyph(tone), contentDescription = null, size = IconSize.Md, tint = colors.foreground)
                    Text(title, style = MaterialTheme.typography.titleSmall, color = colors.foreground)
                }
                BodyText(body)
            }
            IconButton(
                TeslaGlyphs.Close,
                contentDescription = dismissLabel,
                onClick = onDismiss,
                modifier = Modifier.testTag(BROWSER_COMPAT_BANNER_DISMISS_TAG),
                size = IconSize.Sm,
                tint = colors.foreground,
            )
        }
    }
}

/** The default production source: a `PackageManager` + compat-preferences binding over the app context. */
@Composable
private fun rememberBrowserCompatSource(): BrowserCompatSource {
    val context = LocalContext.current
    return remember(context) { bindBrowserCompatSource(context) }
}

// ── Previews (tooling-only) ─────────────────────────────────────────────────────────────────────────────
// The Hidden surface intentionally renders nothing (web `null`), so only the Active surface has a visible
// preview: one with every required capability missing, and one with a single capability missing. The strings
// resolve through the P1/S10 catalog (no hardcoded English).

@Preview(name = "BrowserCompatBanner · all capabilities missing", showBackground = true)
@Composable
private fun BrowserCompatBannerAllMissingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BrowserCompatBannerContent(
            surface =
                BrowserCompatSurface.Active(
                    listOf(
                        RequiredCapability.WebView,
                        RequiredCapability.GooglePlayServices,
                        RequiredCapability.CustomTabs,
                    ),
                ),
            onDismiss = {},
        )
    }
}

@Preview(name = "BrowserCompatBanner · single capability missing", showBackground = true)
@Composable
private fun BrowserCompatBannerSingleMissingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BrowserCompatBannerContent(
            surface = BrowserCompatSurface.Active(listOf(RequiredCapability.GooglePlayServices)),
            onDismiss = {},
        )
    }
}
