// The native Jetpack Compose + Material 3 OfflineBanner shared surface — a parity port of
// web/src/components/feedback/OfflineBanner.tsx. The web file is a small, non-blocking PWA notice: while the
// browser reports no network (`useOnlineStatus()` === false) it renders a warning `AlertBanner` with a WifiOff
// icon, the title `pwa.offline.title` ("You're offline") and the body `pwa.offline.banner` ("Showing cached
// data. New requests will retry when you reconnect."), `role="status"` / `aria-live="polite"`; when online it
// renders nothing (`if (online) return null`) and hides itself automatically when connectivity returns.
//
// This surface is the native equivalent. All data flows through the shared [OfflineBannerViewModel] over the
// [OfflineBannerSource] seam (P1/S8) — the view performs NO HTTP and opens no stream directly. Every derivation
// flows through the pure [OfflineBannerProjection]; the composable is a thin render layer. The faithful mapping
// of the web behaviour onto the wired live pipeline (ADR-009, see [OfflineBannerModel] for the rationale): a down
// wire → the web's offline branch (verbatim `pwa.offline.*` copy + reconnect); a reconnecting wire → honest
// "Reconnecting…" copy + the same cached-data body; an up / cold-start wire → dormant (the web `if (online)
// return null`). The banner is a polite live region (web `role="status"` / `aria-live="polite"`), so TalkBack
// announces it when connectivity drops, and the reconnect control carries its own label. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless
// renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.offlinebanner

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the offline-banner region — the native mirror of the web `data-testid="offline-banner"`. */
const val OFFLINE_BANNER_TEST_TAG: String = "offline-banner"

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the projection a pure, locale-stable function. Every string
 * resolves through the P1/S10 catalog.
 *
 * @property offlineTitle the web `pwa.offline.title` ("You're offline") — the hard-offline heading.
 * @property reconnectingTitle the honest "Reconnecting…" heading for an impaired-but-recovering live link.
 * @property body the web `pwa.offline.banner` ("Showing cached data. New requests will retry when you reconnect.").
 * @property reconnect the reconnect affordance label ("Retry when online").
 */
data class OfflineBannerStrings(
    val offlineTitle: String,
    val reconnectingTitle: String,
    val body: String,
    val reconnect: String,
)

/**
 * Stateful entry point bound to the app-scoped live pipeline — the faithful port of the web `OfflineBanner`.
 * Binds the [OfflineBannerViewModel], records the one-shot `view.opened` diagnostic (P1/S11), collects the live
 * wire-health snapshot, projects it into the render the stateless surface paints, and wires the banner's
 * reconnect to the live layer.
 *
 * @param modifier optional layout modifier for the banner.
 * @param source the live wire-health seam; defaults to the app-scoped live session store ([asOfflineBannerSource]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun OfflineBanner(
    modifier: Modifier = Modifier,
    source: OfflineBannerSource = LocalDataContainer.current.liveSessionStore.asOfflineBannerSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: OfflineBannerViewModel =
        viewModel(
            key = OfflineBannerRegistration.ID,
            factory = OfflineBannerViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val render = remember(snapshot) { OfflineBannerProjection.render(snapshot) }

    OfflineBannerContent(
        render = render,
        strings = rememberOfflineBannerStrings(),
        modifier = modifier,
        onReconnect = viewModel::reconnect,
    )
}

/**
 * Stateless surface — the unit/UI-test and preview entry point. Renders the warning banner whenever the live wire
 * is impaired ([OfflineBannerRender.showBanner]) and nothing at all when online — the faithful port of the web
 * `if (online) return null`, contributing zero layout rather than a blank box. The offline phase uses the
 * web-verbatim "You're offline" heading; the reconnecting phase uses an honest "Reconnecting…" heading; both
 * share the cached-data body, a WifiOff icon, and a reconnect affordance. The whole banner is a polite live
 * region (web `role="status"` / `aria-live="polite"`).
 */
@Composable
fun OfflineBannerContent(
    render: OfflineBannerRender,
    strings: OfflineBannerStrings,
    modifier: Modifier = Modifier,
    onReconnect: () -> Unit = {},
) {
    if (!render.showBanner) return

    val title = if (render.offline) strings.offlineTitle else strings.reconnectingTitle
    FadeIn(modifier = modifier) {
        AlertBanner(
            message = strings.body,
            modifier =
                Modifier
                    .testTag(OFFLINE_BANNER_TEST_TAG)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            tone = Tone.Warning,
            title = title,
            icon = FeedbackGlyphs.WifiOff,
            action = BannerAction(label = strings.reconnect, onClick = onReconnect),
        )
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberOfflineBannerStrings(): OfflineBannerStrings =
    OfflineBannerStrings(
        offlineTitle = stringResource(R.string.translation_pwa_offline_title),
        reconnectingTitle = stringResource(R.string.translation_live_reconnecting),
        body = stringResource(R.string.translation_pwa_offline_banner),
        reconnect = stringResource(R.string.translation_error_network_retryWhenOnline),
    )

// ── Previews — one per visible state (offline / reconnecting). The online phase is dormant (renders nothing,
// faithful to the web `if (online) return null`), so it has no preview. Strings resolve through the P1/S10
// catalog (no hardcoded English), and reduced motion keeps the entry animation from holding the preview clock. ──

private fun previewRender(status: LiveConnectionStatus): OfflineBannerRender = OfflineBannerProjection.render(OfflineBannerSnapshot(status))

@Composable
private fun PreviewSurface(render: OfflineBannerRender) {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            OfflineBannerContent(render = render, strings = rememberOfflineBannerStrings())
        }
    }
}

@Preview(name = "OfflineBanner · offline (down)", showBackground = true)
@Composable
private fun OfflineBannerOfflinePreview() {
    PreviewSurface(previewRender(LiveConnectionStatus.Disconnected))
}

@Preview(name = "OfflineBanner · reconnecting", showBackground = true)
@Composable
private fun OfflineBannerReconnectingPreview() {
    PreviewSurface(previewRender(LiveConnectionStatus.Reconnecting))
}
