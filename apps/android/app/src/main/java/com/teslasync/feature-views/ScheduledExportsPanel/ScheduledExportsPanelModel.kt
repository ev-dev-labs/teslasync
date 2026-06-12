// Pure, framework-light model + projection for the ScheduledExportsPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/pages/ScheduledExportsPanel.tsx). Every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component owns the recurring-export control plane: a table of the user's schedules (web
// `useScheduledExports`) with per-row Run-now / Enable-Disable / Edit / Delete, and an inline create/edit form
// (name, cron, export type, format, range window, delivery kind, delivery target). This file owns the parity-critical
// derivations that have nothing to do with Compose: the option catalogues (web `EXPORT_TYPES` / `FORMATS` /
// `DELIVERY_KINDS`), the blank form (web `emptyInput`), the row -> form flattening (web `inputFromRow`), the
// form -> `ScheduledExportInput` wire builder with the download target-drop (web `submit`), the enable/disable
// payload (web `toggleEnabled`), the minimal required-field validation the web enforces via the `required`
// attributes, the row display derivations (type+format, delivery, run status), the ISO-instant parse the table's
// next/last-run cells need, and the typed mutation-failure toast. It also pins the PII-safe `view.opened` diagnostic.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/feature-views/ScheduledExportsPanel — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package and hosts several co-located declarations, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.scheduledexportspanel

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import io.teslasync.shared.core.presentation.exports.ScheduledExportDelivery
import io.teslasync.shared.core.presentation.exports.ScheduledExportInput
import java.time.Instant

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ScheduledExportsPanelRegistration {
    /** Stable surface id. */
    const val ID: String = "scheduled-exports-panel"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ScheduledExportsPanel"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ScheduledExportsPanelRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable / view-model calls
 * it from the first-composition effect. It carries no schedule name, cron, or delivery target, so a diagnostics
 * line can never leak what a user has configured.
 */
fun recordScheduledExportsViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ScheduledExportsPanelRegistration.SLUG))
}

/** The `download` delivery kind — the only one that drops its target on write (web `submit`). */
const val DELIVERY_DOWNLOAD: String = "download"

/** The default weekly-Sunday cron a fresh schedule starts with — the web `emptyInput` `schedule_cron`. */
const val DEFAULT_SCHEDULE_CRON: String = "0 9 * * 0"

/** The default relative range window a fresh schedule starts with — the web `emptyInput` `range_window`. */
const val DEFAULT_RANGE_WINDOW: String = "7d"

/**
 * The export-type options the form offers, in the web order — the native mirror of the web `EXPORT_TYPES`
 * (`drives | charging | trips | positions | signals`). These are backend enum values rendered verbatim (the web
 * `options={EXPORT_TYPES.map((opt) => ({ value: opt, label: opt }))}` uses the raw value as the label), so they
 * are not translatable prose.
 */
val SCHEDULED_EXPORT_TYPES: List<String> = listOf("drives", "charging", "trips", "positions", "signals")

/** The format options the form offers — the web `FORMATS` (`csv | json`), rendered verbatim as the web does. */
val SCHEDULED_EXPORT_FORMATS: List<String> = listOf("csv", "json")

/** The delivery-kind options the form offers — the web `DELIVERY_KINDS` (`download | email | webhook`), verbatim. */
val SCHEDULED_DELIVERY_KINDS: List<String> = listOf(DELIVERY_DOWNLOAD, "email", "webhook")

/**
 * The transient state of the create/edit form — the native mirror of the web `ScheduledExportInput` plus the
 * editing id. [vehicleId] and [columns] carry no form field on this panel (exactly as the web form omits them) but
 * are preserved across an edit so the round-trip never silently clears them (web `inputFromRow`).
 */
data class ScheduledExportForm(
    val name: String = "",
    val exportType: String = "drives",
    val format: String = "csv",
    val scheduleCron: String = DEFAULT_SCHEDULE_CRON,
    val deliveryKind: String = DELIVERY_DOWNLOAD,
    val deliveryTarget: String = "",
    val rangeWindow: String = DEFAULT_RANGE_WINDOW,
    val enabled: Boolean = true,
    val vehicleId: Long? = null,
    val columns: List<String>? = null,
)

/** The blank create form — the web `emptyInput()`. */
fun emptyScheduledExportForm(): ScheduledExportForm = ScheduledExportForm()

/**
 * Flattens a loaded [row] into the editable [ScheduledExportForm] — the native mirror of the web `inputFromRow`.
 * The download/email/webhook target collapses a null to a blank string for the text field; [vehicleId]/[columns]
 * are preserved so an edit cannot silently drop them.
 */
fun scheduledExportFormFrom(row: ScheduledExport): ScheduledExportForm =
    ScheduledExportForm(
        name = row.name,
        exportType = row.exportType,
        format = row.format,
        scheduleCron = row.scheduleCron,
        deliveryKind = row.delivery.kind,
        deliveryTarget = row.delivery.target ?: "",
        rangeWindow = row.rangeWindow,
        enabled = row.enabled,
        vehicleId = row.vehicleId,
        columns = row.columns,
    )

/**
 * Builds the create/update wire body from [form] — the native mirror of the web `submit`. The delivery target is
 * dropped for `download` (the web `delivery.kind === 'download' ? { kind: 'download' } : { kind, target: trim() }`)
 * so an unused string is never round-tripped; for email/webhook the target is trimmed. Every other field is sent
 * verbatim (the server normalizes name/cron), matching the web's deliberately minimal client handling.
 */
fun toScheduledExportInput(form: ScheduledExportForm): ScheduledExportInput =
    ScheduledExportInput(
        name = form.name,
        exportType = form.exportType,
        format = form.format,
        vehicleId = form.vehicleId,
        columns = form.columns,
        scheduleCron = form.scheduleCron,
        delivery =
            if (form.deliveryKind == DELIVERY_DOWNLOAD) {
                ScheduledExportDelivery(kind = DELIVERY_DOWNLOAD)
            } else {
                ScheduledExportDelivery(kind = form.deliveryKind, target = form.deliveryTarget.trim())
            },
        rangeWindow = form.rangeWindow,
        enabled = form.enabled,
    )

/**
 * The enable/disable payload for [row] — the native mirror of the web `toggleEnabled`
 * (`{ ...inputFromRow(row), enabled: !row.enabled }`): the existing row flattened back to its input, with the
 * enabled flag flipped, so a toggle preserves every other field.
 */
fun toggledScheduledExportInput(row: ScheduledExport): ScheduledExportInput =
    toScheduledExportInput(scheduledExportFormFrom(row).copy(enabled = !row.enabled))

/** Whether the form's delivery kind needs a target field — the web `form.delivery.kind !== 'download'` branch. */
fun deliveryNeedsTarget(deliveryKind: String): Boolean = deliveryKind != DELIVERY_DOWNLOAD

/** The inline required-field failures the web enforces via the `required` attributes, in the web's field order. */
enum class ScheduledExportFormError { NameRequired, CronRequired, DeliveryTargetRequired }

/**
 * Validates the form the way the web's `required` attributes do: a blank name fails first, then a blank cron, then
 * a blank delivery target when the kind is not `download`. `null` means the form may be submitted. Validation is
 * deliberately minimal — the server (NormalizeScheduledExportInput) validates everything else (web file header).
 */
fun validateScheduledExportForm(form: ScheduledExportForm): ScheduledExportFormError? =
    when {
        form.name.isBlank() -> ScheduledExportFormError.NameRequired
        form.scheduleCron.isBlank() -> ScheduledExportFormError.CronRequired
        deliveryNeedsTarget(form.deliveryKind) && form.deliveryTarget.isBlank() -> ScheduledExportFormError.DeliveryTargetRequired
        else -> null
    }

/** The run-status a row's badge reflects — the web `last_status` mapping (`ok` / `failed` / neither). */
enum class ScheduledRunStatus { Ok, Failed, Unknown }

/** Classifies a row's `last_status` string — the web `row.last_status === 'ok' ? … : 'failed' ? … : '—'`. */
fun scheduledRunStatus(lastStatus: String?): ScheduledRunStatus =
    when (lastStatus) {
        "ok" -> ScheduledRunStatus.Ok
        "failed" -> ScheduledRunStatus.Failed
        else -> ScheduledRunStatus.Unknown
    }

/** The "type (format)" cell — the web `{row.export_type} ({row.format})`. */
fun typeFormatLabel(row: ScheduledExport): String = "${row.exportType} (${row.format})"

/**
 * The delivery cell — the web `{row.delivery.kind}{row.delivery.target ? ` → ${target}` : ''}`. A blank/null
 * target renders just the kind; otherwise the kind, a right-arrow, and the target.
 */
fun deliveryLabel(delivery: ScheduledExportDelivery): String {
    val target = delivery.target
    return if (target.isNullOrEmpty()) delivery.kind else "${delivery.kind} \u2192 $target"
}

/**
 * Parses an ISO-8601 instant string to epoch milliseconds for the next/last-run cells — `null` for a null/blank or
 * unparseable value (the web `<TimeStamp>` renders the "—" fallback for the same inputs). Pure so the table's time
 * handling is unit-tested off device; the composable formats the millis with the device locale + zone.
 */
fun parseInstantMillis(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.parse(iso.trim()).toEpochMilli() }.getOrNull()
}

/**
 * One transient toast a schedule mutation raises on failure — the typed, i18n-key-free analogue of the global
 * error toast the web mutation hooks surface (the panel's own success feedback is the form closing + the list
 * refreshing, exactly as the web `submit` / `toggleEnabled` do, so there is no success variant here). The render
 * boundary maps this to a localized [io.teslasync.android.components.feedback.ToastItem]; it carries no schedule
 * name, cron, or delivery target, so a toast can never leak what a user configured.
 */
sealed interface ScheduledExportToast {
    /** A run-now / enable-disable / delete mutation failed — surfaced with the shared server-error copy. */
    data object ActionFailed : ScheduledExportToast
}
