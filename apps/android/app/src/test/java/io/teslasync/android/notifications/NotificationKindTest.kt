package io.teslasync.android.notifications

import org.junit.Assert.assertEquals
import org.junit.Test

/** JVM unit tests for [NotificationKinds] — tolerant, case-insensitive wire-token parsing. */
class NotificationKindTest {
    @Test
    fun parsesCanonicalAndSynonymTokens() {
        assertEquals(NotificationKind.Alert, NotificationKinds.parse("alert"))
        assertEquals(NotificationKind.Alert, NotificationKinds.parse("alert_rule"))
        assertEquals(NotificationKind.ChargeComplete, NotificationKinds.parse("charging_complete"))
        assertEquals(NotificationKind.VehicleState, NotificationKinds.parse("fsm"))
        assertEquals(NotificationKind.ReauthNeeded, NotificationKinds.parse("auth_required"))
    }

    @Test
    fun parseIsCaseInsensitiveAndTrims() {
        assertEquals(NotificationKind.Automation, NotificationKinds.parse("  AUTOMATION  "))
    }

    @Test
    fun unknownEmptyOrNullResolvesToGeneric() {
        assertEquals(NotificationKind.Generic, NotificationKinds.parse("nonsense"))
        assertEquals(NotificationKind.Generic, NotificationKinds.parse(""))
        assertEquals(NotificationKind.Generic, NotificationKinds.parse(null))
    }

    @Test
    fun toWireRoundTripsEveryKind() {
        NotificationKind.entries.forEach { kind ->
            assertEquals(kind, NotificationKinds.parse(NotificationKinds.toWire(kind)))
        }
    }
}
