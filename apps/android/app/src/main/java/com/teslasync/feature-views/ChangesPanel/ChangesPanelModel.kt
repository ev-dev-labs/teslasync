// Pure, framework-free model + projection for the ChangesPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/feature-flags/ChangesPanel.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent (the Feature-Flags page, `useFlagChanges`) loads
// the `FeatureFlagChange[]` and passes it down with a `loading` flag and an optional `scopedKey`. This file
// owns the parts the web column renderers + `compact()` helper compute from those props: the operation →
// semantic-tone classification (web `OP_VARIANT`), the actor/reason "—" fallbacks (web `value || '—'`), the
// `compact()` JSON preview (stringify, 60-char cap, "…" suffix, null → "—"), and the `changed_at` timestamp
// formatting (web `<TimeStamp format="absolute" />`). It binds the shared P1/S8 `FeatureFlagChange` wire
// model verbatim — no re-declaration — so the cached payload flows straight through.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChangesPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.changespanel

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.featureflags.FeatureFlagChange
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown for a null value or a blank actor/reason — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Single-character horizontal ellipsis appended to a truncated value preview — the web `'…'`. */
internal const val ELLIPSIS: String = "\u2026"

/** Web `compact()` truncation gate: stringified values longer than this are clipped. */
internal const val COMPACT_MAX_LENGTH: Int = 60

/** Web `compact()` retained-prefix length before the ellipsis (`s.slice(0, 57) + '…'`). */
internal const val COMPACT_KEEP_LENGTH: Int = 57

/** Compact (non-pretty) JSON, matching the web `JSON.stringify(value)` preview with no spacing. */
private val COMPACT_JSON: Json = Json.Default

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ChangesPanelRegistration {
    /** Stable surface id. */
    const val ID: String = "changes-panel"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); carries no flag payload. */
    const val SLUG: String = "ChangesPanel"
}

/**
 * The semantic tone of a flag-change operation — the native analogue of the web
 * `OP_VARIANT: Record<FeatureFlagOperation, 'success' | 'danger'>` plus its `?? 'neutral'` fallback. The
 * composable maps each case to a [io.teslasync.android.components.ui.BadgeVariant]; the raw operation string
 * remains the badge label (web renders `{row.operation}`).
 */
enum class OperationTone {
    /** A `set` write — web `success`. */
    Positive,

    /** A `delete` write — web `danger`. */
    Negative,

    /** Any other/unknown operation — web `?? 'neutral'`. */
    Neutral,
}

/**
 * One fully projected, render-ready audit row — the native analogue of a single web `DataTable` row after
 * its per-column renderers have run. Pure data (no Compose types) so the projection is unit-tested without a
 * UI host: [changedAt] is already formatted by the caller's locale/zone, [oldValue]/[newValue] are already
 * `compact()`-ed, [actor]/[reason] already carry the "—" fallback, and [tone] classifies [operation] for the
 * badge. [id] is the stable row key (web `keyExtractor={(row) => row.id}`).
 */
@Suppress("LongParameterList") // A render-ready row mirrors the web table's seven columns plus its key.
data class FlagChangeRow(
    val id: Long,
    val changedAt: String,
    val actor: String,
    val flagKey: String,
    val operation: String,
    val tone: OperationTone,
    val oldValue: String,
    val newValue: String,
    val reason: String,
)

/**
 * Already-localized column-header microcopy — the web `t('admin.flags.audit.cols.*')` keys. The composable
 * resolves these through the P1/S10 i18n facade (`stringResource`) and passes them in; tests pass a
 * deterministic instance, keeping the surface free of any English literal.
 */
data class ChangesPanelColumnLabels(
    val changedAt: String,
    val actor: String,
    val flagKey: String,
    val operation: String,
    val oldValue: String,
    val newValue: String,
    val reason: String,
)

/**
 * Already-localized empty/loading microcopy — the web `t('admin.flags.audit.empty.*')` /
 * `t('admin.flags.audit.loading')` keys. [scopedMessage] is a lambda so the composable resolves the `%1$s`
 * flag-key argument through `Context.getString` (web `{{key}}` interpolation); tests pass a deterministic
 * one.
 */
data class ChangesPanelEmptyLabels(
    val title: String,
    val globalMessage: String,
    val loadingLabel: String,
    val scopedMessage: (key: String) -> String,
)

/**
 * The localized microcopy the surface renders — the column headers plus the empty/loading strings. The
 * composable builds this from `stringResource`/`Context.getString`; tests pass a deterministic instance.
 */
data class ChangesPanelStrings(
    val columns: ChangesPanelColumnLabels,
    val empty: ChangesPanelEmptyLabels,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-column render
 * functions and `compact()` helper. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate.
 */
object ChangesPanelProjection {
    /**
     * Classifies an [operation] into its badge [OperationTone] — web `OP_VARIANT[op] ?? 'neutral'`: `set` is
     * positive (success), `delete` is negative (danger), anything else folds to neutral.
     */
    fun toneFor(operation: String): OperationTone =
        when (operation) {
            "set" -> OperationTone.Positive
            "delete" -> OperationTone.Negative
            else -> OperationTone.Neutral
        }

    /** A non-empty value, else the em-dash fallback — web `value || '—'` (JS treats `""` as falsy). */
    fun orDash(value: String): String = value.ifEmpty { EM_DASH }

    /**
     * The compact one-line JSON preview of a flag value — the native port of the web `compact(value)`: a JSON
     * `null` (kotlinx [JsonNull]) renders the em-dash (web `value == null`), otherwise the value is stringified
     * (web `JSON.stringify`) and, when longer than [COMPACT_MAX_LENGTH], clipped to [COMPACT_KEEP_LENGTH]
     * characters plus the [ELLIPSIS] (web `s.slice(0, 57) + '…'`).
     */
    fun compact(value: JsonElement): String {
        if (value is JsonNull) return EM_DASH
        val serialized = COMPACT_JSON.encodeToString(JsonElement.serializer(), value)
        return if (serialized.length > COMPACT_MAX_LENGTH) {
            serialized.substring(0, COMPACT_KEEP_LENGTH) + ELLIPSIS
        } else {
            serialized
        }
    }

    /**
     * Projects the loaded [rows] into render-ready [FlagChangeRow]s, preserving order. Each field is mapped
     * exactly as the matching web column renderer does — the actor/reason "—" fallback, the operation tone,
     * the `compact()` value previews — and [formatTime] formats `changed_at` (injecting it keeps this function
     * locale/zone-deterministic for tests; the composable supplies the real localized formatter). An empty
     * input yields no rows so the composable shows the empty state.
     */
    fun project(
        rows: List<FeatureFlagChange>,
        formatTime: (changedAt: String) -> String,
    ): List<FlagChangeRow> =
        rows.map { row ->
            FlagChangeRow(
                id = row.id,
                changedAt = formatTime(row.changedAt),
                actor = orDash(row.actor),
                flagKey = row.flagKey,
                operation = row.operation,
                tone = toneFor(row.operation),
                oldValue = compact(row.oldValue),
                newValue = compact(row.newValue),
                reason = orDash(row.reason),
            )
        }
}

/**
 * Tolerant ISO-8601 → localized "medium date, short time" formatter — the native analogue of the web
 * `<TimeStamp format="absolute" />` (`toLocaleString` with `{year, month:'short', day, hour, minute}`). Pure
 * (java.time only) so it is unit-tested deterministically with a fixed zone/locale. A blank or unparseable
 * input yields [EM_DASH], exactly like the web component's invalid-date guard.
 */
object ChangesPanelTimeFormatting {
    fun format(
        changedAt: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(changedAt) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields the em-dash guard above.
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ChangesPanelRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordChangesPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChangesPanelRegistration.SLUG))
}
