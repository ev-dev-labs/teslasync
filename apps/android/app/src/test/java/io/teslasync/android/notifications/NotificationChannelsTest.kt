package io.teslasync.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the [NotificationChannels] taxonomy and [NotificationKind] → channel routing
 * (P3/A6). Verifies the channel set is complete, every kind maps to a real channel, and the
 * hint/category override reaches channels (such as maintenance) with no dedicated kind.
 */
class NotificationChannelsTest {
    @Test
    fun theTaxonomyHasSevenUniqueChannels() {
        assertEquals(7, NotificationChannels.all.size)
        assertEquals(7, NotificationChannels.ids.size)
    }

    @Test
    fun everyKindMapsToARealChannel() {
        NotificationKind.entries.forEach { kind ->
            assertTrue(NotificationChannels.channelIdFor(kind) in NotificationChannels.ids)
        }
    }

    @Test
    fun kindsRouteToTheirHomeChannel() {
        assertEquals(NotificationChannels.CRITICAL_ALERTS, NotificationChannels.channelIdFor(NotificationKind.Alert))
        assertEquals(NotificationChannels.CRITICAL_ALERTS, NotificationChannels.channelIdFor(NotificationKind.ReauthNeeded))
        assertEquals(NotificationChannels.VEHICLE_EVENTS, NotificationChannels.channelIdFor(NotificationKind.VehicleState))
        assertEquals(NotificationChannels.CHARGING, NotificationChannels.channelIdFor(NotificationKind.ChargeComplete))
        assertEquals(NotificationChannels.AUTOMATION, NotificationChannels.channelIdFor(NotificationKind.Automation))
        assertEquals(NotificationChannels.SYSTEM, NotificationChannels.channelIdFor(NotificationKind.SystemIncident))
        assertEquals(NotificationChannels.GENERAL, NotificationChannels.channelIdFor(NotificationKind.Generic))
    }

    @Test
    fun anExplicitChannelIdHintWins() {
        assertEquals(
            NotificationChannels.CHARGING,
            NotificationChannels.channelIdFor(NotificationKind.Generic, NotificationChannels.CHARGING),
        )
    }

    @Test
    fun aCategoryHintReachesTheMaintenanceChannel() {
        assertEquals(NotificationChannels.MAINTENANCE, NotificationChannels.channelIdFor(NotificationKind.Generic, "maintenance"))
        assertEquals(NotificationChannels.MAINTENANCE, NotificationChannels.channelIdFor(NotificationKind.Generic, "software_update"))
    }

    @Test
    fun anUnknownHintFallsBackToTheKindHomeChannel() {
        assertEquals(
            NotificationChannels.CRITICAL_ALERTS,
            NotificationChannels.channelIdFor(NotificationKind.Alert, "nonsense"),
        )
    }
}
