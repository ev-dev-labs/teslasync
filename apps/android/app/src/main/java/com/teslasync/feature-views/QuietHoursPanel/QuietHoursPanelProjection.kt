// Pure, framework-light model + projection for the QuietHoursPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/QuietHoursPanel.tsx). Every declaration here is exercised off-device by
// the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component owns the quiet-hours / Do-Not-Disturb CRUD surface: a list of windows (each a local-time
// HH:MM start+end + IANA timezone, a weekday bitmask Sun=1<<0..Sat=1<<6, and a list of severities that bypass
// the gate), an "Add window" affordance, and an inline create/edit form. This file owns the parity-critical
// derivations that have nothing to do with Compose: the draft model (web `DraftWindow` + `makeDraft`), the
// pure validator (web `validateDraft`), the window summary (web `summarizeWindow`), the next-state-change
// computation (web exported `nextWindowChangeLabel`), the AI-seed adapter (web `seedDraft` consumption), the
// curated timezone list (web `listTimezones` fallback), the severity/weekday catalogues, and the typed toast
// set. The lucide `Moon` / `Trash2` glyphs Android has no bundled set for are authored as stroked vectors in
// the shared monochrome style, recolored at render — exactly as the sibling surfaces author their local glyphs;
// `Plus` / `Edit` / `Check` / `Close` come from the shared `TeslaGlyphs`.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/feature-views/QuietHoursPanel — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package and hosts several co-located declarations, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.quiethourspanel

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindow
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object QuietHoursPanelRegistration {
    /** Stable surface id. */
    const val ID: String = "quiet-hours-panel"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "QuietHoursPanel"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [QuietHoursPanelRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable / view-model calls it from
 * the first-composition effect. It carries no window times, timezone, or id, so a diagnostics line can never leak
 * what a user has configured.
 */
fun recordQuietHoursPanelViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to QuietHoursPanelRegistration.SLUG))
}

// ── Constants (mirror the web consts) ────────────────────────────────────────────────────────────────────

/** Full weekday bitmask (Sun..Sat), web `ALL_WEEKDAYS`. */
const val ALL_WEEKDAYS: Int = 127

/** Default seeded start/end for a new window (web `makeDraft` defaults). */
const val DEFAULT_START_LOCAL: String = "23:00"
const val DEFAULT_END_LOCAL: String = "07:00"

/** Default bypass severities for a new window (web `DEFAULT_BYPASS`). */
val DEFAULT_BYPASS: List<String> = listOf("critical")

/** The seven weekday bits in Sun..Sat order (web `WEEKDAYS`), each `1 shl dayOfWeek`. */
val WEEKDAY_BITS: List<Int> = (0..6).map { 1 shl it }

/** A severity a window can let bypass the gate, in the web `SEVERITY_CHOICES` order (most severe first). */
enum class BypassSeverity(
    val value: String,
) {
    Critical("critical"),
    Warn("warn"),
    Info("info"),
}

/** The bypass severities offered in the form, ordered most-severe-first (web `SEVERITY_CHOICES`). */
val SEVERITY_CHOICES: List<BypassSeverity> = listOf(BypassSeverity.Critical, BypassSeverity.Warn, BypassSeverity.Info)

// ── Draft model (web `DraftWindow`) ──────────────────────────────────────────────────────────────────────

/**
 * The in-progress form state for one quiet-hours window — the port of the web `DraftWindow`. [id] is set when
 * editing an existing window, `null` when creating. All fields are local form state until the canonical save.
 */
data class DraftWindow(
    val id: Long? = null,
    val enabled: Boolean = true,
    val startLocal: String = DEFAULT_START_LOCAL,
    val endLocal: String = DEFAULT_END_LOCAL,
    val timezone: String = "UTC",
    val weekdays: Int = ALL_WEEKDAYS,
    val bypassSeverities: List<String> = DEFAULT_BYPASS,
)

/**
 * Builds a draft from an existing [initial] window (edit) or sensible defaults (create) — the port of the web
 * `makeDraft`. The create default timezone is resolved by the caller ([defaultTimezone], the web
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`); kept a parameter so this stays pure and unit-testable.
 */
fun makeDraft(
    initial: QuietHoursWindow? = null,
    defaultTimezone: String = "UTC",
): DraftWindow =
    if (initial != null) {
        DraftWindow(
            id = initial.id,
            enabled = initial.enabled,
            startLocal = initial.startLocal,
            endLocal = initial.endLocal,
            timezone = initial.timezone,
            weekdays = initial.weekdays,
            bypassSeverities = initial.bypassSeverities,
        )
    } else {
        DraftWindow(timezone = defaultTimezone.ifBlank { "UTC" })
    }

/**
 * Seeds a fresh create draft from an AI-advisor [seed] — the port of the web `seedDraft` consumption in the
 * panel's `useEffect`. Every absent field falls back to the same create default the web uses; the resulting
 * draft is always a create (no [DraftWindow.id]) so the user keeps control of the canonical Save button.
 */
fun draftFromSeed(
    seed: QuietHoursWindowInput,
    defaultTimezone: String = "UTC",
): DraftWindow =
    DraftWindow(
        id = null,
        enabled = seed.enabled ?: true,
        startLocal = seed.startLocal ?: DEFAULT_START_LOCAL,
        endLocal = seed.endLocal ?: DEFAULT_END_LOCAL,
        timezone = seed.timezone ?: defaultTimezone.ifBlank { "UTC" },
        weekdays = seed.weekdays ?: ALL_WEEKDAYS,
        bypassSeverities = seed.bypassSeverities ?: DEFAULT_BYPASS,
    )

/** Flips weekday [bit] in the draft mask (web `toggleWeekday`). */
fun DraftWindow.toggleWeekday(bit: Int): DraftWindow = copy(weekdays = weekdays xor bit)

/** Adds/removes [severity] from the draft bypass list (web `toggleSeverity`). */
fun DraftWindow.toggleSeverity(severity: String): DraftWindow =
    copy(
        bypassSeverities =
            if (severity in bypassSeverities) bypassSeverities - severity else bypassSeverities + severity,
    )

/** Projects the draft onto the `POST/PATCH` request body (web `payload`). */
fun DraftWindow.toInput(): QuietHoursWindowInput =
    QuietHoursWindowInput(
        enabled = enabled,
        startLocal = startLocal,
        endLocal = endLocal,
        timezone = timezone,
        weekdays = weekdays,
        bypassSeverities = bypassSeverities,
    )

// ── Validation (web `validateDraft`) ─────────────────────────────────────────────────────────────────────

/**
 * The specific reason a draft failed validation, each mapping 1:1 to a `quietHours.error.*` i18n key (resolved at
 * the render boundary). `null` from [validateDraft] means the draft is valid. An empty bypass list is allowed —
 * it means everything is deferred during the window (web parity).
 */
enum class QuietHoursValidationError {
    StartInvalid,
    EndInvalid,
    EndEqual,
    TimezoneRequired,
    WeekdaysRequired,
}

private val HHMM_REGEX = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

/**
 * Validates a [draft] exactly as the web `validateDraft`: start/end must be HH:MM (24-hour), end must differ from
 * start, timezone is required, and at least one weekday must be selected. Returns the first failing reason, or
 * `null` when the draft is valid. Pure — unit-tested off-device.
 */
fun validateDraft(draft: DraftWindow): QuietHoursValidationError? =
    when {
        !HHMM_REGEX.matches(draft.startLocal) -> QuietHoursValidationError.StartInvalid
        !HHMM_REGEX.matches(draft.endLocal) -> QuietHoursValidationError.EndInvalid
        draft.startLocal == draft.endLocal -> QuietHoursValidationError.EndEqual
        draft.timezone.isBlank() -> QuietHoursValidationError.TimezoneRequired
        draft.weekdays <= 0 || draft.weekdays > ALL_WEEKDAYS -> QuietHoursValidationError.WeekdaysRequired
        else -> null
    }

/** Parses an HH:MM string into minutes-since-midnight, or `null` when malformed (web `parseHHMM`). */
fun parseHhMm(value: String): Int? {
    if (!HHMM_REGEX.matches(value)) return null
    val (hours, minutes) = value.split(":").map { it.toInt() }
    return hours * 60 + minutes
}

/** One-line window summary "23:00 → 07:00 (Europe/London)" (web `summarizeWindow`). */
fun summarizeWindow(window: QuietHoursWindow): String = "${window.startLocal} \u2192 ${window.endLocal} (${window.timezone})"

// ── Next-state change (web exported `nextWindowChangeLabel`) ──────────────────────────────────────────────

/** Which boundary the window crosses next, and whether it is today or tomorrow (web `nextWindowChangeLabel`). */
enum class NextWindowChangeKind {
    StartsToday,
    EndsToday,
    StartsTomorrow,
    EndsTomorrow,
}

/** The next state change a window will make: its [kind] and the HH:MM [time] at which it happens. */
data class NextWindowChange(
    val kind: NextWindowChangeKind,
    val time: String,
)

/**
 * Computes the next time [window] changes state, the verbatim port of the web exported `nextWindowChangeLabel`
 * (pure: the caller passes the clock as [nowMinutes] minutes-since-midnight and [todayDow] 0=Sun..6=Sat, so tests
 * pin time). Returns `null` when the window is disabled, does not run today, or has malformed times. The web
 * renders the same result as un-internationalized prose; the native render boundary keeps it i18n-clean (see the
 * view), but the decision logic is reproduced here exactly so it is unit-tested.
 */
fun nextWindowChange(
    window: QuietHoursWindow,
    nowMinutes: Int,
    todayDow: Int,
): NextWindowChange? {
    val todayBit = 1 shl todayDow
    val start = parseHhMm(window.startLocal)
    val end = parseHhMm(window.endLocal)
    val runsToday = window.enabled && window.weekdays and todayBit != 0
    if (!runsToday || start == null || end == null) return null
    val wraps = end <= start
    return if (wraps) {
        when {
            nowMinutes < end -> NextWindowChange(NextWindowChangeKind.EndsToday, window.endLocal)
            nowMinutes >= start -> NextWindowChange(NextWindowChangeKind.EndsTomorrow, window.endLocal)
            else -> NextWindowChange(NextWindowChangeKind.StartsToday, window.startLocal)
        }
    } else {
        when {
            nowMinutes < start -> NextWindowChange(NextWindowChangeKind.StartsToday, window.startLocal)
            nowMinutes < end -> NextWindowChange(NextWindowChangeKind.EndsToday, window.endLocal)
            else -> NextWindowChange(NextWindowChangeKind.StartsTomorrow, window.startLocal)
        }
    }
}

// ── Timezones (web `listTimezones` curated fallback) ──────────────────────────────────────────────────────

private val CURATED_TIMEZONES =
    listOf(
        "UTC",
        "Europe/London",
        "Europe/Paris",
        "Europe/Berlin",
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "Asia/Tokyo",
        "Asia/Shanghai",
        "Asia/Kolkata",
        "Australia/Sydney",
    )

/**
 * The IANA timezones offered in the form — a curated cross-section (web `listTimezones` fallback) with the
 * caller's [currentTimezone] prepended when it is not already present, so the user's resolved zone is always
 * selectable. Pure — unit-tested off-device.
 */
fun quietHoursTimezones(currentTimezone: String): List<String> =
    if (currentTimezone.isNotBlank() && currentTimezone !in CURATED_TIMEZONES) {
        listOf(currentTimezone) + CURATED_TIMEZONES
    } else {
        CURATED_TIMEZONES
    }

// ── Toasts (web `useToast`) ──────────────────────────────────────────────────────────────────────────────

/** The typed quiet-hours mutation toasts the composable maps to localized surfaces (web `useToast`). */
enum class QuietHoursToast {
    Created,
    Updated,
    SaveFailed,
    Deleted,
    DeleteFailed,
}

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws lucide icons Android has no bundled set for. Feature views may not expand the shared
// icon library from a surface prompt (allowed-files), so each is authored here as a 24×24 round-capped stroked
// vector in the shared monochrome style — recolored at render by the `Icon` tint, exactly as the sibling
// surfaces author their local glyphs. Plus / Edit / Check / Close come from the shared `TeslaGlyphs`.

/** Quiet-hours glyphs the surface renders, authored as monochrome stroked vectors. */
object QuietHoursGlyphs {
    /** Web `Moon` — the Do-Not-Disturb identity icon (crescent). */
    val Moon: ImageVector =
        strokedGlyph("Moon") {
            moveTo(20.5f, 13f)
            arcTo(8.5f, 8.5f, 0f, true, true, 11f, 3.5f)
            arcTo(7f, 7f, 0f, false, false, 20.5f, 13f)
            close()
        }

    /** Web `Trash2` — delete a window. */
    val Trash: ImageVector =
        strokedGlyph("Trash") {
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            moveTo(6.5f, 7f)
            lineTo(7.5f, 20f)
            lineTo(16.5f, 20f)
            lineTo(17.5f, 7f)
            moveTo(9.5f, 7f)
            lineTo(9.5f, 4.5f)
            lineTo(14.5f, 4.5f)
            lineTo(14.5f, 7f)
            moveTo(10.5f, 10.5f)
            lineTo(10.5f, 16.5f)
            moveTo(13.5f, 10.5f)
            lineTo(13.5f, 16.5f)
        }
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
