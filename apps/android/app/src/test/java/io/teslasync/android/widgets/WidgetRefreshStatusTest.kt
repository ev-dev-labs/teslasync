package io.teslasync.android.widgets

import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.shared.core.data.repo.Resource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * JVM unit tests for the pure widget background-refresh reducers extracted from [WidgetRefresher]
 * (P3/A8, ADR-009/013): the per-feed sync-status mapping, the most-optimistic multi-feed reduction, the
 * charging widget's vehicles-list fallback, and the target-vehicle resolution. These run without the
 * network or WorkManager — only the reducer rules are exercised.
 */
class WidgetRefreshStatusTest {
    @Test
    fun syncStatusOfMapsEachTerminalResource() {
        assertEquals(WidgetSyncStatus.Ok, widgetSyncStatusOf(Resource.Success("v", 1L, false)))
        assertEquals(
            WidgetSyncStatus.FailedWithCache,
            widgetSyncStatusOf(Resource.Error("cached", 1L, true, RuntimeException("x"))),
        )
        assertEquals(
            WidgetSyncStatus.FailedNoCache,
            widgetSyncStatusOf(Resource.Error<String>(null, null, false, RuntimeException("x"))),
        )
        assertEquals(WidgetSyncStatus.Unknown, widgetSyncStatusOf(Resource.Loading<String>(null, null, false)))
    }

    @Test
    fun reduceFavorsOkThenOfflineThenErrorThenUnknown() {
        assertEquals(
            WidgetSyncStatus.Ok,
            reduceWidgetSyncStatus(listOf(WidgetSyncStatus.FailedNoCache, WidgetSyncStatus.Ok)),
        )
        assertEquals(
            WidgetSyncStatus.FailedWithCache,
            reduceWidgetSyncStatus(listOf(WidgetSyncStatus.FailedNoCache, WidgetSyncStatus.FailedWithCache)),
        )
        assertEquals(
            WidgetSyncStatus.FailedNoCache,
            reduceWidgetSyncStatus(listOf(WidgetSyncStatus.FailedNoCache, WidgetSyncStatus.Unknown)),
        )
        assertEquals(WidgetSyncStatus.Unknown, reduceWidgetSyncStatus(emptyList()))
    }

    @Test
    fun chargingFallsBackToVehiclesStatusWhenItsOwnFeedsAreUnknown() {
        assertEquals(
            WidgetSyncStatus.FailedWithCache,
            chargingWidgetSyncStatus(null, null, fallback = WidgetSyncStatus.FailedWithCache),
        )
        assertEquals(
            WidgetSyncStatus.Ok,
            chargingWidgetSyncStatus(WidgetSyncStatus.Ok, null, fallback = WidgetSyncStatus.FailedNoCache),
        )
        assertEquals(
            WidgetSyncStatus.Unknown,
            chargingWidgetSyncStatus(WidgetSyncStatus.Unknown, null, fallback = WidgetSyncStatus.Unknown),
        )
    }

    @Test
    fun resolveIdPrefersSelectedThenFirstThenBareId() {
        val list = listOf(vehicle(1), vehicle(2), vehicle(3))

        assertEquals(2L, resolveWidgetVehicleId(list, selectedId = 2L))
        // Selected id no longer enrolled ⇒ first enrolled vehicle.
        assertEquals(1L, resolveWidgetVehicleId(list, selectedId = 99L))
        assertEquals(1L, resolveWidgetVehicleId(list, selectedId = null))
        // Cold cache: no vehicles yet but a remembered id ⇒ still refresh that id.
        assertEquals(7L, resolveWidgetVehicleId(emptyList(), selectedId = 7L))
        assertNull(resolveWidgetVehicleId(emptyList(), selectedId = null))
        assertNull(resolveWidgetVehicleId(null, selectedId = null))
    }
}
