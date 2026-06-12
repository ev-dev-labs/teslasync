// The native Jetpack Compose + Material 3 DriveTimeline feature view — a parity port of
// web/src/features/driving/components/drive-detail/DriveTimeline.tsx. The web component is one section of the
// drive-detail page: a translucent panel carrying a three-up legend row — the green-flagged start time, the
// muted total duration, and the red-flagged end time (or the localized "In progress" copy while the drive is
// live) — above a pill-shaped track filled by an emerald→cyan gradient.
//
// The surface binds no data hook of its own (web parity): the drive-detail page owns the drive query and
// passes the `drive` down. Its only web hook, `useTranslation`, maps to the generated i18n catalog (P1/S10);
// the start/end times come from `formatTime`, whose browser locale/timezone maps to the [Locale]/[ZoneId]
// resolved here from the device. As in the sibling DriveHighlightSlide / EventTimeline ports, the
// cache-then-network lifecycle (loading / error / stale / offline) lives on the owning page, not here; the one
// branch the web source defines — finished (an end time) versus in-progress (the "In progress" copy) — is the
// complete state set this surface renders, and both are reproduced below. Every derivation flows through the
// pure [DriveTimelineProjection]; the composable is a thin render layer.
//
// Color mapping (P1/S9 tokens, no ported Tailwind): web `text-green-400` (start) → the semantic
// `TeslaTokens.status.success`, `text-red-400` (end) → `status.danger`, `--text-muted` (duration) →
// `onSurfaceVariant` at [MUTED_ALPHA]. The track's `--surface-2` → `surfaceVariant`; the `from-emerald-500
// to-cyan-400` fill → a horizontal gradient from `status.success` to the brand `primary`, so the bar reads as
// emerald→cyan in light and dark themes. The two flag markers reuse the local [DriveTimelineGlyphs.Flag]
// lucide port at the web's `h-3 w-3` size ([IconSize.Xs]).
//
// Motion honors the reduced-motion preference (P1/S9) via the shared [FadeIn], which collapses the web
// `<FadeIn>` entrance to a static, final-state render when the user (or the OS animator scale) asks for
// reduced motion. Accessibility: the decorative flags and gradient track are cleared from the semantics tree,
// and each legend cell is merged into one localized label (start / end / duration + its value) so TalkBack
// announces "Start, 2:30 PM" rather than a bare time. The one-shot `view.opened` diagnostic (P1/S11) is
// emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DriveTimeline) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivetimeline

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** Web `--text-muted`: the muted variant of the secondary text color used for the duration caption. */
private const val MUTED_ALPHA = 0.7f

/** Web `h-3` track height — the pill bar that carries the emerald→cyan gradient fill. */
private val BAR_HEIGHT: Dp = 12.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `DriveTimeline({ drive })` prop. Records the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition and renders. The surface performs
 * no HTTP; the drive-detail page supplies [drive].
 *
 * @param drive the drive to render its timeline for (web `drive` prop).
 * @param locale the locale used to format the start/end times (web `formatTime` browser locale).
 * @param zoneId the zone used to render the UTC timestamps as wall-clock time (web browser timezone).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveTimeline(
    drive: DriveTimelineDrive,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DriveTimelineDiagnostics.recordViewOpened(logger) }
    DriveTimelineContent(drive = drive, modifier = modifier, locale = locale, zoneId = zoneId)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Projects [drive] for the given
 * [locale]/[zoneId] and renders the web layout: the [FadeIn]-entering [GlassPanel] (web `p-4`) holding the
 * legend row above the gradient [DriveTimelineBar]. [locale]/[zoneId] default to the device settings for
 * cold-start and previews.
 */
@Composable
fun DriveTimelineContent(
    drive: DriveTimelineDrive,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
) {
    val display = remember(drive, locale, zoneId) { DriveTimelineProjection.project(drive, zoneId, locale) }
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            DriveTimelineLegend(display = display)
            DriveTimelineBar(modifier = Modifier.padding(top = Spacing.sm))
        }
    }
}

/**
 * The legend row (web `flex items-center justify-between`): the green-flagged start time, the muted duration,
 * and the red-flagged end time (or the localized "In progress" copy while the drive is live). Each cell is
 * merged into a single localized TalkBack label through [clearAndSetSemantics].
 */
@Composable
private fun DriveTimelineLegend(
    display: DriveTimelineDisplay,
    modifier: Modifier = Modifier,
) {
    val startLabel = stringResource(R.string.translation_driveDetail_start)
    val endLabel = stringResource(R.string.translation_driveDetail_end)
    val durationLabel = stringResource(R.string.translation_driveDetail_duration)
    val endText =
        if (display.inProgress) {
            stringResource(R.string.translation_driveDetail_inProgress)
        } else {
            display.endTime
        }
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DriveTimelineEndpoint(time = display.startTime, label = startLabel, tint = TeslaTokens.status.success)
        Text(
            text = display.duration,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = MUTED_ALPHA),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier =
                Modifier.clearAndSetSemantics {
                    contentDescription = "$durationLabel, ${display.duration}"
                },
        )
        DriveTimelineEndpoint(time = endText, label = endLabel, tint = TeslaTokens.status.danger)
    }
}

/**
 * One flagged endpoint (web `<span class="text-green-400|text-red-400"><Flag/>{time}</span>`): the small flag
 * marker and the time, both [tint]ed with the endpoint's semantic accent. The flag is decorative; the cell is
 * collapsed into a single localized label ("[label], [time]") for TalkBack.
 */
@Composable
private fun DriveTimelineEndpoint(
    time: String,
    label: String,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = "$label, $time" },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(imageVector = DriveTimelineGlyphs.Flag, contentDescription = null, size = IconSize.Xs, tint = tint)
        Text(text = time, style = MaterialTheme.typography.labelMedium, color = tint, maxLines = 1)
    }
}

/**
 * The progress track (web `h-3 rounded-full bg-[var(--surface-2)]` with a `w-full` emerald→cyan gradient
 * fill): a pill-clipped [surfaceVariant] box behind a full-width [Brush.horizontalGradient]. Purely
 * decorative, so it is cleared from the semantics tree.
 */
@Composable
private fun DriveTimelineBar(modifier: Modifier = Modifier) {
    val gradient =
        Brush.horizontalGradient(
            listOf(TeslaTokens.status.success, MaterialTheme.colorScheme.primary),
        )
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .height(BAR_HEIGHT)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .clearAndSetSemantics {},
    ) {
        Spacer(modifier = Modifier.fillMaxSize().clip(CircleShape).background(gradient))
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_FINISHED_DRIVE =
    DriveTimelineDrive(
        startTs = "2026-03-14T09:15:00Z",
        endTs = "2026-03-14T11:45:00Z",
        durationS = 9000,
    )

private val PREVIEW_SHORT_DRIVE =
    DriveTimelineDrive(
        startTs = "2026-03-14T18:05:00Z",
        endTs = "2026-03-14T18:30:00Z",
        durationS = 1500,
    )

private val PREVIEW_LIVE_DRIVE =
    DriveTimelineDrive(
        startTs = "2026-03-14T07:42:00Z",
        endTs = null,
        durationS = 720,
    )

@Preview(name = "Finished — hours", showBackground = true, widthDp = 360)
@Composable
private fun DriveTimelineFinishedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveTimelineContent(drive = PREVIEW_FINISHED_DRIVE, zoneId = ZoneId.of("UTC"))
    }
}

@Preview(name = "Finished — under an hour", showBackground = true, widthDp = 360)
@Composable
private fun DriveTimelineShortPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveTimelineContent(drive = PREVIEW_SHORT_DRIVE, zoneId = ZoneId.of("UTC"))
    }
}

@Preview(name = "In progress", showBackground = true, widthDp = 360)
@Composable
private fun DriveTimelineLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveTimelineContent(drive = PREVIEW_LIVE_DRIVE, zoneId = ZoneId.of("UTC"))
    }
}
