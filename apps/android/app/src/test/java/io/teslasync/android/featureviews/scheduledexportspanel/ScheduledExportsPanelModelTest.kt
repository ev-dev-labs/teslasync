package io.teslasync.android.featureviews.scheduledexportspanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import io.teslasync.shared.core.presentation.exports.ScheduledExportDelivery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device coverage of the pure ScheduledExportsPanel projection — the parity-critical derivations the web
 * component performs before render (web/src/features/system/pages/ScheduledExportsPanel.tsx): the option catalogues
 * (`EXPORT_TYPES` / `FORMATS` / `DELIVERY_KINDS`), the blank form (`emptyInput`), the row -> form flattening
 * (`inputFromRow`), the form -> wire body with the download target-drop (`submit`), the enable/disable payload
 * (`toggleEnabled`), the required-field validation the web enforces via `required`, the row display derivations
 * (type+format, delivery, run status), the ISO-instant parse the next/last-run cells use, and the PII-safe
 * `view.opened` diagnostic. Run by the `:android:testReleaseUnitTest` gate.
 */
class ScheduledExportsPanelModelTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    private val baseRow =
        ScheduledExport(
            id = 1,
            name = "Drives weekly",
            exportType = "drives",
            format = "csv",
            scheduleCron = "0 9 * * 0",
            delivery = ScheduledExportDelivery(kind = "download"),
            rangeWindow = "7d",
            enabled = true,
        )

    @Test
    fun cataloguesMatchWebOrder() {
        assertEquals(listOf("drives", "charging", "trips", "positions", "signals"), SCHEDULED_EXPORT_TYPES)
        assertEquals(listOf("csv", "json"), SCHEDULED_EXPORT_FORMATS)
        assertEquals(listOf("download", "email", "webhook"), SCHEDULED_DELIVERY_KINDS)
    }

    @Test
    fun emptyFormMatchesWebEmptyInput() {
        val form = emptyScheduledExportForm()
        assertEquals("", form.name)
        assertEquals("drives", form.exportType)
        assertEquals("csv", form.format)
        assertEquals("0 9 * * 0", form.scheduleCron)
        assertEquals("download", form.deliveryKind)
        assertEquals("", form.deliveryTarget)
        assertEquals("7d", form.rangeWindow)
        assertTrue(form.enabled)
        assertNull(form.vehicleId)
        assertNull(form.columns)
    }

    @Test
    fun formFromRowFlattensAndPreservesVehicleAndColumns() {
        val source =
            baseRow.copy(
                id = 7,
                name = "Charging monthly",
                exportType = "charging",
                format = "json",
                scheduleCron = "0 0 1 * *",
                delivery = ScheduledExportDelivery(kind = "email", target = "ops@example.com"),
                rangeWindow = "30d",
                enabled = false,
                vehicleId = 42,
                columns = listOf("a", "b"),
            )
        val form = scheduledExportFormFrom(source)
        assertEquals("Charging monthly", form.name)
        assertEquals("charging", form.exportType)
        assertEquals("json", form.format)
        assertEquals("0 0 1 * *", form.scheduleCron)
        assertEquals("email", form.deliveryKind)
        assertEquals("ops@example.com", form.deliveryTarget)
        assertEquals("30d", form.rangeWindow)
        assertFalse(form.enabled)
        assertEquals(42L, form.vehicleId)
        assertEquals(listOf("a", "b"), form.columns)
    }

    @Test
    fun toInputDropsTargetForDownload() {
        val input = toScheduledExportInput(emptyScheduledExportForm().copy(deliveryKind = "download", deliveryTarget = "leftover"))
        assertEquals("download", input.delivery.kind)
        assertNull(input.delivery.target)
    }

    @Test
    fun toInputTrimsTargetForEmailAndWebhook() {
        val email = toScheduledExportInput(emptyScheduledExportForm().copy(deliveryKind = "email", deliveryTarget = "  ops@example.com  "))
        assertEquals("email", email.delivery.kind)
        assertEquals("ops@example.com", email.delivery.target)

        val webhook = toScheduledExportInput(emptyScheduledExportForm().copy(deliveryKind = "webhook", deliveryTarget = "https://x/hook"))
        assertEquals("webhook", webhook.delivery.kind)
        assertEquals("https://x/hook", webhook.delivery.target)
    }

    @Test
    fun toInputCarriesEveryFieldIncludingPreservedVehicleAndColumns() {
        val form =
            emptyScheduledExportForm().copy(
                name = "Drives weekly",
                exportType = "drives",
                format = "csv",
                scheduleCron = "0 9 * * 0",
                rangeWindow = "7d",
                enabled = true,
                vehicleId = 99,
                columns = listOf("speed"),
            )
        val input = toScheduledExportInput(form)
        assertEquals("Drives weekly", input.name)
        assertEquals("drives", input.exportType)
        assertEquals("csv", input.format)
        assertEquals("0 9 * * 0", input.scheduleCron)
        assertEquals("7d", input.rangeWindow)
        assertEquals(true, input.enabled)
        assertEquals(99L, input.vehicleId)
        assertEquals(listOf("speed"), input.columns)
    }

    @Test
    fun toggledInputFlipsEnabledAndPreservesOtherFields() {
        val enabled =
            toggledScheduledExportInput(
                baseRow.copy(
                    id = 3,
                    name = "Trips",
                    exportType = "trips",
                    delivery = ScheduledExportDelivery(kind = "webhook", target = "https://x"),
                ),
            )
        assertEquals(false, enabled.enabled)
        assertEquals("Trips", enabled.name)
        assertEquals("trips", enabled.exportType)
        assertEquals("webhook", enabled.delivery.kind)
        assertEquals("https://x", enabled.delivery.target)

        val disabled = toggledScheduledExportInput(baseRow.copy(enabled = false))
        assertEquals(true, disabled.enabled)
    }

    @Test
    fun deliveryNeedsTargetOnlyForNonDownload() {
        assertFalse(deliveryNeedsTarget("download"))
        assertTrue(deliveryNeedsTarget("email"))
        assertTrue(deliveryNeedsTarget("webhook"))
    }

    @Test
    fun validateFlagsBlankNameFirstThenCronThenTarget() {
        assertEquals(ScheduledExportFormError.NameRequired, validateScheduledExportForm(emptyScheduledExportForm().copy(name = "  ")))
        assertEquals(
            ScheduledExportFormError.CronRequired,
            validateScheduledExportForm(emptyScheduledExportForm().copy(name = "ok", scheduleCron = " ")),
        )
        assertEquals(
            ScheduledExportFormError.DeliveryTargetRequired,
            validateScheduledExportForm(emptyScheduledExportForm().copy(name = "ok", deliveryKind = "email", deliveryTarget = "")),
        )
        assertNull(validateScheduledExportForm(emptyScheduledExportForm().copy(name = "ok")))
        assertNull(
            validateScheduledExportForm(
                emptyScheduledExportForm().copy(name = "ok", deliveryKind = "webhook", deliveryTarget = "https://x"),
            ),
        )
    }

    @Test
    fun runStatusMapsOkFailedAndUnknown() {
        assertEquals(ScheduledRunStatus.Ok, scheduledRunStatus("ok"))
        assertEquals(ScheduledRunStatus.Failed, scheduledRunStatus("failed"))
        assertEquals(ScheduledRunStatus.Unknown, scheduledRunStatus(null))
        assertEquals(ScheduledRunStatus.Unknown, scheduledRunStatus("queued"))
    }

    @Test
    fun typeFormatLabelMatchesWeb() {
        assertEquals("drives (csv)", typeFormatLabel(baseRow.copy(exportType = "drives", format = "csv")))
        assertEquals("charging (json)", typeFormatLabel(baseRow.copy(exportType = "charging", format = "json")))
    }

    @Test
    fun deliveryLabelShowsKindAndOptionalTarget() {
        assertEquals("download", deliveryLabel(ScheduledExportDelivery(kind = "download")))
        assertEquals("download", deliveryLabel(ScheduledExportDelivery(kind = "download", target = "")))
        assertEquals("email \u2192 ops@example.com", deliveryLabel(ScheduledExportDelivery(kind = "email", target = "ops@example.com")))
    }

    @Test
    fun parseInstantMillisParsesIsoAndFallsBackToNull() {
        assertEquals(Instant.parse("2024-04-04T09:00:00Z").toEpochMilli(), parseInstantMillis("2024-04-04T09:00:00Z"))
        assertEquals(Instant.parse("2024-04-04T09:00:00Z").toEpochMilli(), parseInstantMillis("  2024-04-04T09:00:00Z  "))
        assertNull(parseInstantMillis(null))
        assertNull(parseInstantMillis(""))
        assertNull(parseInstantMillis("   "))
        assertNull(parseInstantMillis("not-a-timestamp"))
    }

    @Test
    fun recordViewOpenedEmitsSlugOnce() {
        val logger = RecordingLogger()
        recordScheduledExportsViewOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ScheduledExportsPanel"), opened.single().second)
        assertEquals("ScheduledExportsPanel", ScheduledExportsPanelRegistration.SLUG)
        assertEquals("scheduled-exports-panel", ScheduledExportsPanelRegistration.ID)
    }
}
