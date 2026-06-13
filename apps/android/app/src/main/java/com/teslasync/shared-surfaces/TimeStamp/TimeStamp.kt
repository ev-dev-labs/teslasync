// The native Jetpack Compose + Material 3 TimeStamp shared surface — a parity port of
// web/src/components/data-display/TimeStamp.tsx. The web component renders a single instant TWICE: a visible
// body and a hover/long-press tooltip carrying the ALTERNATE format. The visible face is chosen by the
// resolved format — `'auto'` (default) honours the user's `time_format_default` Settings preference
// (`useTimeFormatPreference`), explicit `'relative'` / `'absolute'` override it — and the two faces come from
// `useDateFormat(in)`'s `formatRelative` ("2h ago") and `formatDateTime` ("Apr 4, 2:30 AM"). A null /
// unparseable `value` renders the bare "—" marker with no tooltip.
//
// This port keeps that contract end to end while staying idiomatic. Unlike `<DateTime>` it has no pure path:
// the web component ALWAYS subscribes to settings (for both the format preference and the locale + zone), so
// the native surface is always provider-bound — it binds the settings + vehicle + selection feeds (P1/S8)
// through [TimeStampViewModel], renders EVERY state that feed can carry (loading / content / stale / offline /
// hard error) as a compact trailing freshness chip beside the always-rendered timestamp, exposes a retry
// affordance on the offline / failed states, and emits the PII-safe `view.opened` diagnostic (P1/S11). The
// view performs no HTTP; every visible string resolves through the i18n catalog (P1/S10), the value carries a
// merged TalkBack label, and the alternate format is exposed as a long-press tooltip (the web `title`).
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web component never blanks and never
// shows feed chrome — it renders immediately against defaults and refines once data arrives. The P3 contract
// additionally requires every bound-feed state to render a non-blank affordance. Both hold here: the timestamp
// text is the always-on content (cached → fresh → device-default fallback, never hidden), and only the
// resolution feed's non-fresh states add the trailing chip. The surface's "empty" state is the em-dash marker
// shown for a null / unparseable `value` (the web bare-span branch), not a feed branch.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TimeStamp — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timestamp

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
 * Stateful entry point — the faithful port of the web `<TimeStamp>`. Always binds the settings + vehicle
 * feeds (the web component always subscribes via `useTimeFormatPreference` + `useDateFormat`), records the
 * one-shot `view.opened` diagnostic, and renders the timestamp + freshness chip via [TimeStampContent].
 *
 * @param value the ISO-8601 timestamp to render (web `value`); `null` / blank / unparseable renders the em-dash.
 * @param format the visible format (web `format`); [TimeStampFormat.Auto] honours the user's preference.
 * @param tzMode an explicit display-zone override (web `in`); `null` defers to the user's settings default.
 */
@Composable
fun TimeStamp(
    value: String?,
    modifier: Modifier = Modifier,
    format: TimeStampFormat = TimeStampFormat.Auto,
    tzMode: TzMode? = null,
) {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            timeStampSource(container.selectedVehicleStore, container.vehiclesStore, container.settingsStore)
        }
    val viewModel: TimeStampViewModel =
        viewModel(
            key = TimeStampRegistration.ID,
            factory = TimeStampViewModel.factory(source, container.logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    TimeStampContent(
        value = value,
        state = state,
        modifier = modifier,
        format = format,
        explicitMode = tzMode,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Resolves the effective format (web
 * `format === 'auto' ? pref : format`), zone, and locale from the cache-then-network [state], builds both
 * format faces, renders the visible [primary][TimeStampDisplay.Rendered.primary] beside a freshness chip that
 * mirrors the feed posture (loading / stale / offline / hard error), and hangs the alternate
 * [secondary][TimeStampDisplay.Rendered.secondary] format on a long-press tooltip. The value carries a merged
 * TalkBack label. A null / unparseable [value] renders the em-dash marker with no tooltip.
 *
 * @param nowMillis the wall clock used by the relative face (web `Date.now()`); injectable for tests.
 */
@Composable
fun TimeStampContent(
    value: String?,
    state: UiState<TimeStampSettings>,
    modifier: Modifier = Modifier,
    format: TimeStampFormat = TimeStampFormat.Auto,
    explicitMode: TzMode? = null,
    onRetry: () -> Unit = {},
    nowMillis: Long = System.currentTimeMillis(),
) {
    val settings = state.data
    val deviceZone = remember { deviceZoneId() }
    val deviceLocaleTag = currentLocaleTag()
    val zoneId = effectiveZoneId(explicitMode, settings, deviceZone)
    val localeTag = effectiveLocaleTag(settings, deviceLocaleTag)
    val timeFormat = effectiveTimeFormat(format, settings)
    val display =
        remember(value, timeFormat, zoneId, localeTag, nowMillis) {
            resolveTimeStampDisplay(value, timeFormat, zoneId, localeTag, nowMillis)
        }
    val freshness = timeStampFreshness(state)
    val primaryText = primaryString(display)
    val tooltipText = tooltipString(display)
    val description = timeStampContentDescription(primaryText, freshnessStatusLabel(freshness))
    TimeStampInline(
        primaryText = primaryText,
        tooltipText = tooltipText,
        description = description,
        freshness = freshness,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/**
 * The inline element: the visible timestamp text (wrapped in a long-press [Tooltip] carrying the alternate
 * format when present — the web `title`/`Tooltip content`), beside the freshness chip. The value node carries
 * the merged [description] for TalkBack.
 */
@Composable
private fun TimeStampInline(
    primaryText: String,
    tooltipText: String?,
    description: String,
    freshness: TimeStampFreshness,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val valueModifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description }
        if (tooltipText != null) {
            Tooltip(text = tooltipText) {
                BodyText(primaryText, modifier = valueModifier)
            }
        } else {
            BodyText(primaryText, modifier = valueModifier)
        }
        TimeStampFreshnessChip(freshness = freshness, onRetry = onRetry)
    }
}

/**
 * The localized freshness chip beside the timestamp: an "updating…" chip while a refresh runs over a cached
 * config, a stale chip once it passes its TTL, and an offline chip — clickable to retry — while a cached or
 * absent config is shown after a failed refresh. Renders nothing while the config is live.
 */
@Composable
private fun TimeStampFreshnessChip(
    freshness: TimeStampFreshness,
    onRetry: () -> Unit,
) {
    when (freshness) {
        TimeStampFreshness.Fresh -> Unit
        TimeStampFreshness.Updating ->
            Badge(text = stringResource(R.string.translation_freshness_updating), variant = BadgeVariant.Neutral, dot = true)
        TimeStampFreshness.Stale ->
            Badge(text = stringResource(R.string.translation_mqtt_stale), variant = BadgeVariant.Info, dot = true)
        TimeStampFreshness.Offline ->
            TimeStampRetryChip(text = stringResource(R.string.translation_common_offline), onRetry = onRetry)
        TimeStampFreshness.Failed ->
            TimeStampRetryChip(text = stringResource(R.string.translation_common_offline), onRetry = onRetry)
    }
}

/** An offline/failed freshness chip wrapped in a clickable, TalkBack-labelled retry affordance. */
@Composable
private fun TimeStampRetryChip(
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

/** The visible body string: the em-dash marker for the empty value, else the localized primary face. */
@Composable
private fun primaryString(display: TimeStampDisplay): String =
    when (display) {
        TimeStampDisplay.Empty -> EM_DASH
        is TimeStampDisplay.Rendered -> phraseString(display.primary)
    }

/** The tooltip alternate-format string, or `null` for the empty value (web's bare-span, tooltip-free branch). */
@Composable
private fun tooltipString(display: TimeStampDisplay): String? =
    when (display) {
        TimeStampDisplay.Empty -> null
        is TimeStampDisplay.Rendered -> phraseString(display.secondary)
    }

/** Resolves a [TimePhrase] to its on-screen string, localizing the relative face via the catalog. */
@Composable
private fun phraseString(phrase: TimePhrase): String =
    when (phrase) {
        is TimePhrase.Absolute -> phrase.value
        is TimePhrase.Relative -> relativeString(phrase.age)
    }

/** Resolves a [RelativeAge] bucket to the localized phrase (web `formatRelative` tokens via the catalog). */
@Composable
private fun relativeString(age: RelativeAge): String =
    when (age) {
        RelativeAge.JustNow -> stringResource(R.string.translation_freshness_justNow)
        is RelativeAge.Minutes ->
            pluralStringResource(R.plurals.translation_palette_recent_minutesAgo, age.count, age.count)
        is RelativeAge.Hours ->
            pluralStringResource(R.plurals.translation_palette_recent_hoursAgo, age.count, age.count)
        is RelativeAge.Days ->
            pluralStringResource(R.plurals.translation_palette_recent_daysAgo, age.count, age.count)
        is RelativeAge.AbsoluteDate -> age.value
    }

/** The localized status word folded into the a11y label for the non-fresh feed states (`null` while fresh). */
@Composable
private fun freshnessStatusLabel(freshness: TimeStampFreshness): String? =
    when (freshness) {
        TimeStampFreshness.Fresh -> null
        TimeStampFreshness.Updating -> stringResource(R.string.translation_freshness_updating)
        TimeStampFreshness.Stale -> stringResource(R.string.translation_mqtt_stale)
        TimeStampFreshness.Offline -> stringResource(R.string.translation_common_offline)
        TimeStampFreshness.Failed -> stringResource(R.string.translation_common_offline)
    }

@Composable
private fun currentLocaleTag(): String {
    val configuration = LocalConfiguration.current
    return configuration.locales[0].toLanguageTag()
}

private fun deviceZoneId(): String = ZoneId.systemDefault().id

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private const val PREVIEW_VALUE: String = "2026-04-04T14:30:00Z"

private fun previewState(
    phase: UiPhase,
    stale: Boolean = false,
    refreshing: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<TimeStampSettings> =
    UiState(
        phase = phase,
        data = if (phase == UiPhase.Error) null else TimeStampSettings.DEFAULTS,
        fetchedAt = 0L,
        stale = stale,
        refreshing = refreshing,
        errorKind = errorKind,
    )

@Preview(name = "Relative — auto (default)", showBackground = true)
@Composable
private fun TimeStampRelativePreview() {
    val now = (parseInstant(PREVIEW_VALUE)?.toEpochMilli() ?: 0L) + 2L * 60L * 60L * 1000L
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            TimeStampContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Content),
                explicitMode = TzMode.Utc,
                nowMillis = now,
            )
        }
    }
}

@Preview(name = "Absolute — explicit", showBackground = true)
@Composable
private fun TimeStampAbsolutePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            TimeStampContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Content),
                format = TimeStampFormat.Absolute,
                explicitMode = TzMode.Utc,
            )
        }
    }
}

@Preview(name = "Empty — null value", showBackground = true)
@Composable
private fun TimeStampEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            TimeStampContent(value = null, state = previewState(UiPhase.Content), explicitMode = TzMode.Utc)
        }
    }
}

@Preview(name = "Updating", showBackground = true)
@Composable
private fun TimeStampUpdatingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            TimeStampContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Content, refreshing = true),
                format = TimeStampFormat.Absolute,
                explicitMode = TzMode.Utc,
            )
        }
    }
}

@Preview(name = "Stale", showBackground = true)
@Composable
private fun TimeStampStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            TimeStampContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Content, stale = true),
                format = TimeStampFormat.Absolute,
                explicitMode = TzMode.Utc,
            )
        }
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun TimeStampOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            TimeStampContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Content, stale = true, errorKind = ErrorKind.Network),
                format = TimeStampFormat.Absolute,
                explicitMode = TzMode.Utc,
            )
        }
    }
}

@Preview(name = "Hard error — cold offline", showBackground = true)
@Composable
private fun TimeStampFailedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GlassPanel {
            TimeStampContent(
                value = PREVIEW_VALUE,
                state = previewState(UiPhase.Error, errorKind = ErrorKind.Http),
                format = TimeStampFormat.Absolute,
                explicitMode = TzMode.Utc,
            )
        }
    }
}
