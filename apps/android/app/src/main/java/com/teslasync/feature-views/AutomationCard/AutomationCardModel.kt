// Pure, framework-free model + projection for the AutomationCard feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/automations/pages/AutomationCard.tsx). The projection logic carries no Compose, Android,
// or HTTP types, so it is fully exercised off-device in the :android:testReleaseUnitTest gate and the
// composable stays a thin render layer. The only non-logic declarations are the co-located lucide glyph
// vectors (static ImageVector values), authored locally exactly as the sibling feature-view surfaces do.
//
// The web component is purely presentational: its parent (the Automations list, via useAutomations) passes a
// single `Automation`, an `isFiring` flag, an optional `vehicleName`, and four callbacks. This file owns the
// derivations the web component computes inline: the UI status (web `getUIStatus` — auto_disabled →
// auto-disabled, !enabled → disabled, else active), the toggle's checked value (web
// `a.auto_disabled ? false : a.enabled`), the toggle intent (web `handleToggle` — re-enable when toggling an
// auto-disabled automation on, otherwise enable/disable), the relative "last run" age (web `timeAgo` cutoffs),
// the absolute "next fire" timestamp (web `formatDateTime`), the failure-count guard (web
// `a.failure_count > 0`), the auto-disabled-reason guard, and the conflict severity classification (web
// `c.severity === 'warning' ? warning : info`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AutomationCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.automationcard

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown for an unknown/unparseable timestamp — the web `formatDateTime`/`timeAgo` null fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AutomationCardRegistration {
    /** Stable surface id. */
    const val ID: String = "automation-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AutomationCard"
}

/**
 * The semantic UI status of an automation — the native mirror of the web `getUIStatus` result
 * (`'active' | 'disabled' | 'auto-disabled'`). The render layer maps this to a status [BadgeVariant] and a
 * localized label; the model stays free of Compose color types.
 */
enum class AutomationUiStatus {
    Active,
    Disabled,
    AutoDisabled,
    ;

    companion object {
        /** Classifies an [AutomationView] exactly like the web `getUIStatus` precedence. */
        fun from(view: AutomationView): AutomationUiStatus =
            when {
                view.autoDisabled -> AutoDisabled
                !view.enabled -> Disabled
                else -> Active
            }
    }
}

/**
 * The semantic severity of a conflict — the vendor-neutral classification of the raw web severity key
 * (`'warning' | 'info'`). The render layer maps this to a token color + glyph so the model carries no
 * Compose color types; anything that is not `warning` is treated as `info`, exactly like the web ternary.
 */
enum class ConflictSeverity {
    Warning,
    Info,
    ;

    companion object {
        /** Classifies a raw severity key like the web string comparison (case/space tolerant). */
        fun from(raw: String): ConflictSeverity =
            when (raw.trim().lowercase(Locale.ROOT)) {
                "warning" -> Warning
                else -> Info
            }
    }
}

/**
 * One conflict the automation has with another — the native mirror of a web `AutomationConflict`
 * (`{ automation_id, automation_name, reason, severity }`). [severity] is the raw backend key, classified by
 * the projection into a [ConflictSeverity].
 */
data class AutomationConflictView(
    val automationId: Long,
    val automationName: String,
    val reason: String,
    val severity: String,
)

/**
 * The fields of a web `Automation` this card reads, as a render-agnostic value. Optional web fields
 * (`description`, `vehicle_id`, `last_triggered_at`, `auto_disabled_reason`, `next_fire_time`) are nullable;
 * `conflicts` defaults to empty (web `a.conflicts ?? []`).
 */
data class AutomationView(
    val id: Long,
    val name: String,
    val description: String?,
    val enabled: Boolean,
    val vehicleId: Long?,
    val lastTriggeredAt: String?,
    val executionCount: Long,
    val failureCount: Long,
    val autoDisabled: Boolean,
    val autoDisabledReason: String?,
    val nextFireTime: String?,
    val conflicts: List<AutomationConflictView> = emptyList(),
)

/**
 * The intent of a toggle interaction — the native mirror of the web `handleToggle` branch. Toggling an
 * auto-disabled automation on re-enables it ([ReEnable], web `onReEnable`); every other change sets the
 * enabled flag ([SetEnabled], web `onToggle`).
 */
sealed interface AutomationToggleAction {
    data object ReEnable : AutomationToggleAction

    data class SetEnabled(
        val enabled: Boolean,
    ) : AutomationToggleAction
}

/**
 * A fully projected, render-ready conflict — the native analogue of one conflict row the web component maps.
 * Pure data: the composable resolves [severity] to a token color and assembles the localized "Conflict with"
 * sentence around [automationName] and [reason].
 */
data class ConflictProjection(
    val automationName: String,
    val reason: String,
    val severity: ConflictSeverity,
)

/**
 * The fully projected inputs the composable renders — the native analogue of everything the web component
 * derives from its `automation` prop. Pure data (no Compose types) so it is fully covered by the off-device
 * unit gate.
 *
 * @property status the UI status badge classification (web `getUIStatus`).
 * @property toggleChecked the switch's checked value (web `a.auto_disabled ? false : a.enabled`).
 * @property hasLastRun whether the automation has ever run (web `a.last_triggered_at` truthiness).
 * @property lastRunAge the relative age bucket of the last run (web `timeAgo`), [FreshnessAge.Unknown] if none.
 * @property runsCount the lifetime execution count (web `a.execution_count`).
 * @property showFails whether the failure chip shows (web `a.failure_count > 0`).
 * @property failsCount the lifetime failure count (web `a.failure_count`).
 * @property hasNextFire whether a next-fire time is present (web `a.next_fire_time` truthiness).
 * @property nextFireLabel the localized absolute next-fire timestamp (web `formatDateTime`), or [EM_DASH].
 * @property showAutoDisabledWarning whether the auto-disabled reason banner shows (web `auto_disabled && reason`).
 * @property autoDisabledReason the human-readable auto-disable reason, when present.
 * @property conflicts the projected conflict rows, in received order (web `conflicts.map`).
 */
data class AutomationCardProjectionResult(
    val status: AutomationUiStatus,
    val toggleChecked: Boolean,
    val hasLastRun: Boolean,
    val lastRunAge: FreshnessAge,
    val runsCount: Long,
    val showFails: Boolean,
    val failsCount: Long,
    val hasNextFire: Boolean,
    val nextFireLabel: String,
    val showAutoDisabledWarning: Boolean,
    val autoDisabledReason: String?,
    val conflicts: List<ConflictProjection>,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's data derivations.
 * Stateless and side-effect-free (a [nowMillis] clock and the [zone]/[locale] are injected) so it is fully
 * covered by the off-device unit gate.
 */
object AutomationCardProjection {
    /** Projects an [AutomationView] into render-ready fields, mirroring the web component's inline derivations. */
    fun project(
        view: AutomationView,
        nowMillis: Long,
        zone: ZoneId,
        locale: Locale,
    ): AutomationCardProjectionResult {
        val hasNext = !view.nextFireTime.isNullOrBlank()
        return AutomationCardProjectionResult(
            status = AutomationUiStatus.from(view),
            toggleChecked = toggleChecked(view),
            hasLastRun = !view.lastTriggeredAt.isNullOrBlank(),
            lastRunAge = lastRunAge(view.lastTriggeredAt, nowMillis),
            runsCount = view.executionCount,
            showFails = view.failureCount > 0L,
            failsCount = view.failureCount,
            hasNextFire = hasNext,
            nextFireLabel = if (hasNext) formatAbsolute(view.nextFireTime, zone, locale) else EM_DASH,
            showAutoDisabledWarning = view.autoDisabled && !view.autoDisabledReason.isNullOrBlank(),
            autoDisabledReason = view.autoDisabledReason,
            conflicts =
                view.conflicts.map { conflict ->
                    ConflictProjection(
                        automationName = conflict.automationName,
                        reason = conflict.reason,
                        severity = ConflictSeverity.from(conflict.severity),
                    )
                },
        )
    }

    /** The web `a.auto_disabled ? false : a.enabled` — an auto-disabled automation always reads "off". */
    fun toggleChecked(view: AutomationView): Boolean = if (view.autoDisabled) false else view.enabled

    /** The web `handleToggle` decision: re-enable an auto-disabled automation, otherwise set the enabled flag. */
    fun toggleAction(
        view: AutomationView,
        checked: Boolean,
    ): AutomationToggleAction =
        if (view.autoDisabled && checked) {
            AutomationToggleAction.ReEnable
        } else {
            AutomationToggleAction.SetEnabled(checked)
        }

    /**
     * Buckets the relative age of [iso] into a [FreshnessAge] using the web `timeAgo` cutoffs (<1m just now,
     * <60m minutes, <24h hours, else days — no week rollover). A null/blank or unparseable timestamp yields
     * [FreshnessAge.Unknown] (the composable renders the "Never run" branch for the no-last-run case).
     */
    fun lastRunAge(
        iso: String?,
        nowMillis: Long,
    ): FreshnessAge {
        val millis = parseInstantMillis(iso) ?: return FreshnessAge.Unknown
        val minutes = (nowMillis - millis).coerceAtLeast(0L) / MILLIS_PER_MINUTE
        return when {
            minutes < 1L -> FreshnessAge.JustNow
            minutes < MINUTES_PER_HOUR -> FreshnessAge.Minutes(minutes)
            minutes < MINUTES_PER_DAY -> FreshnessAge.Hours(minutes / MINUTES_PER_HOUR)
            else -> FreshnessAge.Days(minutes / MINUTES_PER_DAY)
        }
    }

    /**
     * Tolerant ISO-8601 → localized "medium date, short time" formatter — the native analogue of the web
     * `formatDateTime` (`toLocaleString` with `{year, month:'short', day, hour, minute}`). A blank or
     * unparseable input yields [EM_DASH], exactly like the web helper's invalid-date guard.
     */
    fun formatAbsolute(
        iso: String?,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(iso) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    private fun parseInstantMillis(iso: String?): Long? = parseInstant(iso)?.toEpochMilli()

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the em-dash guard).
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String?): Instant? = if (raw.isNullOrBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }

    private const val MILLIS_PER_MINUTE: Long = 60_000L
    private const val MINUTES_PER_HOUR: Long = 60L
    private const val MINUTES_PER_DAY: Long = 1_440L
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AutomationCardRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordAutomationCardOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AutomationCardRegistration.SLUG))
}

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws eleven distinct lucide icons. Android has no bundled lucide set, and feature views
// may not expand the shared icon library from a surface prompt (allowed-files), so each is authored here as a
// 24×24 stroked vector in the shared monochrome style — recolored at render time by the `Icon` composable's
// tint, exactly as the sibling surfaces author their local glyphs. The web `Copy` (Duplicate action) reuses
// the shared `TeslaGlyphs.Copy`, so it is not re-authored here.

/** The web firing-indicator `Zap` (lucide) — a lightning bolt. */
val ZapGlyph: ImageVector =
    strokedGlyph("Zap") {
        moveTo(13f, 2f)
        lineTo(3f, 14f)
        lineTo(12f, 14f)
        lineTo(11f, 22f)
        lineTo(21f, 10f)
        lineTo(12f, 10f)
        close()
    }

/** The web warning/conflict `AlertTriangle` (lucide) — a triangle enclosing an exclamation. */
val AlertTriangleGlyph: ImageVector =
    strokedGlyph("AlertTriangle") {
        moveTo(12f, 3.5f)
        lineTo(22f, 20.5f)
        lineTo(2f, 20.5f)
        close()
        moveTo(12f, 9f)
        lineTo(12f, 13f)
        dot(12f, 16.5f)
    }

/** The web actions-menu trigger `MoreVertical` (lucide) — three stacked dots. */
val MoreVerticalGlyph: ImageVector =
    strokedGlyph("MoreVertical") {
        dot(12f, 5f)
        dot(12f, 12f)
        dot(12f, 19f)
    }

/** The web Test-Run `Play` (lucide) — a right-pointing triangle. */
val PlayGlyph: ImageVector =
    strokedGlyph("Play") {
        moveTo(6f, 4f)
        lineTo(19f, 12f)
        lineTo(6f, 20f)
        close()
    }

/** The web Re-enable `RotateCcw` (lucide) — a counter-clockwise refresh arrow. */
val RotateCcwGlyph: ImageVector =
    strokedGlyph("RotateCcw") {
        moveTo(3f, 12f)
        arcToRelative(9f, 9f, 0f, true, false, 9f, -9f)
        arcToRelative(9.75f, 9.75f, 0f, false, false, -6.74f, 2.74f)
        lineTo(3f, 8f)
        moveTo(3f, 3f)
        verticalLineToRelative(5f)
        horizontalLineToRelative(5f)
    }

/** The web Export `Download` (lucide) — a down arrow over a tray. */
val DownloadGlyph: ImageVector =
    strokedGlyph("Download") {
        moveTo(21f, 15f)
        verticalLineToRelative(4f)
        arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
        horizontalLineTo(5f)
        arcToRelative(2f, 2f, 0f, false, true, -2f, -2f)
        verticalLineToRelative(-4f)
        moveTo(7f, 10f)
        lineTo(12f, 15f)
        lineTo(17f, 10f)
        moveTo(12f, 15f)
        lineTo(12f, 3f)
    }

/** The web Delete `Trash2` (lucide) — a lidded trash can with two strikes. */
val Trash2Glyph: ImageVector =
    strokedGlyph("Trash2") {
        moveTo(3f, 6f)
        horizontalLineTo(21f)
        moveTo(19f, 6f)
        verticalLineToRelative(14f)
        arcToRelative(2f, 2f, 0f, false, true, -2f, 2f)
        horizontalLineTo(7f)
        arcToRelative(2f, 2f, 0f, false, true, -2f, -2f)
        verticalLineTo(6f)
        moveTo(8f, 6f)
        verticalLineTo(4f)
        arcToRelative(2f, 2f, 0f, false, true, 2f, -2f)
        horizontalLineToRelative(4f)
        arcToRelative(2f, 2f, 0f, false, true, 2f, 2f)
        verticalLineToRelative(2f)
        moveTo(10f, 11f)
        verticalLineToRelative(6f)
        moveTo(14f, 11f)
        verticalLineToRelative(6f)
    }

/** The web vehicle `Car` (lucide) — a simplified side-view body with two wheels. */
val CarGlyph: ImageVector =
    strokedGlyph("Car") {
        moveTo(2.5f, 15f)
        lineTo(2.5f, 13f)
        lineTo(5f, 13f)
        lineTo(7.5f, 8.5f)
        lineTo(15f, 8.5f)
        lineTo(17.5f, 13f)
        lineTo(21.5f, 13f)
        lineTo(21.5f, 15f)
        wheel(7.5f, 15.5f, 1.8f)
        wheel(16.5f, 15.5f, 1.8f)
    }

/** The web last-run `CheckCircle` (lucide) — a circle enclosing a check mark. */
val CheckCircleGlyph: ImageVector =
    strokedGlyph("CheckCircle") {
        glyphCircle()
        moveTo(8.5f, 12f)
        lineTo(11f, 14.5f)
        lineTo(15.5f, 9f)
    }

/** The web never-run `SkipForward` (lucide) — a triangle against a trailing bar. */
val SkipForwardGlyph: ImageVector =
    strokedGlyph("SkipForward") {
        moveTo(5f, 4f)
        lineTo(15f, 12f)
        lineTo(5f, 20f)
        close()
        moveTo(19f, 5f)
        lineTo(19f, 19f)
    }

/** The web failure `XCircle` (lucide) — a circle enclosing an "x". */
val XCircleGlyph: ImageVector =
    strokedGlyph("XCircle") {
        glyphCircle()
        moveTo(15f, 9f)
        lineTo(9f, 15f)
        moveTo(9f, 9f)
        lineTo(15f, 15f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Full circle of radius 9 centered in the 24×24 viewport, approximated by two semicircular arcs. */
private fun PathBuilder.glyphCircle() {
    moveTo(3f, 12f)
    arcTo(9f, 9f, 0f, false, true, 21f, 12f)
    arcTo(9f, 9f, 0f, false, true, 3f, 12f)
    close()
}

/** A small wheel circle of radius [r] centered at ([cx], [cy]), two semicircular arcs. */
private fun PathBuilder.wheel(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

/** A round-capped near-zero-length segment that renders as a dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}
