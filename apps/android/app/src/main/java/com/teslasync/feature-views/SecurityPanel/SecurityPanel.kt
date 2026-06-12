// The native Jetpack Compose + Material 3 SecurityPanel feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx. The web component takes a
// `SecurityEvent` prop plus an optional `remoteStartEnabled` flag and renders a `GlassPanel` titled
// "Security" (shield icon) containing, when either is present, a Lock-status box (Lock/Unlock, green/amber)
// with a "Vehicle lock status" sub-label, a Sentry-mode chip (Active/Inactive), Doors + Windows values, a
// User-present row (Yes/No), an optional italic `detail` line, and an always-present Remote-Start row
// (Enabled/Disabled/—); when neither input is present it renders a friendly "No security data available"
// empty state. This native port keeps that exact composition and additionally surfaces the cache-then-network
// states the P3 contract mandates (loading / empty / error / stale / offline) by binding the shared
// latest-security feed (primary) + latest-vehicle-config feed (for `remote_start_enabled`) through a
// [SecurityPanelViewModel]: the title always renders, a skeleton covers the first load, a `QueryError`
// covers a hard failure with no cache, a freshness chip + auto-refresh covers stale/offline, and a no-data
// snapshot still renders the titled panel with the empty state (never a blank box). The view performs no
// HTTP. No unit conversion is involved (every field is a boolean/string). Every visible string resolves
// through the i18n catalog (P1/S10), and every reading carries a merged TalkBack description.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecurityPanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitypanel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The web `<FadeIn delay={0.18}>` entry stagger (50 ms), matching the sibling telemetry panels. */
private const val FADE_DELAY_MS: Int = 50

/** Status-chip wash + border alpha — the web `bg-{tone}/10 border-{tone}/30` translucency. */
private const val CHIP_WASH_ALPHA: Float = 0.12f
private const val CHIP_BORDER_ALPHA: Float = 0.28f

private val SKELETON_LOCK_HEIGHT: Dp = 56.dp
private val SKELETON_BAR_HEIGHT: Dp = 16.dp
private const val SKELETON_BAR_COUNT: Int = 5

private const val HTTP_NOT_FOUND: Int = 404
private const val HTTP_UNAUTHORIZED: Int = 401
private const val HTTP_FORBIDDEN: Int = 403
private const val HTTP_SERVER_ERROR_MIN: Int = 500
private const val HTTP_SERVER_ERROR_MAX: Int = 599

/**
 * Stateful entry point — the faithful 1:1 port of the web `SecurityPanel({ securityData, remoteStartEnabled })`.
 * Binds the shared latest-security + latest-config feeds via [source] into a [SecurityPanelViewModel], records
 * the one-shot `view.opened` diagnostic (P1/S11), resolves the localized [SecurityPanelStrings] (P1/S10), and
 * renders. A host supplies the selected [vehicleId] (the web props' source); a `null`/non-positive id falls
 * back to the first enrolled vehicle and, when none resolves, renders the empty state.
 */
@Composable
fun SecurityPanel(
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    source: SecurityPanelSource = LocalDataContainer.current.vehiclesStore.asSecurityPanelSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SECURITY_PANEL_SLUG,
) {
    val viewModel: SecurityPanelViewModel =
        viewModel(key = instanceKey, factory = SecurityPanelViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberSecurityPanelStrings()

    SecurityPanelContent(
        state = state,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10) — the `common.*` /
 * `telemetry.*` keys the web component reads via `t(...)`.
 */
@Composable
fun rememberSecurityPanelStrings(): SecurityPanelStrings =
    SecurityPanelStrings(
        title = stringResource(R.string.translation_common_security),
        locked = stringResource(R.string.translation_common_locked),
        unlocked = stringResource(R.string.translation_common_unlocked),
        lockStatus = stringResource(R.string.translation_telemetry_lockStatus),
        sentryMode = stringResource(R.string.translation_telemetry_sentryMode),
        active = stringResource(R.string.translation_common_active),
        inactive = stringResource(R.string.translation_common_inactive),
        doors = stringResource(R.string.translation_telemetry_doors),
        windows = stringResource(R.string.translation_telemetry_windows),
        closed = stringResource(R.string.translation_common_closed),
        userPresent = stringResource(R.string.translation_telemetry_userPresent),
        yes = stringResource(R.string.translation_common_yes),
        no = stringResource(R.string.translation_common_no),
        remoteStart = stringResource(R.string.translation_telemetry_remoteStart),
        enabled = stringResource(R.string.translation_common_enabled),
        disabled = stringResource(R.string.translation_common_disabled),
        noData = stringResource(R.string.translation_telemetry_noSecurityData),
    )

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The `GlassPanel` +
 * shield "Security" title always render; then the skeleton body while the first load is in flight, a
 * `QueryError` with retry on a hard failure with no cache, the full security body when a snapshot is present,
 * or the friendly empty state otherwise. A stale/offline cached snapshot keeps its body visible with a
 * freshness chip flagged and auto-refreshes. No surface is ever blank.
 */
@Composable
fun SecurityPanelContent(
    state: UiState<SecuritySnapshot>,
    strings: SecurityPanelStrings,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            SecurityHeader(title = strings.title, state = state)
            Spacer(modifier = Modifier.height(Spacing.lg))
            when {
                state.isLoading -> SecurityLoadingBody()
                state.isError && !state.hasData ->
                    QueryError(
                        kind = queryErrorKindOf(state),
                        resourceName = strings.snapshotLabel,
                        onRetry = onRefresh,
                        modifier = Modifier.fillMaxWidth(),
                    )

                else -> SecurityPanelLoaded(snapshot = state.data, strings = strings)
            }
        }
    }
}

/** The web header `<h3 className="section-title">` — shield glyph + title, plus a freshness chip after a fetch. */
@Composable
private fun SecurityHeader(
    title: String,
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Shield,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        SectionTitle(title, modifier = Modifier.semantics { heading() })
        Spacer(modifier = Modifier.weight(1f))
        if ((state.fetchedAt ?: 0L) > 0L || state.refreshing || state.hasError) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = rememberRelativeAgeFormatter(),
            )
        }
    }
}

/** The loaded branch: the full security body (web `hasData` truthy) or the friendly empty state. */
@Composable
private fun SecurityPanelLoaded(
    snapshot: SecuritySnapshot?,
    strings: SecurityPanelStrings,
    modifier: Modifier = Modifier,
) {
    val display = remember(snapshot, strings) { SecurityPanelProjection.project(snapshot, strings) }
    if (!display.hasData) {
        EmptyState(message = strings.noData, icon = DataDisplayGlyphs.Shield, modifier = modifier.fillMaxWidth())
        return
    }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (display.hasSecurity) {
            LockStatusRow(display = display)
            SentryRow(display = display, strings = strings)
            ValueRow(icon = SecurityGlyphs.DoorClosed, label = strings.doors, value = display.doorsValue)
            ValueRow(icon = null, label = strings.windows, value = display.windowsValue)
            ToneValueRow(
                icon = DataDisplayGlyphs.Person,
                label = strings.userPresent,
                valueText = display.userPresentText,
                valueTone = display.userPresentTone,
            )
            display.detail?.let { DetailText(it) }
        }
        ToneValueRow(
            icon = SecurityGlyphs.KeyRound,
            label = strings.remoteStart,
            valueText = display.remoteStartText,
            valueTone = display.remoteStartTone,
        )
    }
}

/** Web "Lock status" — a tinted icon box (Lock/Unlock) beside the bold colored status + a muted sub-label. */
@Composable
private fun LockStatusRow(
    display: SecurityPanelDisplay,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = "${display.lockText}, ${display.lockStatusLabel}"
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        IconBox(tone = iconBoxToneFor(display.lockTone), size = IconBoxSize.Lg) {
            Icon(
                imageVector = if (display.locked) DataDisplayGlyphs.Lock else SecurityGlyphs.Unlock,
                contentDescription = null,
                size = IconSize.Xl,
                tint = valueToneColor(display.lockTone),
            )
        }
        Column {
            Text(
                text = display.lockText,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = valueToneColor(display.lockTone),
            )
            Caption(display.lockStatusLabel)
        }
    }
}

/** Web "Sentry Mode" — an eye-iconed muted label on the left and a toned ShieldAlert chip on the right. */
@Composable
private fun SentryRow(
    display: SecurityPanelDisplay,
    strings: SecurityPanelStrings,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = "${strings.sentryMode}, ${display.sentryText}"
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        RowLabel(icon = SecurityGlyphs.Eye, label = strings.sentryMode)
        SentryChip(text = display.sentryText, tone = display.sentryTone)
    }
}

/** The Sentry pill — washed in its accent tone (red when active, muted otherwise) with a ShieldAlert glyph. */
@Composable
private fun SentryChip(
    text: String,
    tone: ValueTone,
) {
    val color = valueToneColor(tone)
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = color.copy(alpha = CHIP_WASH_ALPHA),
        contentColor = color,
        border = BorderStroke(1.dp, color.copy(alpha = CHIP_BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(imageVector = SecurityGlyphs.ShieldAlert, contentDescription = null, size = IconSize.Xs, tint = color)
            Text(text = text, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** A label/value reading row whose value is monospaced primary text — the web Doors / Windows lines. */
@Composable
private fun ValueRow(
    icon: ImageVector?,
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = "$label, $value" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        RowLabel(icon = icon, label = label)
        CodeText(value, modifier = Modifier.padding(start = Spacing.sm))
    }
}

/** A label/value reading row whose value is toned (green/muted) — the web User-present / Remote-start lines. */
@Composable
private fun ToneValueRow(
    icon: ImageVector?,
    label: String,
    valueText: String,
    valueTone: ValueTone,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = "$label, $valueText" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        RowLabel(icon = icon, label = label)
        Text(
            text = valueText,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            color = valueToneColor(valueTone),
            modifier = Modifier.padding(start = Spacing.sm),
        )
    }
}

/** A muted row label with an optional leading glyph — the web `<Icon/> {label}` left cells. */
@Composable
private fun RowLabel(
    icon: ImageVector?,
    label: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Caption(label)
    }
}

/** Web "detail" — an italic muted free-text line, shown only when the snapshot carries a non-empty detail. */
@Composable
private fun DetailText(
    detail: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = detail,
        modifier = modifier.fillMaxWidth(),
        style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** The first-load skeleton body — a lock-box block plus a few reading-row bars. */
@Composable
private fun SecurityLoadingBody(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = SKELETON_LOCK_HEIGHT, rounded = true)
        repeat(SKELETON_BAR_COUNT) {
            Skeleton(height = SKELETON_BAR_HEIGHT, rounded = true)
        }
    }
}

/** The theme color each [ValueTone] resolves to — the web green / amber / red / muted value styling. */
@Composable
private fun valueToneColor(tone: ValueTone): Color =
    when (tone) {
        ValueTone.Success -> TeslaTokens.status.success
        ValueTone.Warning -> TeslaTokens.status.warning
        ValueTone.Danger -> TeslaTokens.status.danger
        ValueTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Maps a value tone onto the [IconBox] ring tone for the lock-status container. */
private fun iconBoxToneFor(tone: ValueTone): IconBoxTone =
    when (tone) {
        ValueTone.Success -> IconBoxTone.Success
        ValueTone.Warning -> IconBoxTone.Warning
        ValueTone.Danger -> IconBoxTone.Danger
        ValueTone.Neutral -> IconBoxTone.Neutral
    }

/** Classify a [UiState] failure into the recovery copy the `QueryError` branch shows. */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Decode -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through
 * (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Local glyphs — the web `Unlock` / `ShieldAlert` / `Eye` / `DoorClosed` / `KeyRound` (lucide). The
// data-display layer ships `Shield` / `Lock` / `Person` (reused above) but not these, and this surface's
// allowed files cannot extend that catalog, so they are hand-authored here as 24×24 stroked vectors,
// mirroring the approach in ClimatePanel / components/datadisplay/DataDisplayGlyphs. ──

private object SecurityGlyphs {
    /** Web `Unlock` — a padlock body with the shackle swung open to the left. */
    val Unlock: ImageVector =
        securityStroked("Unlock") {
            moveTo(5f, 11f)
            lineTo(19f, 11f)
            lineTo(19f, 20f)
            lineTo(5f, 20f)
            close()
            moveTo(8f, 11f)
            lineTo(8f, 7f)
            curveTo(8f, 4.8f, 9.8f, 3f, 12f, 3f)
            curveTo(13.7f, 3f, 15.1f, 4f, 15.7f, 5.5f)
        }

    /** Web `ShieldAlert` — a shield outline with an exclamation stroke + dot. */
    val ShieldAlert: ImageVector =
        securityStroked("ShieldAlert") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 12.5f)
            moveTo(12f, 15.8f)
            lineTo(12.05f, 15.8f)
        }

    /** Web `Eye` — an almond outline with a central pupil. */
    val Eye: ImageVector =
        securityStroked("Eye") {
            moveTo(3f, 12f)
            curveTo(5f, 8f, 8.5f, 6f, 12f, 6f)
            curveTo(15.5f, 6f, 19f, 8f, 21f, 12f)
            curveTo(19f, 16f, 15.5f, 18f, 12f, 18f)
            curveTo(8.5f, 18f, 5f, 16f, 3f, 12f)
            close()
            moveTo(9.5f, 12f)
            arcTo(2.5f, 2.5f, 0f, true, true, 14.5f, 12f)
            arcTo(2.5f, 2.5f, 0f, true, true, 9.5f, 12f)
            close()
        }

    /** Web `DoorClosed` — a door panel on a floor line with a small handle. */
    val DoorClosed: ImageVector =
        securityStroked("DoorClosed") {
            moveTo(6f, 21f)
            lineTo(6f, 5f)
            curveTo(6f, 3.9f, 6.9f, 3f, 8f, 3f)
            lineTo(16f, 3f)
            curveTo(17.1f, 3f, 18f, 3.9f, 18f, 5f)
            lineTo(18f, 21f)
            moveTo(4f, 21f)
            lineTo(20f, 21f)
            moveTo(14.5f, 12f)
            lineTo(14.6f, 12f)
        }

    /** Web `KeyRound` — a ring bow up top with a stem and a tooth toward the lower-left. */
    val KeyRound: ImageVector =
        securityStroked("KeyRound") {
            moveTo(11.5f, 8.5f)
            arcTo(3.5f, 3.5f, 0f, true, true, 14.5f, 11.8f)
            lineTo(7.5f, 18.8f)
            lineTo(7.5f, 21f)
            lineTo(5f, 21f)
            lineTo(5f, 18.5f)
            lineTo(8.2f, 15.3f)
            moveTo(11f, 12.5f)
            lineTo(12.5f, 14f)
        }
}

private fun securityStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

// ── Previews — one per rendered state (content / empty / loading / error / offline). ───────────────────

private val PREVIEW_STRINGS =
    SecurityPanelStrings(
        title = "Security",
        locked = "Locked",
        unlocked = "Unlocked",
        lockStatus = "Vehicle lock status",
        sentryMode = "Sentry Mode",
        active = "Active",
        inactive = "Inactive",
        doors = "Doors",
        windows = "Windows",
        closed = "Closed",
        userPresent = "User Present",
        yes = "Yes",
        no = "No",
        remoteStart = "Remote Start",
        enabled = "Enabled",
        disabled = "Disabled",
        noData = "No security data available",
    )

private fun previewSnapshot(): SecuritySnapshot =
    SecuritySnapshot(
        security =
            buildJsonObject {
                put("locked", true)
                put("sentry_mode", true)
                put("doors_open", "Closed")
                put("windows_open", "Closed")
                put("user_present", false)
                put("detail", "All systems nominal")
            },
        config = buildJsonObject { put("remote_start_enabled", true) },
    )

@Preview(name = "Security · content", showBackground = true, widthDp = 420)
@Composable
private fun SecurityPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityPanelContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Security · empty", showBackground = true, widthDp = 420)
@Composable
private fun SecurityPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityPanelContent(
            state = UiState(phase = UiPhase.Empty, data = SecuritySnapshot(JsonNull, JsonNull), fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Security · loading", showBackground = true, widthDp = 420)
@Composable
private fun SecurityPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityPanelContent(
            state = UiState.loading(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Security · error", showBackground = true, widthDp = 420)
@Composable
private fun SecurityPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Security · offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun SecurityPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot(),
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = PREVIEW_STRINGS,
        )
    }
}
