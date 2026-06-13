// The native Jetpack Compose + Material 3 LiveStaleDataBanner shared surface — a parity port of
// web/src/components/feedback/LiveStaleDataBanner.tsx. The web component is a page-level companion to
// <LiveIndicator>: it reads `useLiveConnection` and shows an in-flow <AlertBanner variant="warning"> (a WifiOff
// icon, the "Live data unavailable" title, and a "values may be stale" body) ONLY once the live wire has been
// `disconnected` continuously for more than two minutes; otherwise it renders nothing (`if (!show) return null`).
//
// This surface is the native equivalent. All data flows through the shared [LiveStaleDataBannerViewModel] over the
// [LiveStaleDataBannerSource] seam (P1/S8) — the view performs NO HTTP and opens no stream directly. Every
// derivation flows through the pure [LiveStaleDataBannerProjection]; the composable is a thin render layer. The
// faithful mapping of the web behaviour:
//   • `useLiveConnection().status` → the injected [source], folded by the ViewModel into [StaleBannerState]
//     (the web `disconnectedSinceRef` becomes [StaleBannerState.disconnectedSinceMillis]).
//   • the web `setTimeout(setShow, threshold - elapsed)` → the [produceState] tick that re-reads the clock at the
//     two-minute boundary so the banner promotes from hidden to visible without any further wire event.
//   • the web `if (!show) return null` → [LiveStaleDataBannerContent] emitting nothing while hidden.
//   • the web `<AlertBanner variant="warning" icon={<WifiOff/>} title={t('live.staleBanner.title')}>` → the native
//     [AlertBanner] with [Tone.Warning], [FeedbackGlyphs.WifiOff], and the `translation_live_staleBanner_*` i18n
//     keys (P1/S10), reusing the shared feedback AlertBanner exactly as the web composes its AlertBanner.
//   • the dynamically-appearing outage warning is exposed to TalkBack as one polite live region carrying the
//     title + body, so a screen-reader user is told once, politely, when the wire goes away.
//
// States reproduced (the COMPLETE set the web source has — see LiveStaleDataBannerModel.kt for the full rationale):
// hidden while connected / reconnecting / cold-start unknown / disconnected-within-the-window, and the single
// amber "Live data unavailable" banner once the wire has been disconnected past two minutes. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition. The banner is static (no animation), so the
// reduce-motion contract is honoured by construction.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/LiveStaleDataBanner) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + preview.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.livestaledatabanner

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

/** Test tag identifying the banner container — used by the instrumented per-state + a11y UI tests. */
const val LIVE_STALE_DATA_BANNER_TEST_TAG: String = "live-stale-data-banner"

/** A small slack added to the wait so the boundary tick lands just past the threshold (web `+ 50`). */
private const val SHOW_DELAY_EPSILON_MILLIS = 50L

/** The sentence separator joining the title + body into one TalkBack announcement. */
private const val ACCESSIBILITY_SENTENCE_SEPARATOR = ". "

/**
 * Stateful entry point bound to the app-scoped live pipeline — the faithful port of the web `LiveStaleDataBanner`
 * reading `useLiveConnection`. Binds the [LiveStaleDataBannerViewModel], records the one-shot `view.opened`
 * diagnostic (P1/S11), collects the folded wire-health state, and — while a disconnection is counting down —
 * schedules a single boundary tick so the banner appears the instant the two-minute window elapses (the web
 * `setTimeout`), then projects the state into the render the stateless banner paints.
 *
 * @param modifier optional layout modifier for the banner container.
 * @param source the live wire-health seam; defaults to the app-scoped live session store
 *   ([asLiveStaleDataBannerSource]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun LiveStaleDataBanner(
    modifier: Modifier = Modifier,
    source: LiveStaleDataBannerSource = LocalDataContainer.current.liveSessionStore.asLiveStaleDataBannerSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: LiveStaleDataBannerViewModel =
        viewModel(
            key = LiveStaleDataBannerRegistration.ID,
            factory = LiveStaleDataBannerViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    // While the wire is disconnected but still inside the window, wait out the remaining time and then re-read the
    // clock so the banner promotes from hidden to visible at the boundary — the native mirror of the web setTimeout.
    // Any non-disconnected status clears the stamp (since == null), so no tick is scheduled and the banner stays
    // hidden. Once shown, the producer completes and the banner stays until the wire recovers.
    val since = state.disconnectedSinceMillis
    val nowMillis by produceState(initialValue = System.currentTimeMillis(), since) {
        if (since == null) {
            value = System.currentTimeMillis()
            return@produceState
        }
        val remaining = STALE_BANNER_THRESHOLD_MILLIS - (System.currentTimeMillis() - since)
        if (remaining > 0L) {
            delay(remaining + SHOW_DELAY_EPSILON_MILLIS)
        }
        value = System.currentTimeMillis()
    }

    LiveStaleDataBannerContent(
        render = LiveStaleDataBannerProjection.render(state, nowMillis),
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the UI-test + preview entry point. Paints the warning banner from a fully resolved
 * [render]: when hidden it emits nothing (the web `return null`); when visible it draws the shared feedback
 * [AlertBanner] in [Tone.Warning] with the [FeedbackGlyphs.WifiOff] icon, the localized title, and the localized
 * "values may be stale" body. The whole banner is one polite-live-region accessibility node announcing the title +
 * body together, so the outage warning is read once when it appears (web `role`-free div, improved for a
 * dynamically-shown native status surface).
 */
@Composable
fun LiveStaleDataBannerContent(
    render: StaleBannerRender,
    modifier: Modifier = Modifier,
) {
    if (!render.visible) return

    val title = stringResource(R.string.translation_live_staleBanner_title)
    val message = stringResource(R.string.translation_live_staleBanner_message)
    val spokenLabel = title + ACCESSIBILITY_SENTENCE_SEPARATOR + message

    AlertBanner(
        message = message,
        modifier =
            modifier
                .testTag(LIVE_STALE_DATA_BANNER_TEST_TAG)
                .semantics(mergeDescendants = true) {
                    contentDescription = spokenLabel
                    liveRegion = LiveRegionMode.Polite
                },
        tone = Tone.Warning,
        title = title,
        icon = FeedbackGlyphs.WifiOff,
    )
}

// ── Preview (tooling-only) ─────────────────────────────────────────────────────────────────────────────────────

@Preview(name = "LiveStaleDataBanner — live data offline > 2 min", showBackground = true)
@Composable
private fun LiveStaleDataBannerVisiblePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveStaleDataBannerContent(render = StaleBannerRender(visible = true))
    }
}
