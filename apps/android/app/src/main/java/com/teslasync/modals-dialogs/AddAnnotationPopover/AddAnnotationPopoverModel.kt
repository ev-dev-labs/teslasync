// Pure, framework-free model + projection for the AddAnnotationPopover modal/dialog surface — the native analogue of
// everything the web component derives before it returns JSX (web/src/components/charts/AddAnnotationPopover.tsx). No
// Compose, no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is a chart-annotation entry dialog. It is a *controlled* form — its only "hook" is
// `useTranslation` (i18n, P1/S10); it performs no data fetch and owns no store. It collects a short label
// (`maxLength={50}`), a category (one of milestone/maintenance/trip/issue/upgrade/custom, color-coded by
// `ANNOTATION_COLORS`), an optional description (`maxLength={200}`), and — when `editableDate` is set — an editable
// date capped at today; on submit it hands `(label, category, description?, occurredAt)` back to the parent's
// `onAdd` callback and resets. This file owns the data derivations behind that form: the `<input type="date">`
// normalisation (web `toDateInputValue` / `toIsoTimestamp`), the label-required submit guard (web `!label.trim()`),
// the maxLength clamps, the occurred-at resolution (web `editableDate ? toIsoTimestamp(editedDate) : timestamp`), and
// the create-callback assembly (web `onAdd(label.trim(), category, description.trim() || undefined, occurredAt)`).
// The category colors/glyphs and localized labels are resolved at the Compose boundary, never here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/AddAnnotationPopover — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.addannotationpopover

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * The annotation category union the web component offers
 * (`milestone | maintenance | trip | issue | upgrade | custom`, web `AnnotationCategory`). [wire] is the exact
 * lowercase token handed back to the parent's `onAdd` callback and ultimately sent to `POST /annotations`;
 * [colorArgb] mirrors the web `ANNOTATION_COLORS` constant verbatim (0xAARRGGBB, opaque) so the selected pill paints
 * in the same hue on every platform. The human label + glyph are resolved at the Compose boundary (P1/S10, P1/S9).
 */
enum class AnnotationCategory(
    val wire: String,
    val colorArgb: Long,
) {
    Milestone("milestone", 0xFF3B82F6),
    Maintenance("maintenance", 0xFFF59E0B),
    Trip("trip", 0xFF22C55E),
    Issue("issue", 0xFFEF4444),
    Upgrade("upgrade", 0xFFA855F7),
    Custom("custom", 0xFF94A3B8),
    ;

    companion object {
        /** The web component's initial `useState('milestone')` default. */
        val DEFAULT: AnnotationCategory = Milestone

        /** Resolves a [wire] token back to its case (web select `onChange`); unknown tokens fall back to [DEFAULT]. */
        fun fromWire(wire: String): AnnotationCategory = entries.firstOrNull { it.wire == wire } ?: DEFAULT
    }
}

/**
 * The editable form draft the dialog owns — the native mirror of the web component's `useState` fields
 * (`label`, `category`, `description`, `editedDate`). Defaults match the web initial state (empty label/description,
 * `category='milestone'`), so a freshly opened dialog needs only a label typed to become submittable. [editedDate]
 * is seeded at the Compose boundary from the incoming timestamp via [AddAnnotationDates.toDateInputValue].
 */
data class AnnotationDraft(
    val label: String = "",
    val category: AnnotationCategory = AnnotationCategory.DEFAULT,
    val description: String = "",
    val editedDate: String = "",
)

/**
 * The payload handed to the parent's `onAdd` callback on a successful submit — the native mirror of the web
 * `onAdd(label, category, description?, occurredAt)` argument list. [description] is `null` when the user left it
 * blank (web `description.trim() || undefined`); [occurredAt] is a full ISO-8601 instant (web `occurredAt`).
 */
data class AnnotationResult(
    val label: String,
    val category: AnnotationCategory,
    val description: String?,
    val occurredAt: String,
)

/**
 * The `<input type="date">` normalisation helpers the web component declares at module scope
 * (`toDateInputValue` / `toIsoTimestamp`). Pure and clock-free so they are fully covered off-device; the "today"
 * cap the editable field enforces is supplied at the Compose boundary, not here.
 */
object AddAnnotationDates {
    /** The `YYYY-MM-DD` shape `<input type="date">` accepts (web regex `^\d{4}-\d{2}-\d{2}$`). */
    private val ISO_DATE_SHAPE = Regex("""^\d{4}-\d{2}-\d{2}$""")

    /** Each tolerant parser tried in turn, mirroring the breadth of JS `new Date(timestamp)`. */
    private val DATE_PARSERS: List<(String) -> LocalDate> =
        listOf(
            { Instant.parse(it).atZone(ZoneOffset.UTC).toLocalDate() },
            { OffsetDateTime.parse(it).atZoneSameInstant(ZoneOffset.UTC).toLocalDate() },
            { LocalDateTime.parse(it).toLocalDate() },
            { LocalDate.parse(it) },
        )

    /**
     * Normalises any ISO-ish [timestamp] into the `YYYY-MM-DD` value `<input type="date">` expects — the web
     * `toDateInputValue`. A full instant is read in UTC (web `getUTCFullYear`/`getUTCMonth`/`getUTCDate`); an
     * already-`YYYY-MM-DD` value is accepted verbatim; anything unparseable yields an empty string so the field
     * renders empty rather than `NaN` (web fallback).
     */
    fun toDateInputValue(timestamp: String): String {
        if (timestamp.isEmpty()) return ""
        val parsed = parseToUtcDate(timestamp)
        return when {
            parsed != null -> parsed.format(DateTimeFormatter.ISO_LOCAL_DATE)
            ISO_DATE_SHAPE.matches(timestamp) -> timestamp
            else -> ""
        }
    }

    /**
     * The inverse of [toDateInputValue] — pins a `YYYY-MM-DD` [date] to UTC midnight (web `toIsoTimestamp`).
     * Returns an empty string for an empty or non-`YYYY-MM-DD` value, exactly like the web guard.
     */
    fun toIsoTimestamp(date: String): String = if (date.isNotEmpty() && ISO_DATE_SHAPE.matches(date)) "${date}T00:00:00Z" else ""

    /**
     * Converts a `YYYY-MM-DD` [date] to its UTC-midnight epoch-millisecond value, or `null` when the value is empty
     * or malformed. The Compose date-picker seam (the Material 3 `DatePicker`, which works in UTC epoch millis)
     * consumes this to pre-select the seeded date; the inverse is [fromEpochMillis].
     */
    fun toEpochMillis(date: String): Long? =
        if (date.isNotEmpty() && ISO_DATE_SHAPE.matches(date)) {
            runCatching {
                LocalDate
                    .parse(date)
                    .atStartOfDay(ZoneOffset.UTC)
                    .toInstant()
                    .toEpochMilli()
            }.getOrNull()
        } else {
            null
        }

    /** Projects a UTC epoch-millisecond value (the Material 3 date-picker selection) back to a `YYYY-MM-DD` string. */
    fun fromEpochMillis(millis: Long): String =
        Instant
            .ofEpochMilli(millis)
            .atZone(ZoneOffset.UTC)
            .toLocalDate()
            .format(DateTimeFormatter.ISO_LOCAL_DATE)

    private fun parseToUtcDate(value: String): LocalDate? =
        DATE_PARSERS.firstNotNullOfOrNull { parse -> runCatching { parse(value) }.getOrNull() }
}

/**
 * The pure derivations the composable renders over — the native mirror of the web component's inline `handleSubmit`
 * logic. Stateless and side-effect-free, so it is fully covered by the off-device unit gate.
 */
object AddAnnotationProjection {
    /** Maximum label length the input accepts (web `maxLength={50}`). */
    const val MAX_LABEL_LENGTH: Int = 50

    /** Maximum description length the input accepts (web `maxLength={200}`). */
    const val MAX_DESCRIPTION_LENGTH: Int = 200

    /** Whether the trimmed [label] is non-empty — the web submit guard `!label.trim()` (and the disabled Add button). */
    fun isLabelValid(label: String): Boolean = label.trim().isNotEmpty()

    /** Clamps a label edit to the accepted maximum (web `maxLength={50}`). */
    fun clampLabel(label: String): String = label.take(MAX_LABEL_LENGTH)

    /** Clamps a description edit to the accepted maximum (web `maxLength={200}`). */
    fun clampDescription(description: String): String = description.take(MAX_DESCRIPTION_LENGTH)

    /**
     * Resolves the annotation's occurred-at instant — the web `editableDate ? toIsoTimestamp(editedDate) :
     * timestamp`. When the date is editable the (UTC-midnight-pinned) edited date is used; otherwise the incoming
     * chart [timestamp] is passed through unchanged.
     */
    fun resolveOccurredAt(
        editableDate: Boolean,
        editedDate: String,
        timestamp: String,
    ): String = if (editableDate) AddAnnotationDates.toIsoTimestamp(editedDate) else timestamp

    /**
     * Assembles the `onAdd` payload from [draft] — the web `handleSubmit`. Returns `null` for a submit the web
     * component would no-op (a blank label, web `if (!label.trim()) return`; or an unresolved occurred-at, web
     * `if (!occurredAt) return`). The label is trimmed; the description is trimmed and dropped to `null` when blank
     * (web `description.trim() || undefined`).
     */
    fun buildResult(
        draft: AnnotationDraft,
        editableDate: Boolean,
        timestamp: String,
    ): AnnotationResult? {
        if (!isLabelValid(draft.label)) return null
        val occurredAt = resolveOccurredAt(editableDate, draft.editedDate, timestamp)
        return if (occurredAt.isEmpty()) {
            null
        } else {
            AnnotationResult(
                label = draft.label.trim(),
                category = draft.category,
                description = draft.description.trim().ifEmpty { null },
                occurredAt = occurredAt,
            )
        }
    }
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AddAnnotationPopoverRegistration {
    /** Stable surface id. */
    const val ID: String = "add-annotation-popover"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AddAnnotationPopover"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [AddAnnotationPopoverRegistration.SLUG] — never the typed label, description, or annotated timestamp — so a
 * diagnostics line can never leak what the operator is annotating.
 */
object AddAnnotationPopoverDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to AddAnnotationPopoverRegistration.SLUG))
    }
}
