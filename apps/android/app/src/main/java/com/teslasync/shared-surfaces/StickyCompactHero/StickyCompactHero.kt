// Native Compose render layer for the StickyCompactHero shared surface — the parity port of the web bar
// (web/src/components/status/StickyCompactHero.tsx). It is a thin, stateless view over the pure
// [StickyCompactHeroProjection] and the [StickyCompactHeroViewModel]'s status [UiState] feed: it owns no business
// logic, performs no HTTP or persistence, and renders every phase the prompt's state matrix mandates — loading
// (a pulsing status pill), content (the five-status bar: glyph + tone headline + last-checked + up-arrow), empty
// (the friendly "status unknown" face instead of a blank box), a hard error (a compact warning + the refresh as
// retry), and the stale/offline freshness envelope (a chip + the spinning re-check). The whole bar slides in only
// while [visible] — the native analogue of the web IntersectionObserver that mounts the bar once the full hero
// scrolls out of view (web `if (!visible) return null`); tapping the summary returns to the top (web
// `handleScrollTop`).
//
// The five status glyphs reuse the shared icon sets (TeslaGlyphs.Check/Warning/Octagon/Help + FeedbackGlyphs
// .Wrench), the up-arrow reuses DataDisplayGlyphs.ArrowUp, and the refresh control reuses FeedbackGlyphs.Refresh —
// never re-authored. Every string resolves through the P1/S10 catalog (no English literals), and motion honours
// the reduced-motion preference.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StickyCompactHero) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickycompacthero

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered bar in any state. */
const val STICKY_COMPACT_HERO_TEST_TAG: String = "sticky-compact-hero"

/** Test tag on the tappable status summary (web `handleScrollTop` button). */
const val STICKY_COMPACT_HERO_SUMMARY_TAG: String = "sticky-compact-hero-summary"

/** Test tag on the refresh control (web `onRefresh` button). */
const val STICKY_COMPACT_HERO_REFRESH_TAG: String = "sticky-compact-hero-refresh"

private val BAR_ELEVATION: Dp = 2.dp
private val DIVIDER_HEIGHT: Dp = 1.dp
private const val TRANSITION_MS: Int = 180
private const val SPIN_DURATION_MS: Int = 900
private const val FULL_ROTATION: Float = 360f
private const val PREVIEW_STAMP: Long = 1_700_000_000_000L

/**
 * Stateful entry point — the parity port of the web `<StickyCompactHero/>`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, collects the status [UiState], and renders the collapsed-on-scroll
 * bar. [visible] is the host-computed scroll gate (the web IntersectionObserver: the bar shows only once the full
 * hero has scrolled out of view), [lastCheckedLabel] is the host-formatted relative stamp (web `lastCheckedLabel`
 * prop), and [onScrollToTop] returns the host's scroll position to the top (web `handleScrollTop`).
 *
 * @param viewModel the state holder bound to the host's status feed.
 * @param visible whether the full hero has scrolled out of view (web IntersectionObserver result).
 * @param lastCheckedLabel the host-formatted "last checked" relative label (web `lastCheckedLabel`), or `null`.
 * @param onScrollToTop scrolls the host content back to the top (web `window.scrollTo`).
 */
@Composable
fun StickyCompactHero(
    viewModel: StickyCompactHeroViewModel,
    modifier: Modifier = Modifier,
    visible: Boolean = true,
    lastCheckedLabel: String? = null,
    onScrollToTop: () -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val strings = rememberStickyCompactHeroStrings()
    val state by viewModel.state.collectAsStateWithLifecycle()

    StickyCompactHeroChrome(
        state = state,
        strings = strings,
        modifier = modifier,
        visible = visible,
        lastCheckedLabel = lastCheckedLabel,
        onScrollToTop = onScrollToTop,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless bar chrome — renders the surface in every phase the bound status feed reports, gated behind the
 * [visible] scroll collapse. Hoisted out of the ViewModel so it is preview- and screenshot-testable for each
 * state. The root carries the `role="region"` + `aria-live="polite"` landmark (web parity) so screen readers
 * announce notable transitions (offline ↔ online) without interrupting other reading flow.
 */
@Composable
fun StickyCompactHeroChrome(
    state: UiState<HeroStatus>,
    strings: StickyCompactHeroStrings,
    modifier: Modifier = Modifier,
    visible: Boolean = true,
    lastCheckedLabel: String? = null,
    onScrollToTop: () -> Unit = {},
    onRefresh: () -> Unit = {},
) {
    val reduceMotion = rememberReducedMotion()
    val durationMs = if (reduceMotion) 0 else TRANSITION_MS

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(durationMs)) + slideInVertically(tween(durationMs)) { -it },
        exit = fadeOut(tween(durationMs)) + slideOutVertically(tween(durationMs)) { -it },
    ) {
        Surface(
            modifier =
                modifier
                    .fillMaxWidth()
                    .testTag(STICKY_COMPACT_HERO_TEST_TAG)
                    .semantics {
                        liveRegion = LiveRegionMode.Polite
                        contentDescription = strings.regionLabel
                    },
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            tonalElevation = BAR_ELEVATION,
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = Spacing.lg, vertical = Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    StickyCompactHeroSummary(
                        state = state,
                        strings = strings,
                        lastCheckedLabel = lastCheckedLabel,
                        onScrollToTop = onScrollToTop,
                    )
                    StickyCompactHeroRefresh(
                        state = state,
                        strings = strings,
                        reduceMotion = reduceMotion,
                        onRefresh = onRefresh,
                    )
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(DIVIDER_HEIGHT)
                        .background(MaterialTheme.colorScheme.outlineVariant),
                )
            }
        }
    }
}

/**
 * The tappable status summary — the web `handleScrollTop` button. It carries the click action + [Role.Button] so
 * TalkBack announces it as actionable, with the localized status headline (or the loading/error caption) as its
 * spoken label, and shows the leading freshness chip when the status is stale/offline.
 */
@Composable
private fun RowScope.StickyCompactHeroSummary(
    state: UiState<HeroStatus>,
    strings: StickyCompactHeroStrings,
    lastCheckedLabel: String?,
    onScrollToTop: () -> Unit,
) {
    val status = StickyCompactHeroProjection.statusOf(state)
    val freshness = StickyCompactHeroProjection.freshness(state)
    val showChip = freshness != StickyCompactHeroFreshness.Live && state.phase != UiPhase.Loading

    Row(
        modifier =
            Modifier
                .weight(1f)
                .testTag(STICKY_COMPACT_HERO_SUMMARY_TAG)
                .clip(RoundedCornerShape(Radius.sm))
                .clickable(role = Role.Button, onClick = onScrollToTop)
                .padding(vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (showChip) {
            StickyCompactHeroFreshnessChip(freshness, strings)
        }
        when (state.phase) {
            UiPhase.Loading -> StatusPill(text = strings.loading, tone = StatusTone.Neutral, pulse = true)
            UiPhase.Error -> {
                Icon(
                    imageVector = TeslaGlyphs.Warning,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.error,
                )
                Caption(strings.errorMessage)
            }
            UiPhase.Content, UiPhase.Empty -> {
                val tone = heroToneColor(StickyCompactHeroProjection.tone(status))
                Icon(
                    imageVector = statusGlyph(status),
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = tone,
                )
                Heading(
                    text = strings.headline(status),
                    level = HeadingLevel.Sub,
                    color = tone,
                    maxLines = 1,
                )
                if (!lastCheckedLabel.isNullOrBlank()) {
                    Caption("· $lastCheckedLabel")
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Icon(
            imageVector = DataDisplayGlyphs.ArrowUp,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The refresh control — the web `onRefresh` button. It spins while a re-check is in flight (web
 * `refreshing && 'animate-spin'`, honoring reduced motion), disables itself during the refresh, and doubles as
 * the retry affordance on the error surface. The icon carries the localized [StickyCompactHeroStrings.refresh]
 * label so TalkBack announces it.
 */
@Composable
private fun StickyCompactHeroRefresh(
    state: UiState<HeroStatus>,
    strings: StickyCompactHeroStrings,
    reduceMotion: Boolean,
    onRefresh: () -> Unit,
) {
    val spinning = state.refreshing && !reduceMotion
    val angle =
        if (spinning) {
            val transition = rememberInfiniteTransition(label = "sticky-refresh")
            transition
                .animateFloat(
                    initialValue = 0f,
                    targetValue = FULL_ROTATION,
                    animationSpec = infiniteRepeatable(tween(SPIN_DURATION_MS, easing = LinearEasing), RepeatMode.Restart),
                    label = "sticky-refresh-angle",
                ).value
        } else {
            0f
        }

    Button(
        onClick = onRefresh,
        modifier = Modifier.testTag(STICKY_COMPACT_HERO_REFRESH_TAG),
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        enabled = !state.refreshing,
    ) {
        Icon(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refresh,
            size = IconSize.Sm,
            modifier = Modifier.rotate(angle),
        )
    }
}

/** The leading freshness chip the bar shows when its status is stale or served offline/last-known. */
@Composable
private fun StickyCompactHeroFreshnessChip(
    freshness: StickyCompactHeroFreshness,
    strings: StickyCompactHeroStrings,
) {
    when (freshness) {
        StickyCompactHeroFreshness.Offline -> StatusPill(text = strings.offline, tone = StatusTone.Danger)
        StickyCompactHeroFreshness.Stale -> StatusPill(text = strings.stale, tone = StatusTone.Warning, pulse = true)
        StickyCompactHeroFreshness.Live -> Unit
    }
}

/** The shared glyph for [status] — the native port of the web `ICON_FOR_STATUS` map, reusing the shared sets. */
private fun statusGlyph(status: HeroStatus): ImageVector =
    when (status) {
        HeroStatus.Healthy -> TeslaGlyphs.Check
        HeroStatus.Degraded -> TeslaGlyphs.Warning
        HeroStatus.Unhealthy -> TeslaGlyphs.Octagon
        HeroStatus.Unknown -> TeslaGlyphs.Help
        HeroStatus.Maintenance -> FeedbackGlyphs.Wrench
    }

/** Resolves a [StatusTone] to its theme color — the render-boundary mapping of the web `TEXT_FOR_STATUS` tones. */
@Composable
private fun heroToneColor(tone: StatusTone): Color =
    when (tone) {
        StatusTone.Success -> TeslaTokens.status.success
        StatusTone.Warning -> TeslaTokens.status.warning
        StatusTone.Danger -> TeslaTokens.status.danger
        StatusTone.Info -> TeslaTokens.status.info
        StatusTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberStickyCompactHeroStrings(): StickyCompactHeroStrings =
    StickyCompactHeroStrings(
        regionLabel = stringResource(R.string.translation_Status),
        healthy = stringResource(R.string.translation_Healthy),
        degraded = stringResource(R.string.translation_Degraded),
        unhealthy = stringResource(R.string.translation_Unhealthy),
        unknown = stringResource(R.string.translation_Unknown),
        maintenance = stringResource(R.string.translation_Maintenance),
        refresh = stringResource(R.string.translation_common_refresh),
        loading = stringResource(R.string.translation_a11y_loading),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_error_network_offlineTitle),
        retry = stringResource(R.string.translation_common_retry),
        errorMessage = stringResource(R.string.translation_error_loadFailed),
    )

// ── Previews — one per rendered state (loading / each status / empty / error / stale / offline). ──

private fun previewStrings(): StickyCompactHeroStrings =
    StickyCompactHeroStrings(
        regionLabel = "Status",
        healthy = "Healthy",
        degraded = "Degraded",
        unhealthy = "Unhealthy",
        unknown = "Unknown",
        maintenance = "Maintenance",
        refresh = "Refresh",
        loading = "Loading",
        stale = "Stale",
        offline = "You're offline",
        retry = "Retry",
        errorMessage = "Failed to load data",
    )

private fun content(status: HeroStatus): UiState<HeroStatus> = UiState(UiPhase.Content, data = status, fetchedAt = PREVIEW_STAMP)

@Composable
private fun PreviewBar(
    state: UiState<HeroStatus>,
    lastCheckedLabel: String? = "12s ago",
) {
    TeslaSyncTheme(dynamicColor = false) {
        StickyCompactHeroChrome(state = state, strings = previewStrings(), lastCheckedLabel = lastCheckedLabel)
    }
}

@Preview(name = "StickyCompactHero · loading", showBackground = true, widthDp = 420, heightDp = 56)
@Composable
private fun StickyCompactHeroLoadingPreview() = PreviewBar(state = UiState.loading(), lastCheckedLabel = null)

@Preview(name = "StickyCompactHero · healthy", showBackground = true, widthDp = 420, heightDp = 56)
@Composable
private fun StickyCompactHeroHealthyPreview() = PreviewBar(state = content(HeroStatus.Healthy))

@Preview(name = "StickyCompactHero · degraded", showBackground = true, widthDp = 420, heightDp = 56)
@Composable
private fun StickyCompactHeroDegradedPreview() = PreviewBar(state = content(HeroStatus.Degraded))

@Preview(name = "StickyCompactHero · unhealthy", showBackground = true, widthDp = 420, heightDp = 56)
@Composable
private fun StickyCompactHeroUnhealthyPreview() = PreviewBar(state = content(HeroStatus.Unhealthy))

@Preview(name = "StickyCompactHero · maintenance", showBackground = true, widthDp = 420, heightDp = 56)
@Composable
private fun StickyCompactHeroMaintenancePreview() = PreviewBar(state = content(HeroStatus.Maintenance))

@Preview(name = "StickyCompactHero · empty", showBackground = true, widthDp = 420, heightDp = 56)
@Composable
private fun StickyCompactHeroEmptyPreview() =
    PreviewBar(state = UiState(UiPhase.Empty, data = HeroStatus.Unknown, fetchedAt = PREVIEW_STAMP), lastCheckedLabel = null)

@Preview(name = "StickyCompactHero · error", showBackground = true, widthDp = 420, heightDp = 56)
@Composable
private fun StickyCompactHeroErrorPreview() = PreviewBar(state = UiState(UiPhase.Error, errorKind = ErrorKind.Unknown))

@Preview(name = "StickyCompactHero · stale", showBackground = true, widthDp = 420, heightDp = 56)
@Composable
private fun StickyCompactHeroStalePreview() =
    PreviewBar(
        state = UiState(UiPhase.Content, data = HeroStatus.Healthy, fetchedAt = PREVIEW_STAMP, stale = true, refreshing = true),
    )

@Preview(name = "StickyCompactHero · offline", showBackground = true, widthDp = 420, heightDp = 56)
@Composable
private fun StickyCompactHeroOfflinePreview() =
    PreviewBar(
        state =
            UiState(
                UiPhase.Content,
                data = HeroStatus.Degraded,
                fetchedAt = PREVIEW_STAMP,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
    )
