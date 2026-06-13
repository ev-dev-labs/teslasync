// The native Jetpack Compose + Material 3 TeslaReauthBanner shared surface — a parity port of
// web/src/components/feedback/TeslaReauthBanner.tsx. The web file is a sticky, non-blocking banner recovering the
// Tesla third-party OAuth grant: while the grant is down it shows a warning row with an AlertTriangle, the title
// `tesla.reauth.title` ("Tesla account disconnected"), the body `tesla.reauth.body` ("Reconnect to resume live data
// and commands."), a primary `tesla.reauth.cta` ("Reconnect") that deep-links to `/tesla-account`, and an X dismiss
// labelled `common.dismiss`; it is `role="alert"` / `aria-live="assertive"` and renders nothing when hidden
// (`if (!visible) return null`).
//
// This surface is the native equivalent. All signals flow through the shared [TeslaReauthBannerViewModel] over the
// [TeslaReauthBannerSource] seam (P1/S8) — the view performs NO HTTP and opens no stream directly. Visibility is the
// pure [TeslaReauthBannerProjection]; the composable is a thin render layer over the shared [AlertBanner] (warning
// tone → the web amber, its default warning glyph → the web AlertTriangle). The banner is an assertive live region
// (web `role="alert"` / `aria-live="assertive"`), so TalkBack announces it immediately; the Reconnect CTA and the X
// dismiss each carry their own label. Reconnect navigation is the host's concern (web `useNavigate`, wired through
// [onReconnect] exactly as the sibling `TeslaAuthCard` wires `onManage`), since no `LocalNavController` is exposed.
// The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless renderer +
// previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.teslareauthbanner

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
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the reauth-banner region — the native mirror of the web `data-testid="tesla-reauth-banner"`. */
const val TESLA_REAUTH_BANNER_TEST_TAG: String = "tesla-reauth-banner"

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary (tests
 * pass a deterministic instance), keeping the projection a pure, locale-stable function. Every string resolves
 * through the P1/S10 catalog.
 *
 * @property title the web `tesla.reauth.title` ("Tesla account disconnected").
 * @property body the web `tesla.reauth.body` ("Reconnect to resume live data and commands.").
 * @property cta the web `tesla.reauth.cta` ("Reconnect") — the primary reconnect affordance.
 * @property dismiss the web `common.dismiss` ("Dismiss") — the X button's accessibility label.
 */
data class TeslaReauthBannerStrings(
    val title: String,
    val body: String,
    val cta: String,
    val dismiss: String,
)

/**
 * Stateful entry point bound to the app-scoped Tesla-grant signal bus — the faithful port of the web
 * `TeslaReauthBanner`. Binds the [TeslaReauthBannerViewModel], records the one-shot `view.opened` diagnostic
 * (P1/S11), collects the [visible][TeslaReauthBannerViewModel.visible] flag, projects it into the render the
 * stateless surface paints, and wires the banner's reconnect + dismiss to the holder.
 *
 * @param modifier optional layout modifier for the banner.
 * @param source the grant-signal seam; defaults to the process-global [TeslaReauthBus] adapter.
 * @param onReconnect opens the Tesla account screen — wired by the host to navigation (web `navigate('/tesla-account')`).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun TeslaReauthBanner(
    modifier: Modifier = Modifier,
    source: TeslaReauthBannerSource = TeslaReauthBus.global.asTeslaReauthBannerSource(),
    onReconnect: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: TeslaReauthBannerViewModel =
        viewModel(
            key = TeslaReauthBannerRegistration.ID,
            factory = TeslaReauthBannerViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val visible by viewModel.visible.collectAsStateWithLifecycle()
    val render = remember(visible) { TeslaReauthBannerProjection.render(visible) }

    TeslaReauthBannerContent(
        render = render,
        strings = rememberTeslaReauthBannerStrings(),
        modifier = modifier,
        onReconnect = {
            viewModel.reconnect()
            onReconnect()
        },
        onDismiss = viewModel::dismiss,
    )
}

/**
 * Stateless surface — the unit/UI-test and preview entry point. Renders the warning banner whenever the grant is
 * down ([TeslaReauthRender.showBanner]) and nothing at all otherwise — the faithful port of the web
 * `if (!visible) return null`, contributing zero layout rather than a blank box. The banner uses the web-verbatim
 * title/body, a primary reconnect CTA, and an X dismiss labelled for accessibility; the whole row is an assertive
 * live region (web `role="alert"` / `aria-live="assertive"`).
 */
@Composable
fun TeslaReauthBannerContent(
    render: TeslaReauthRender,
    strings: TeslaReauthBannerStrings,
    modifier: Modifier = Modifier,
    onReconnect: () -> Unit = {},
    onDismiss: () -> Unit = {},
) {
    if (!render.showBanner) return

    FadeIn(modifier = modifier) {
        AlertBanner(
            message = strings.body,
            modifier =
                Modifier
                    .testTag(TESLA_REAUTH_BANNER_TEST_TAG)
                    .semantics { liveRegion = LiveRegionMode.Assertive },
            tone = Tone.Warning,
            title = strings.title,
            action = BannerAction(label = strings.cta, onClick = onReconnect),
            onClose = onDismiss,
            closeLabel = strings.dismiss,
        )
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberTeslaReauthBannerStrings(): TeslaReauthBannerStrings =
    TeslaReauthBannerStrings(
        title = stringResource(R.string.translation_tesla_reauth_title),
        body = stringResource(R.string.translation_tesla_reauth_body),
        cta = stringResource(R.string.translation_tesla_reauth_cta),
        dismiss = stringResource(R.string.translation_common_dismiss),
    )

// ── Preview — the single visible state (grant down). The dormant phase is hidden (renders nothing, faithful to the
// web `if (!visible) return null`), so it has no preview. Strings resolve through the P1/S10 catalog (no hardcoded
// English), and reduced motion keeps the entry animation from holding the preview clock. ──

@Preview(name = "TeslaReauthBanner · expired (visible)", showBackground = true)
@Composable
private fun TeslaReauthBannerExpiredPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            TeslaReauthBannerContent(
                render = TeslaReauthRender.Visible,
                strings = rememberTeslaReauthBannerStrings(),
            )
        }
    }
}
