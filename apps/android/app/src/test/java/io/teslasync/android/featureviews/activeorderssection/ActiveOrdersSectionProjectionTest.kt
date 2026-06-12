package io.teslasync.android.featureviews.activeorderssection

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaOrder
import io.teslasync.shared.core.presentation.user.TeslaOrdersEnvelope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the ActiveOrdersSection's pure logic — the native analogue of the web component's
 * inline derivations (web/src/features/settings/components/ActiveOrdersSection.tsx): the status-badge variant
 * (web `orderStatusVariant`), the humanized status label (web `formatOrderStatus`), the model fallback
 * (web `order.model || '—'`), the optional VIN / delivery-date / upgradable guards, the localized "Synced"
 * stamp (web `formatDateTime`), the localized delivery date (web `useDateFormat().formatDate`), the empty /
 * fetched guards, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class ActiveOrdersSectionProjectionTest {
    private val zoneUtc: ZoneId = ZoneId.of("UTC")

    @Suppress("LongParameterList") // test data builder; production TeslaOrder is a data class
    private fun order(
        id: Long = 1,
        orderId: String = "RN123",
        model: String = "Model 3",
        status: String = "BOOKED",
        deliveryDate: String? = null,
        vin: String? = null,
        isUpgradable: Boolean = false,
        fetchedAt: String = "2026-06-12T14:30:00Z",
    ): TeslaOrder =
        TeslaOrder(
            id = id,
            orderId = orderId,
            model = model,
            status = status,
            deliveryDate = deliveryDate,
            vin = vin,
            isUpgradable = isUpgradable,
            fetchedAt = fetchedAt,
        )

    // ── Status variant (web orderStatusVariant precedence) ──────────────────────────

    @Test
    fun statusKindMatchesWebOrderStatusVariantPrecedence() {
        assertEquals(OrderStatusKind.Delivered, OrderStatusKind.from("DELIVERED"))
        assertEquals(OrderStatusKind.Delivered, OrderStatusKind.from("delivery_complete"))
        assertEquals(OrderStatusKind.InTransit, OrderStatusKind.from("READY_FOR_TRANSPORT"))
        assertEquals(OrderStatusKind.InTransit, OrderStatusKind.from("IN_TRANSPORT"))
        assertEquals(OrderStatusKind.Cancelled, OrderStatusKind.from("CANCELLED"))
        assertEquals(OrderStatusKind.Cancelled, OrderStatusKind.from("REJECTED"))
        assertEquals(OrderStatusKind.Pending, OrderStatusKind.from("PENDING"))
        assertEquals(OrderStatusKind.Pending, OrderStatusKind.from("ORDER_PLACED"))
        assertEquals(OrderStatusKind.Neutral, OrderStatusKind.from("SOMETHING_ELSE"))
    }

    @Test
    fun statusKindIsNeutralForNullOrBlank() {
        assertEquals(OrderStatusKind.Neutral, OrderStatusKind.from(null))
        assertEquals(OrderStatusKind.Neutral, OrderStatusKind.from("   "))
    }

    // ── Humanized status label (web formatOrderStatus) ──────────────────────────────

    @Test
    fun formatStatusTitleCasesAndReplacesUnderscores() {
        assertEquals("Ready For Transport", ActiveOrdersProjection.formatStatus("READY_FOR_TRANSPORT"))
        assertEquals("Booked", ActiveOrdersProjection.formatStatus("booked"))
    }

    @Test
    fun formatStatusReturnsEmDashForNullOrBlank() {
        assertEquals(EM_DASH, ActiveOrdersProjection.formatStatus(null))
        assertEquals(EM_DASH, ActiveOrdersProjection.formatStatus(""))
    }

    // ── Synced stamp (web formatDateTime) ───────────────────────────────────────────

    @Test
    fun formatSyncedRendersLocalizedDateTimeForValidIso() {
        val formatted = ActiveOrdersProjection.formatSynced("2026-06-12T14:30:00Z", zoneUtc, Locale.US)
        assertTrue("expected a real date, got '$formatted'", formatted != EM_DASH)
        assertTrue("expected the year, got '$formatted'", formatted.contains("2026"))
        assertTrue("expected the short month, got '$formatted'", formatted.contains("Jun"))
    }

    @Test
    fun formatSyncedReturnsEmDashForNullBlankOrUnparseable() {
        assertEquals(EM_DASH, ActiveOrdersProjection.formatSynced(null, zoneUtc, Locale.US))
        assertEquals(EM_DASH, ActiveOrdersProjection.formatSynced("", zoneUtc, Locale.US))
        assertEquals(EM_DASH, ActiveOrdersProjection.formatSynced("nonsense", zoneUtc, Locale.US))
    }

    // ── Delivery date (web useDateFormat().formatDate) ──────────────────────────────

    @Test
    fun formatDeliveryDateRendersLocalizedDateForCalendarDate() {
        val formatted = ActiveOrdersProjection.formatDeliveryDate("2026-07-15", zoneUtc, Locale.US)
        assertTrue("expected the year, got '$formatted'", formatted.contains("2026"))
        assertTrue("expected the short month, got '$formatted'", formatted.contains("Jul"))
    }

    @Test
    fun formatDeliveryDateRendersLocalizedDateForFullTimestamp() {
        val formatted = ActiveOrdersProjection.formatDeliveryDate("2026-07-15T09:00:00Z", zoneUtc, Locale.US)
        assertTrue("expected the year, got '$formatted'", formatted.contains("2026"))
        assertTrue("expected the short month, got '$formatted'", formatted.contains("Jul"))
    }

    @Test
    fun formatDeliveryDateFallsBackToRawWhenPresentButUnparseable() {
        assertEquals("TBD", ActiveOrdersProjection.formatDeliveryDate("TBD", zoneUtc, Locale.US))
    }

    @Test
    fun formatDeliveryDateReturnsEmDashForBlank() {
        assertEquals(EM_DASH, ActiveOrdersProjection.formatDeliveryDate(null, zoneUtc, Locale.US))
        assertEquals(EM_DASH, ActiveOrdersProjection.formatDeliveryDate("  ", zoneUtc, Locale.US))
    }

    // ── Empty / fetched guards (web (orders ?? []).length > 0 / fetched_at) ──────────

    @Test
    fun isEmptyReflectsTheEnvelope() {
        assertTrue(ActiveOrdersProjection.isEmpty(null))
        assertTrue(ActiveOrdersProjection.isEmpty(TeslaOrdersEnvelope(orders = emptyList(), fetchedAt = "2026-06-12T14:30:00Z")))
        assertFalse(ActiveOrdersProjection.isEmpty(TeslaOrdersEnvelope(orders = listOf(order()), fetchedAt = null)))
    }

    @Test
    fun hasFetchedReflectsTheEnvelope() {
        assertFalse(ActiveOrdersProjection.hasFetched(null))
        assertFalse(ActiveOrdersProjection.hasFetched(TeslaOrdersEnvelope(orders = emptyList(), fetchedAt = null)))
        assertTrue(ActiveOrdersProjection.hasFetched(TeslaOrdersEnvelope(orders = emptyList(), fetchedAt = "2026-06-12T14:30:00Z")))
    }

    // ── Per-order projection ─────────────────────────────────────────────────────────

    @Test
    fun projectOrderMapsAllRenderReadyFields() {
        val view =
            ActiveOrdersProjection.projectOrder(
                order(
                    orderId = "RN999",
                    model = "Model Y",
                    status = "READY_FOR_DELIVERY",
                    deliveryDate = "2026-07-15",
                    vin = "5YJ3E1EA7PF000000",
                    isUpgradable = true,
                ),
                zoneUtc,
                Locale.US,
            )

        assertEquals("RN999", view.orderId)
        assertEquals("Model Y", view.model)
        assertEquals(OrderStatusKind.Delivered, view.statusKind)
        assertEquals("Ready For Delivery", view.statusLabel)
        assertEquals("5YJ3E1EA7PF000000", view.vin)
        assertTrue(view.hasVin)
        assertTrue(view.hasDeliveryDate)
        assertTrue(view.deliveryDateLabel?.contains("2026") == true)
        assertTrue(view.isUpgradable)
    }

    @Test
    fun projectOrderFallsBackToEmDashModelAndHidesOptionalRows() {
        val view = ActiveOrdersProjection.projectOrder(order(model = "", vin = null, deliveryDate = null), zoneUtc, Locale.US)

        assertEquals(EM_DASH, view.model)
        assertFalse(view.hasVin)
        assertNull(view.vin)
        assertFalse(view.hasDeliveryDate)
        assertNull(view.deliveryDateLabel)
        assertFalse(view.isUpgradable)
    }

    @Test
    fun ordersPreservesReceivedOrder() {
        val envelope =
            TeslaOrdersEnvelope(
                orders = listOf(order(orderId = "A", model = "Model 3"), order(orderId = "B", model = "Model X")),
                fetchedAt = "2026-06-12T14:30:00Z",
            )
        val views = ActiveOrdersProjection.orders(envelope, zoneUtc, Locale.US)
        assertEquals(listOf("A", "B"), views.map { it.orderId })
        assertEquals(listOf("Model 3", "Model X"), views.map { it.model })
    }

    @Test
    fun ordersIsEmptyForNullEnvelope() {
        assertTrue(ActiveOrdersProjection.orders(null, zoneUtc, Locale.US).isEmpty())
    }

    // ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordActiveOrdersSectionOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ActiveOrdersSection"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("active-orders-section", ActiveOrdersSectionRegistration.ID)
        assertEquals("ActiveOrdersSection", ActiveOrdersSectionRegistration.SLUG)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
