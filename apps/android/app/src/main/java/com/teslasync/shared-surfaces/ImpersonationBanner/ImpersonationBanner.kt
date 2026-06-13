// The native Jetpack Compose + Material 3 ImpersonationBanner shared surface — a parity port of
// web/src/components/feedback/ImpersonationBanner.tsx. The web component is a persistent, non-dismissible amber
// sticky bar shown whenever a valid impersonation cookie is active: a UserCheck glyph, "Impersonating
// {{target}}", a fixed body line, a live per-second countdown ("Expires in {{time}}" / "Session expired"), and
// an "End impersonation" / "Ending…" button disabled while the end mutation is pending. It renders nothing for
// every other state (web `null`).
//
// The native surface keeps that contract and performs NO HTTP. The host owns the shared P1/S8 state holder; the
// view collects the impersonation feed as a cache-then-network [UiState] (web `useImpersonationStatus`) plus the
// in-flight [ending] flag (web `useEndImpersonation`) from the [ImpersonationBannerViewModel] and renders the
// resolved surface. Because the feed carries the full lifecycle, this view also renders the loading / error /
// stale / offline chrome the layer implies (the sibling UserImpersonateButton folds the same states); the two
// "nothing to announce" states the web renders as `null` (Inactive + Open mode) collapse to the explicit,
// unit-tested Hidden surface. There is no native AlertBanner content-slot rich enough for the separate countdown
// line + trailing End button, so the bar chrome is composed here from the shared atoms (the feedback Tone
// palette + glyph, Button, StatusPill, BodyText/Caption) — the same approach the sibling AiLimitBanner takes.
// Every string resolves through the i18n catalog (P1/S10); the bar carries a merged TalkBack announcement and is
// a polite live region (the web `role="alert" aria-live="polite"`). The per-second countdown ticker (the web
// `useState` + `setInterval`, run only while active) and the one-shot `view.opened` diagnostic (P1/S11) are the
// only effects this composable owns.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ImpersonationBanner) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.impersonationbanner

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay

/** Web `border` on the bar — a 1 px hairline tinted to the warning severity. */
private val BANNER_BORDER_WIDTH: Dp = 1.dp

/** One countdown tick — the web `setInterval(…, 1000)` cadence. */
private const val TICK_INTERVAL_MS: Long = 1_000L

private val LOADING_ICON_SIZE: Dp = 20.dp
private val TITLE_SKELETON_HEIGHT: Dp = 12.dp
private val BODY_SKELETON_HEIGHT: Dp = 10.dp
private const val TITLE_SKELETON_FRACTION = 0.5f
private const val BODY_SKELETON_FRACTION = 0.8f

/**
 * Stateful entry point — the faithful port of the web `ImpersonationBanner`. Collects the
 * [ImpersonationBannerViewModel]'s impersonation feed + the in-flight end flag, records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11), drives the per-second countdown ticker (the web
 * `useState` + `setInterval`, run only while an active session has a parseable expiry), auto-refreshes a stale
 * cache, and renders the resolved surface. Performs no HTTP.
 *
 * @param viewModel the state holder bound to the shared S8 ImpersonationStore feed + end mutation.
 */
@Composable
fun ImpersonationBanner(
    viewModel: ImpersonationBannerViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val ending by viewModel.ending.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val expiryMillis =
        remember(state.data) {
            state.data
                ?.takeIf { it.mode == ImpersonationMode.Active }
                ?.expiresAt
                ?.let(ImpersonationBannerProjection::parseExpiryMillis)
        }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(expiryMillis) {
        if (expiryMillis == null) return@LaunchedEffect
        while (true) {
            now = System.currentTimeMillis()
            delay(TICK_INTERVAL_MS)
        }
    }

    // Stale (non-error) cache → auto-refresh, mirroring the ADR-013 freshness contract; keyed so it fires at
    // most once per distinct freshness transition, never in a loop.
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) viewModel.refresh()
    }

    ImpersonationBannerContent(
        state = state,
        ending = ending,
        nowMillis = now,
        modifier = modifier,
        onEnd = viewModel::endImpersonation,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Projects [state] +
 * [nowMillis] + [ending] into an [ImpersonationBannerModel] and renders the matching surface: nothing when
 * Hidden (web `null` — not impersonating), a skeleton bar while Loading, the active banner for Active, a
 * classified error with retry, and the active banner plus a stale/offline freshness chip for Stale/Offline.
 */
@Composable
fun ImpersonationBannerContent(
    state: UiState<ImpersonationBannerView>,
    ending: Boolean,
    nowMillis: Long,
    modifier: Modifier = Modifier,
    onEnd: () -> Unit = {},
    onRetry: () -> Unit = {},
    strings: ImpersonationBannerStrings = rememberImpersonationBannerStrings(),
) {
    val model = ImpersonationBannerProjection.project(state, nowMillis, ending)
    when (model.surface) {
        ImpersonationBannerSurface.Hidden -> Unit
        ImpersonationBannerSurface.Loading -> LoadingBar(strings = strings, modifier = modifier)
        ImpersonationBannerSurface.Error -> ErrorBar(strings = strings, onRetry = onRetry, modifier = modifier)
        ImpersonationBannerSurface.Active,
        ImpersonationBannerSurface.Stale,
        ImpersonationBannerSurface.Offline,
        -> ActiveBar(model = model, strings = strings, onEnd = onEnd, modifier = modifier)
    }
}

/**
 * The web active bar: a warning-tinted, bordered surface with the user glyph, the "Impersonating {{target}}"
 * title, the body, the optional countdown line, an optional stale/offline freshness chip, and the trailing
 * End button. The whole bar is a polite live region carrying a merged TalkBack announcement (web
 * `role="alert" aria-live="polite"`).
 */
@Composable
private fun ActiveBar(
    model: ImpersonationBannerModel,
    strings: ImpersonationBannerStrings,
    onEnd: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = toneColors(Tone.Warning)
    val title = strings.title(model.target)
    val countdown = countdownText(model.countdown, strings)
    val announcement = ImpersonationBannerProjection.accessibilityLabel(title, strings.body, countdown)

    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(ImpersonationBannerRegistration.BANNER_TEST_TAG)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = announcement
                },
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(BANNER_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(FeedbackGlyphs.Users, contentDescription = null, size = IconSize.Md, tint = colors.foreground)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(title, style = MaterialTheme.typography.titleSmall, color = colors.foreground)
                BodyText(strings.body)
                if (countdown != null) {
                    Caption(
                        countdown,
                        modifier = Modifier.testTag(ImpersonationBannerRegistration.COUNTDOWN_TEST_TAG),
                    )
                }
            }
            if (model.showFreshnessChip) {
                FreshnessChip(model = model, strings = strings)
            }
            EndButton(model = model, strings = strings, onEnd = onEnd)
        }
    }
}

/** The End button — web "End impersonation" / "Ending…", disabled + spinning while the mutation is pending. */
@Composable
private fun EndButton(
    model: ImpersonationBannerModel,
    strings: ImpersonationBannerStrings,
    onEnd: () -> Unit,
) {
    Button(
        label = if (model.ending) strings.ending else strings.end,
        onClick = onEnd,
        modifier = Modifier.testTag(ImpersonationBannerRegistration.END_BUTTON_TEST_TAG),
        variant = ButtonVariant.Outline,
        size = ButtonSize.Sm,
        enabled = !model.ending,
        loading = model.ending,
    )
}

/** Stale/offline freshness chip shown over a cached active session — never presents stale data as live. */
@Composable
private fun FreshnessChip(
    model: ImpersonationBannerModel,
    strings: ImpersonationBannerStrings,
) {
    val isOffline = model.surface == ImpersonationBannerSurface.Offline
    StatusPill(
        text = if (isOffline) strings.offlineLabel else strings.staleLabel,
        tone = if (isOffline) StatusTone.Danger else StatusTone.Warning,
    )
}

/** Loading chrome: a warning-tinted skeleton bar with an accessible "loading" label so the surface is never blank. */
@Composable
private fun LoadingBar(
    strings: ImpersonationBannerStrings,
    modifier: Modifier = Modifier,
) {
    val colors = toneColors(Tone.Warning)
    Surface(
        modifier = modifier.fillMaxWidth().testTag(ImpersonationBannerRegistration.BANNER_TEST_TAG),
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(BANNER_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(Spacing.md)
                    .clearAndSetSemantics { contentDescription = strings.loadingLabel },
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Skeleton(modifier = Modifier.size(LOADING_ICON_SIZE), rounded = true, height = LOADING_ICON_SIZE)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Skeleton(widthFraction = TITLE_SKELETON_FRACTION, height = TITLE_SKELETON_HEIGHT)
                Skeleton(widthFraction = BODY_SKELETON_FRACTION, height = BODY_SKELETON_HEIGHT)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent for a status load that failed. */
@Composable
private fun ErrorBar(
    strings: ImpersonationBannerStrings,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = modifier.fillMaxWidth().testTag(ImpersonationBannerRegistration.BANNER_TEST_TAG),
    )
}

/** Maps the resolved [BannerCountdown] to its localized line, or `null` when no countdown is shown (web parity). */
private fun countdownText(
    countdown: BannerCountdown,
    strings: ImpersonationBannerStrings,
): String? =
    when (countdown) {
        BannerCountdown.None -> null
        BannerCountdown.Expired -> strings.expired
        is BannerCountdown.Remaining -> strings.endsIn(countdown.timeText)
    }

/**
 * Builds the localized [ImpersonationBannerStrings] from the i18n catalog (P1/S10): the
 * `translation_impersonation_banner_*` keys the web component reads plus the shared lifecycle-chrome keys. The
 * interpolated title / countdown resolve through `Context.getString` so the `%1$s` argument is filled by the
 * catalog.
 */
@Composable
private fun rememberImpersonationBannerStrings(): ImpersonationBannerStrings {
    val context = LocalContext.current
    val body = stringResource(R.string.translation_impersonation_banner_body)
    val end = stringResource(R.string.translation_impersonation_banner_end)
    val ending = stringResource(R.string.translation_impersonation_banner_ending)
    val expired = stringResource(R.string.translation_impersonation_banner_expired)
    val loadingLabel = stringResource(R.string.translation_common_loading)
    val errorTitle = stringResource(R.string.translation_error_serverError_title)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retry = stringResource(R.string.translation_common_retry)
    val staleLabel = stringResource(R.string.translation_mqtt_stale)
    val offlineLabel = stringResource(R.string.translation_common_offline)
    return remember(
        context,
        body,
        end,
        ending,
        expired,
        loadingLabel,
        errorTitle,
        errorMessage,
        retry,
        staleLabel,
        offlineLabel,
    ) {
        ImpersonationBannerStrings(
            title = { target -> context.getString(R.string.translation_impersonation_banner_title, target) },
            body = body,
            end = end,
            ending = ending,
            endsIn = { time -> context.getString(R.string.translation_impersonation_banner_endsIn, time) },
            expired = expired,
            loadingLabel = loadingLabel,
            errorTitle = errorTitle,
            errorMessage = errorMessage,
            retry = retry,
            staleLabel = staleLabel,
            offlineLabel = offlineLabel,
        )
    }
}

// ── Previews — one per rendered state (active counting-down / active expired / active no-expiry / stale /
// offline / loading / error). The Hidden surface renders nothing and has no preview. ─────────────────────────

private const val PREVIEW_EXPIRES = "2026-01-01T00:05:25Z"
private const val PREVIEW_REMAINING_MS = 325_000L
private const val PREVIEW_PAST_MS = 5_000L

private fun previewStrings(): ImpersonationBannerStrings =
    ImpersonationBannerStrings(
        title = { target -> "Impersonating $target" },
        body = "You are viewing TeslaSync as another subject. End impersonation to restore your session.",
        end = "End impersonation",
        ending = "Ending\u2026",
        endsIn = { time -> "Expires in $time" },
        expired = "Session expired",
        loadingLabel = "Loading\u2026",
        errorTitle = "Server error",
        errorMessage = "Something went wrong on our end. Please try again.",
        retry = "Retry",
        staleLabel = "Stale",
        offlineLabel = "Offline",
    )

private fun previewActiveState(
    expiresAt: String = PREVIEW_EXPIRES,
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<ImpersonationBannerView> =
    UiState(
        phase = UiPhase.Content,
        data =
            ImpersonationBannerView(
                mode = ImpersonationMode.Active,
                target = "alice",
                originalAdmin = "admin",
                expiresAt = expiresAt,
            ),
        stale = stale,
        errorKind = errorKind,
        fetchedAt = 1_700_000_000_000L,
    )

private fun previewNow(offsetMs: Long): Long = (ImpersonationBannerProjection.parseExpiryMillis(PREVIEW_EXPIRES) ?: 0L) + offsetMs

@Preview(name = "ImpersonationBanner · active (counting down)", showBackground = true)
@Composable
private fun ActiveCountingDownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImpersonationBannerContent(
            state = previewActiveState(),
            ending = false,
            nowMillis = previewNow(-PREVIEW_REMAINING_MS),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ImpersonationBanner · active (ending)", showBackground = true)
@Composable
private fun ActiveEndingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImpersonationBannerContent(
            state = previewActiveState(),
            ending = true,
            nowMillis = previewNow(-PREVIEW_REMAINING_MS),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ImpersonationBanner · active (expired)", showBackground = true)
@Composable
private fun ActiveExpiredPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImpersonationBannerContent(
            state = previewActiveState(),
            ending = false,
            nowMillis = previewNow(PREVIEW_PAST_MS),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ImpersonationBanner · active (no expiry)", showBackground = true)
@Composable
private fun ActiveNoExpiryPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImpersonationBannerContent(
            state = previewActiveState(expiresAt = ""),
            ending = false,
            nowMillis = 0L,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ImpersonationBanner · stale", showBackground = true)
@Composable
private fun StalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImpersonationBannerContent(
            state = previewActiveState(stale = true),
            ending = false,
            nowMillis = previewNow(-PREVIEW_REMAINING_MS),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ImpersonationBanner · offline", showBackground = true)
@Composable
private fun OfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImpersonationBannerContent(
            state = previewActiveState(stale = true, errorKind = ErrorKind.Network),
            ending = false,
            nowMillis = previewNow(-PREVIEW_REMAINING_MS),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ImpersonationBanner · loading", showBackground = true)
@Composable
private fun LoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImpersonationBannerContent(
            state = UiState.loading(),
            ending = false,
            nowMillis = 0L,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ImpersonationBanner · error", showBackground = true)
@Composable
private fun ErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ImpersonationBannerContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
            ending = false,
            nowMillis = 0L,
            strings = previewStrings(),
        )
    }
}

private const val HTTP_SERVER_ERROR = 503
