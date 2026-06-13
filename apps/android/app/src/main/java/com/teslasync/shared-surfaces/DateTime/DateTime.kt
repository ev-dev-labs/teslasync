// The native Jetpack Compose + Material 3 DateTime shared surface — a parity port of
// web/src/components/data-display/format/DateTime.tsx. The web component is a locale + timezone aware inline
// `<span>` that renders a single timestamp (its `value` prop) in one of five variants (full / date / time /
// relative / short), hovering the canonical ISO string as its `title`, and — when given an `in` / `showTz`
// prop — resolving the display zone from the user's settings + the active vehicle via the three hooks
// `useSettings`, `useSelectedVehicle`, and `useTimezone`.
//
// This port keeps that contract end to end while staying idiomatic. Like the web component it branches on the
// props: with no `in` / `showTz` it is the pure, provider-free [PureDateTime] (the web `PureDateTime` path
// kept "pure to keep render cost low across table-heavy pages") rendering against the device locale + zone;
// with `in` / `showTz` it is the provider-bound [TzAwareDateTime], which binds the settings + vehicle feeds
// (P1/S8) through [DateTimeViewModel], renders EVERY state that zone feed can carry (loading / content / stale
// / offline / hard error) as a compact trailing freshness chip beside the always-rendered timestamp, exposes
// a retry affordance on the offline / failed states, and emits the PII-safe `view.opened` diagnostic (P1/S11).
// Neither path performs HTTP; every visible string resolves through the i18n catalog (P1/S10) and the inline
// element carries a merged TalkBack label plus the ISO string as a long-press tooltip.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web `<span>` never blanks and never
// shows feed chrome — it renders immediately against defaults and refines once data arrives. The P3 contract
// additionally requires every bound-feed state to render a non-blank affordance. Both hold here: the timestamp
// text is the always-on content (cached → fresh → device-default zone fallback, never hidden), and only the
// zone-resolution feed's non-fresh states add the trailing chip. The surface's "empty" state is the em-dash
// marker shown for a null / invalid `value` (the web `FALLBACK`), not a feed branch. The web `formatRelativeTime`
// English tokens are resolved from the byte-identical `palette.recent.*` catalog plurals.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DateTime — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datetime

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import java.time.ZoneId

/**
 * Stateful entry point — the faithful port of the web `<DateTime>`. With no [tzMode] (web `in`) and [showTz]
 * off it renders the provider-free [PureDateTime] (device locale + zone), exactly as the web `PureDateTime`
 * keeps the common table path cheap; otherwise it binds the settings + vehicle feeds via [TzAwareDateTime].
 *
 * @param value the ISO-8601 timestamp to render (web `value`); `null` / blank / unparseable renders the em-dash.
 * @param variant the render style (web `variant`); defaults to the full date + time.
 * @param tzMode an explicit display-zone override (web `in`); `null` defers to the user's settings default.
 * @param showTz append the short timezone abbreviation after the value (web `showTz`); forces the tz-aware path.
 */
@Composable
fun DateTime(
    value: String?,
    modifier: Modifier = Modifier,
    variant: DateTimeVariant = DateTimeVariant.Full,
    tzMode: TzMode? = null,
    showTz: Boolean = false,
) {
    if (tzMode == null && !showTz) {
        PureDateTime(value = value, variant = variant, modifier = modifier)
    } else {
        TzAwareDateTime(value = value, variant = variant, explicitMode = tzMode, showTz = showTz, modifier = modifier)
    }
}

/**
 * The pure, provider-free path — the web `PureDateTime`. Renders [value] in the device's locale + zone with no
 * feed subscription, so it is safe to mount thousands of times in a table without touching any provider. No
 * timezone abbreviation, status chip, or diagnostic is emitted (web parity + the documented render-cost path).
 */
@Composable
private fun PureDateTime(
    value: String?,
    variant: DateTimeVariant,
    modifier: Modifier,
) {
    val deviceZone = remember { deviceZoneId() }
    val localeTag = currentLocaleTag()
    val nowMillis = System.currentTimeMillis()
    val display =
        remember(value, variant, deviceZone, localeTag, relativeMemoKey(variant, nowMillis)) {
            resolveDisplay(value, variant, deviceZone, localeTag, nowMillis)
        }
    val displayText = displayString(display)
    DateTimeInline(
        displayText = displayText,
        abbrev = "",
        iso = isoTitle(value, null),
        description = dateTimeContentDescription(displayText, null, null),
        freshness = DateTimeFreshness.Fresh,
        onRetry = {},
        modifier = modifier,
    )
}

/**
 * The provider-bound path — the web `DateTimeWithTz`. Binds the shared settings + vehicle + selection seam via
 * [dateTimeSource] into a [DateTimeViewModel], records the one-shot `view.opened` diagnostic, collects the live
 * zone-config state, and renders the timestamp + the freshness chip via the stateless [DateTimeContent].
 */
@Composable
private fun TzAwareDateTime(
    value: String?,
    variant: DateTimeVariant,
    explicitMode: TzMode?,
    showTz: Boolean,
    modifier: Modifier,
) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            dateTimeSource(container.selectedVehicleStore, container.vehiclesStore, container.settingsStore)
        }
    val viewModel: DateTimeViewModel =
        viewModel(
            key = DateTimeRegistration.ID,
            factory = DateTimeViewModel.factory(source, container.logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    DateTimeContent(
        value = value,
        state = state,
        modifier = modifier,
        variant = variant,
        explicitMode = explicitMode,
        showTz = showTz,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer for the tz-aware surface — the unit/UI-test and preview entry point. Resolves the effective
 * zone + locale from the cache-then-network [state] (web `useTimezone` over the bound settings/vehicle), formats
 * [value] for the [variant], appends the timezone abbreviation when [showTz] is set, and renders the
 * always-present timestamp beside a freshness chip that mirrors the feed posture (loading / stale / offline /
 * hard error). The whole element carries a merged TalkBack label and the ISO string as a long-press tooltip.
 *
 * @param nowMillis the wall clock used by the relative variant (web `Date.now()`); injectable for tests.
 */
@Composable
fun DateTimeContent(
    value: String?,
    state: UiState<DateTimeSettings>,
    modifier: Modifier = Modifier,
    variant: DateTimeVariant = DateTimeVariant.Full,
    explicitMode: TzMode? = null,
    showTz: Boolean = false,
    onRetry: () -> Unit = {},
    nowMillis: Long = System.currentTimeMillis(),
) {
    val settings = state.data
    val deviceZone = remember { deviceZoneId() }
    val deviceLocaleTag = currentLocaleTag()
    val zoneId = effectiveZoneId(explicitMode, settings, deviceZone)
    val localeTag = effectiveLocaleTag(settings, deviceLocaleTag)
    val display =
        remember(value, variant, zoneId, localeTag, relativeMemoKey(variant, nowMillis)) {
            resolveDisplay(value, variant, zoneId, localeTag, nowMillis)
        }
    val displayText = displayString(display)
    val abbrev = if (showTz) tzAbbreviation(value, zoneId, localeTag) else ""
    val freshness = dateTimeFreshness(state)
    val description = dateTimeContentDescription(displayText, abbrev, freshnessStatusLabel(freshness))
    DateTimeInline(
        displayText = displayText,
        abbrev = abbrev,
        iso = isoTitle(value, zoneId),
        description = description,
        freshness = freshness,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/**
 * The inline element shared by both paths: the timestamp text, an optional muted timezone abbreviation (web
 * `ml-1 text-xs text-muted`), and the freshness chip, all merged under one [description] for TalkBack and (when
 * [iso] is present) wrapped in a long-press [Tooltip] carrying the canonical ISO string (the web `title`).
 */
@Composable
private fun DateTimeInline(
    displayText: String,
    abbrev: String,
    iso: String?,
    description: String,
    freshness: DateTimeFreshness,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    if (iso != null) {
        Tooltip(text = iso, modifier = modifier) {
            DateTimeRow(displayText, abbrev, description, freshness, onRetry)
        }
    } else {
        DateTimeRow(displayText, abbrev, description, freshness, onRetry, modifier)
    }
}

@Composable
private fun DateTimeRow(
    displayText: String,
    abbrev: String,
    description: String,
    freshness: DateTimeFreshness,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description },
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.Bottom,
        ) {
            BodyText(displayText)
            if (abbrev.isNotBlank()) {
                HelperText(abbrev)
            }
        }
        DateTimeFreshnessChip(freshness = freshness, onRetry = onRetry)
    }
}

/**
 * The localized freshness chip beside the timestamp: an "updating…" chip while a refresh runs over a cached
 * zone, a stale chip once it passes its TTL, and an offline chip — clickable to retry — while a cached or
 * absent zone is shown after a failed refresh. Renders nothing while the zone is live.
 */
@Composable
private fun DateTimeFreshnessChip(
    freshness: DateTimeFreshness,
    onRetry: () -> Unit,
) {
    when (freshness) {
        DateTimeFreshness.Fresh -> Unit
        DateTimeFreshness.Updating ->
            Badge(text = stringResource(R.string.translation_freshness_updating), variant = BadgeVariant.Neutral, dot = true)
        DateTimeFreshness.Stale ->
            Badge(text = stringResource(R.string.translation_mqtt_stale), variant = BadgeVariant.Info, dot = true)
        DateTimeFreshness.Offline ->
            DateTimeRetryChip(text = stringResource(R.string.translation_common_offline), onRetry = onRetry)
        DateTimeFreshness.Failed ->
            DateTimeRetryChip(text = stringResource(R.string.translation_common_offline), onRetry = onRetry)
    }
}

/** An offline/failed freshness chip wrapped in a clickable, TalkBack-labelled retry affordance. */
@Composable
private fun DateTimeRetryChip(
    text: String,
    onRetry: () -> Unit,
) {
    val retryLabel = stringResource(R.string.translation_common_retry)
    Box(
        modifier =
            Modifier
                .clip(RoundedCornerShape(Radius.pill))
                .clickable(onClickLabel = retryLabel, role = Role.Button, onClick = onRetry),
    ) {
        Badge(text = text, variant = BadgeVariant.Warning, dot = true)
    }
}

/** Resolves the [DateTimeDisplay] to its on-screen string, localizing the relative variant via the catalog. */
@Composable
private fun displayString(display: DateTimeDisplay): String =
    when (display) {
        DateTimeDisplay.Empty -> EM_DASH
        is DateTimeDisplay.Text -> display.value
        is DateTimeDisplay.Relative -> relativeString(display.time)
    }

/** Resolves a [RelativeTime] bucket to the localized phrase (web `formatRelativeTime` tokens via the catalog). */
@Composable
private fun relativeString(time: RelativeTime): String =
    when (time) {
        RelativeTime.JustNow -> stringResource(R.string.translation_palette_recent_justNow)
        is RelativeTime.Minutes ->
            pluralStringResource(R.plurals.translation_palette_recent_minutesAgo, time.count, time.count)
        is RelativeTime.Hours ->
            pluralStringResource(R.plurals.translation_palette_recent_hoursAgo, time.count, time.count)
        is RelativeTime.Absolute -> time.value
    }

/** The localized status word folded into the a11y label for the non-fresh feed states (`null` while fresh). */
@Composable
private fun freshnessStatusLabel(freshness: DateTimeFreshness): String? =
    when (freshness) {
        DateTimeFreshness.Fresh -> null
        DateTimeFreshness.Updating -> stringResource(R.string.translation_freshness_updating)
        DateTimeFreshness.Stale -> stringResource(R.string.translation_mqtt_stale)
        DateTimeFreshness.Offline -> stringResource(R.string.translation_common_offline)
        DateTimeFreshness.Failed -> stringResource(R.string.translation_common_offline)
    }

@Composable
private fun currentLocaleTag(): String {
    val configuration = LocalConfiguration.current
    return configuration.locales[0].toLanguageTag()
}

private fun deviceZoneId(): String = ZoneId.systemDefault().id

private fun relativeMemoKey(
    variant: DateTimeVariant,
    nowMillis: Long,
): Long = if (variant == DateTimeVariant.Relative) nowMillis else 0L

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private const val PREVIEW_VALUE: String = "2026-04-04T14:30:00Z"

private fun previewState(
    phase: UiPhase,
    stale: Boolean = false,
    refreshing: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<DateTimeSettings> =
    UiState(
        phase = phase,
        data = if (phase == UiPhase.Error) null else DateTimeSettings.DEFAULTS,
        fetchedAt = 0L,
        stale = stale,
        refreshing = refreshing,
        errorKind = errorKind,
    )

@Preview(name = "Content — full (UTC)", showBackground = true)
@Composable
private fun DateTimeContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            DateTimeContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Content),
                explicitMode = TzMode.Utc,
                showTz = true,
            )
        }
    }
}

@Preview(name = "Empty — null value", showBackground = true)
@Composable
private fun DateTimeEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            DateTimeContent(value = null, state = previewState(UiPhase.Content), explicitMode = TzMode.Utc)
        }
    }
}

@Preview(name = "Relative — 3h ago", showBackground = true)
@Composable
private fun DateTimeRelativePreview() {
    val now = (parseInstant(PREVIEW_VALUE)?.toEpochMilli() ?: 0L) + 3L * 60L * 60L * 1000L
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            DateTimeContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Content),
                variant = DateTimeVariant.Relative,
                explicitMode = TzMode.Utc,
                nowMillis = now,
            )
        }
    }
}

@Preview(name = "Updating", showBackground = true)
@Composable
private fun DateTimeUpdatingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            DateTimeContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Content, refreshing = true),
                explicitMode = TzMode.Utc,
                showTz = true,
            )
        }
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun DateTimeOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            DateTimeContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Content, stale = true, errorKind = ErrorKind.Network),
                explicitMode = TzMode.Utc,
                showTz = true,
            )
        }
    }
}

@Preview(name = "Hard error — cold offline", showBackground = true)
@Composable
private fun DateTimeFailedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            DateTimeContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Error, errorKind = ErrorKind.Http),
                explicitMode = TzMode.Utc,
            )
        }
    }
}
