// Pure, framework-free model + projection for the Guard Mode dashboard widget — the native analogue of
// the data the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/GuardModeWidget.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. Guard fields are plain (enums, ids, opaque timestamps) — not unit-bearing — so there is
// no SI conversion at this layer; the only formatting is the localized labels + relative-time strings the
// surface folds in, exactly as the web does.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/GuardModeWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.guardmode

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEvent
import io.teslasync.shared.core.presentation.guard.isGuardEventAcknowledged
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val MIDDLE_DOT = " \u00b7 "
private const val COLON = ": "

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * branch in the web source: a single column renders the compact armed/event-count hero, wider footprints
 * render the status card above the recent-events feed.
 */
data class GuardModeSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): show the compact hero, not the event feed. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/security.ts (`guard-mode`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object GuardModeRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "guard-mode"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "security"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "GuardModeWidget"

    /** Maximum events rendered in the feed (web standard view `maxItems={5}`). */
    const val MAX_FEED_ITEMS = 5

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = GuardModeSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = GuardModeSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = GuardModeSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: GuardModeSize): Boolean = size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: GuardModeSize): GuardModeSize =
        GuardModeSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The combined guard snapshot the view-model projects — the native union of the two web queries the
 * component composes: the live guard [config] (primary; gates the body and drives the armed/sensitivity
 * status) plus the best-effort list of recent [events] (supplementary, may be empty). A `null` [config]
 * models the web `config ?` gate being falsy (the surface shows the "No guard data" empty state). Pure
 * data so the projection is unit-tested without a UI host.
 */
data class GuardModeSnapshot(
    val config: GuardConfig?,
    val events: List<GuardEvent>,
)

/**
 * Semantic tone for a guard-event marker; mapped to a concrete token color at the render boundary. The
 * tones mirror the web `EVENT_TYPE_MAP` hex accents (amber → [Warning], red → [Critical], cyan → [Info],
 * purple → [Accent], gray → [Muted]).
 */
enum class GuardEventTone { Warning, Critical, Info, Accent, Muted }

/**
 * Glyph family for a guard-event marker; mapped to a concrete `ImageVector` at the render boundary
 * (approximating the web Lucide icon from the shared glyph set — Android has no bundled Lucide).
 */
enum class GuardEventGlyph { Location, Lock, Drive, Eye, Siren, Flask, Shield }

/**
 * Event-type → presentation mapping for one guard event — the native port of `EVENT_TYPE_MAP` /the
 * default fallback in the web source. Resolves the glyph (approximating the web Lucide icon), the
 * semantic tone (mapped from the web hex accent), and the display label.
 *
 * The labels are the web `EVENT_TYPE_MAP[...].label` fallbacks reproduced verbatim: the web resolves the
 * row title via `t('widget.guardEvent.${event_type}', label)`, but no `widget.guardEvent.*` key exists in
 * any shared i18n catalog (only `widget.guardEvents`, the "events" word), so the web always renders these
 * exact fallback strings. Reproducing them keeps the observable output identical (ADR-004 parity). An
 * unknown type falls back to the raw `event_type` (web `ev.event_type ?? '—'`) with a neutral shield.
 */
object GuardEventTypeTokens {
    data class Info(
        val glyph: GuardEventGlyph,
        val tone: GuardEventTone,
        val label: String,
    )

    /** Resolve the presentation triple for a free-form wire `event_type` (lookup-with-fallback). */
    fun of(eventType: String): Info =
        when (eventType) {
            "vehicle_moved" -> Info(GuardEventGlyph.Location, GuardEventTone.Warning, "Vehicle Moved")
            "unauthorized_unlock" -> Info(GuardEventGlyph.Lock, GuardEventTone.Critical, "Unauthorized Unlock")
            "unauthorized_drive" -> Info(GuardEventGlyph.Drive, GuardEventTone.Critical, "Unauthorized Drive")
            "sentry_triggered" -> Info(GuardEventGlyph.Eye, GuardEventTone.Info, "Sentry Triggered")
            "manual_panic" -> Info(GuardEventGlyph.Siren, GuardEventTone.Critical, "Panic Alert")
            "test_alert" -> Info(GuardEventGlyph.Flask, GuardEventTone.Accent, "Test Alert")
            "locked" -> Info(GuardEventGlyph.Shield, GuardEventTone.Info, "Lock State Changed")
            "sentry_mode" -> Info(GuardEventGlyph.Eye, GuardEventTone.Warning, "Sentry Mode")
            "valet_mode_enabled" -> Info(GuardEventGlyph.Shield, GuardEventTone.Info, "Valet Mode")
            else -> Info(GuardEventGlyph.Shield, GuardEventTone.Muted, eventType.ifBlank { EM_DASH })
        }
}

/**
 * One projected, render-ready event row consumed by the feed. Pure data (no Compose types): the resolved
 * marker [glyph]/[tone], the (web-parity) [title], the localized acknowledged/unacknowledged [subtitle],
 * the [relativeTime] label, and a TalkBack [contentDescription] folding all three into one phrase.
 */
data class GuardEventRow(
    val id: Long,
    val glyph: GuardEventGlyph,
    val tone: GuardEventTone,
    val title: String,
    val subtitle: String,
    val relativeTime: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the guard surface for one footprint — the native analogue of
 * everything the web component computes before returning JSX (the `enabled`/`sensitivity`/`autoPanic`
 * deriving, the `eventCount`, and the `feedItems` mapping). Pure data so the projection is unit-tested
 * without a UI host. The composable picks the compact hero or the status-card + feed by [isCompact].
 */
data class GuardModeDisplay(
    val isCompact: Boolean,
    val enabled: Boolean,
    val statusLabel: String,
    val statusIsArmed: Boolean,
    val onOffLabel: String,
    val sensitivitySubtitle: String,
    val eventCountText: String,
    val eventCountIsActive: Boolean,
    val items: List<GuardEventRow>,
    val hasItems: Boolean,
    val compactContentDescription: String,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [GuardModeProjection] reads the armed/disarmed/on/off words, the sensitivity/auto-panic labels, the
 * "events" word, the acknowledged/unacknowledged subtitles, and [formatRelative]; the composable chrome
 * additionally reads [title] / [noEventsMessage] / [noDataMessage] / [refreshLabel] / [refreshingLabel] /
 * [offlineLabel]. The composable builds this from `stringResource`; tests pass a deterministic instance.
 * Keeping i18n out of the projection lets the projection stay a pure, locale-stable function.
 */
data class GuardModeStrings(
    val title: String,
    val armed: String,
    val disarmed: String,
    val on: String,
    val off: String,
    val sensitivityLabel: String,
    val autoPanicLabel: String,
    val eventsWord: String,
    val acknowledged: String,
    val unacknowledged: String,
    val noEventsMessage: String,
    val noDataMessage: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * Pure projection from a decoded [GuardConfig] (+ the best-effort recent [GuardEvent] list) to the
 * [GuardModeDisplay] — the native port of the web component's derived `enabled` / `sensitivity` /
 * `autoPanic` / `eventCount` values and its `feedItems` memo. Nothing here is unit-bearing; [nowMillis] is
 * injected so relative-time tiers are unit-tested deterministically.
 */
object GuardModeProjection {
    /** Project [config] (+ [events]) for [size] at [nowMillis] using the localized [strings]. */
    fun project(
        config: GuardConfig,
        events: List<GuardEvent>,
        size: GuardModeSize,
        strings: GuardModeStrings,
        nowMillis: Long,
    ): GuardModeDisplay {
        val enabled = config.enabled
        val statusLabel = if (enabled) strings.armed else strings.disarmed
        val onOffLabel = if (enabled) strings.on else strings.off
        val eventCount = events.size
        val eventCountText = "${formatInt(eventCount)} ${strings.eventsWord}"
        val rows = projectRows(events, strings, nowMillis)

        return GuardModeDisplay(
            isCompact = size.isCompact,
            enabled = enabled,
            statusLabel = statusLabel,
            statusIsArmed = enabled,
            onOffLabel = onOffLabel,
            sensitivitySubtitle = sensitivitySubtitle(config, strings),
            eventCountText = eventCountText,
            eventCountIsActive = eventCount > 0,
            items = rows,
            hasItems = rows.isNotEmpty(),
            compactContentDescription = "$statusLabel, $eventCountText",
        )
    }

    /**
     * The web status-card subtitle: "Sensitivity: {value} · Auto-panic" — the auto-panic clause only when
     * `config.auto_panic` is set, and a blank sensitivity falling back to the em-dash (web `?? '—'`).
     */
    fun sensitivitySubtitle(
        config: GuardConfig,
        strings: GuardModeStrings,
    ): String {
        val value = config.sensitivity.ifBlank { strings.emDash }
        val base = "${strings.sensitivityLabel}$COLON$value"
        return if (config.autoPanic) "$base$MIDDLE_DOT${strings.autoPanicLabel}" else base
    }

    /** Locale-stable integer formatter with grouped thousands (web `fmtInt`). */
    fun formatInt(value: Int): String = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US)).format(value.toLong())

    /**
     * Project the recent events into render-ready rows — the native port of the web `feedItems` map plus
     * the shared `WidgetEventFeed` sort (newest first) and cap (web standard `maxItems={5}`).
     */
    private fun projectRows(
        events: List<GuardEvent>,
        strings: GuardModeStrings,
        nowMillis: Long,
    ): List<GuardEventRow> =
        events
            .sortedByDescending { parseEpochMillis(it.ts) ?: Long.MIN_VALUE }
            .take(GuardModeRegistration.MAX_FEED_ITEMS)
            .map { event -> projectRow(event, strings, nowMillis) }

    private fun projectRow(
        event: GuardEvent,
        strings: GuardModeStrings,
        nowMillis: Long,
    ): GuardEventRow {
        val info = GuardEventTypeTokens.of(event.eventType)
        val subtitle = if (isGuardEventAcknowledged(event)) strings.acknowledged else strings.unacknowledged
        val relative = formatRelative(event.ts, strings, nowMillis)
        return GuardEventRow(
            id = event.id,
            glyph = info.glyph,
            tone = info.tone,
            title = info.label,
            subtitle = subtitle,
            relativeTime = relative,
            contentDescription = "${info.label}, $subtitle, $relative",
        )
    }

    private fun formatRelative(
        ts: String,
        strings: GuardModeStrings,
        nowMillis: Long,
    ): String {
        val ageSeconds = computeAgeSeconds(parseEpochMillis(ts), nowMillis)
        return strings.formatRelative(relativeAge(ageSeconds))
    }
}

/**
 * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and parses on
 * demand). Returns `null` for a blank/absent or unparseable value so a partial row never throws.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}
