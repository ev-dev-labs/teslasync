package io.teslasync.android.featureviews.presetgallery

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the PresetGallery's pure logic — the native analogue of the web component's
 * per-preset derivations (web/src/features/automations/pages/PresetGallery.tsx): the preset →
 * (id, name, description, icon, triggerKind, actionCount) projection with its preserved order, the icon
 * classification (web `iconMap[preset.icon] ?? Shield`), the first-trigger classification (web
 * `triggerLabels[preset.triggers[0].kind]`, else the no-trigger fallback), the empty guard (web
 * `presetList.length === 0`), and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class PresetGalleryProjectionTest {
    // Kept to four parameters so detekt's LongParameterList (functionThreshold 6, data classes exempt) stays
    // green; the production [AutomationPresetData] is constructed directly where a test pins name/description.
    private fun preset(
        id: String,
        icon: String = "Shield",
        triggerKinds: List<String> = listOf("trigger_schedule"),
        actionCount: Int = 1,
    ): AutomationPresetData =
        AutomationPresetData(
            id = id,
            name = "Preset $id",
            description = "Description $id",
            icon = icon,
            triggerKinds = triggerKinds,
            actionCount = actionCount,
        )

    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectMapsPresetsPreservingOrderWithAllCardFields() {
        val presets =
            listOf(
                AutomationPresetData(
                    id = "a",
                    name = "Morning",
                    description = "Warm up",
                    icon = "Sun",
                    triggerKinds = listOf("trigger_schedule"),
                    actionCount = 3,
                ),
                AutomationPresetData(
                    id = "b",
                    name = "Arrive",
                    description = "Lock up",
                    icon = "Lock",
                    triggerKinds = listOf("trigger_geofence"),
                    actionCount = 2,
                ),
            )

        val result = PresetGalleryProjection.project(presets)

        assertFalse(result.isEmpty)
        assertEquals(listOf("a", "b"), result.cards.map { it.id })
        assertEquals(listOf("Morning", "Arrive"), result.cards.map { it.name })
        assertEquals(listOf("Warm up", "Lock up"), result.cards.map { it.description })
        assertEquals(listOf(PresetIconKind.Sun, PresetIconKind.Lock), result.cards.map { it.icon })
        assertEquals(
            listOf(PresetTriggerKind.Schedule, PresetTriggerKind.Geofence),
            result.cards.map { it.triggerKind },
        )
        assertEquals(listOf(3, 2), result.cards.map { it.actionCount })
    }

    @Test
    fun projectReturnsEmptyResultForNoPresets() {
        val result = PresetGalleryProjection.project(emptyList())

        assertTrue(result.isEmpty)
        assertTrue(result.cards.isEmpty())
    }

    @Test
    fun projectUsesFirstTriggerAndNoneWhenAbsent() {
        val result =
            PresetGalleryProjection.project(
                listOf(
                    preset("multi", triggerKinds = listOf("trigger_signal", "trigger_event")),
                    preset("none", triggerKinds = emptyList()),
                ),
            )

        assertEquals(PresetTriggerKind.Signal, result.cards[0].triggerKind)
        assertEquals(PresetTriggerKind.None, result.cards[1].triggerKind)
    }

    @Test
    fun projectClampsNegativeActionCountToZero() {
        val result = PresetGalleryProjection.project(listOf(preset("x", actionCount = -5)))

        assertEquals(0, result.cards.single().actionCount)
    }

    // ── Icon classification (web iconMap parity) ────────────────────────────────

    @Test
    fun iconFromMapsKnownKeysAndFallsBackToShield() {
        assertEquals(PresetIconKind.Shield, PresetIconKind.from("Shield"))
        assertEquals(PresetIconKind.Moon, PresetIconKind.from("Moon"))
        assertEquals(PresetIconKind.Sun, PresetIconKind.from("Sun"))
        assertEquals(PresetIconKind.ShieldCheck, PresetIconKind.from("ShieldCheck"))
        assertEquals(PresetIconKind.Lock, PresetIconKind.from("Lock"))
        assertEquals(PresetIconKind.UserX, PresetIconKind.from("UserX"))
        assertEquals(PresetIconKind.CarFront, PresetIconKind.from("CarFront"))
        assertEquals(PresetIconKind.Siren, PresetIconKind.from("Siren"))
        // Unknown / null icons fall back to Shield (web `iconMap[preset.icon] ?? Shield`).
        assertEquals(PresetIconKind.Shield, PresetIconKind.from("Spaceship"))
        assertEquals(PresetIconKind.Shield, PresetIconKind.from(null))
    }

    // ── Trigger classification (web triggerLabels key match) ────────────────────

    @Test
    fun triggerFromMatchesKnownKindsCaseTolerantElseNone() {
        assertEquals(PresetTriggerKind.Schedule, PresetTriggerKind.from("trigger_schedule"))
        assertEquals(PresetTriggerKind.Event, PresetTriggerKind.from("  TRIGGER_EVENT "))
        assertEquals(PresetTriggerKind.Geofence, PresetTriggerKind.from("trigger_geofence"))
        assertEquals(PresetTriggerKind.Signal, PresetTriggerKind.from("trigger_signal"))
        assertEquals(PresetTriggerKind.None, PresetTriggerKind.from("trigger_unknown"))
        assertEquals(PresetTriggerKind.None, PresetTriggerKind.from(null))
        assertEquals(PresetTriggerKind.None, PresetTriggerKind.from(""))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ───────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordPresetGalleryOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "PresetGallery"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("preset-gallery", PresetGalleryRegistration.ID)
        assertEquals("PresetGallery", PresetGalleryRegistration.SLUG)
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
