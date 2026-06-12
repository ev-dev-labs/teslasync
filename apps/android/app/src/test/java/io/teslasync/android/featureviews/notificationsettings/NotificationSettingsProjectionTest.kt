package io.teslasync.android.featureviews.notificationsettings

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the pure NotificationSettings model — the native analogue of the web
 * derivations (web/src/features/settings/components/NotificationSettings.tsx +
 * web/src/lib/notificationSound.ts): the sound-preference defaults / normalisation / shallow-merge patch /
 * volume clamp, the Test-button force-play override, the saved-prefs play gate, the default-ON tab-signal
 * read + full-document merge, the permission branch, the per-state classifier, the i18n key contract, and
 * the PII-safe diagnostics. Every assertion is exercised by the offline `testReleaseUnitTest` gate.
 */
class NotificationSettingsProjectionTest {
    @Test
    fun soundPrefsDefaultsMirrorWeb() {
        val default = NotificationSoundPrefs.DEFAULT
        assertFalse(default.master)
        assertEquals(0.6f, default.volume)
        assertTrue(default.isCategoryEnabled(NotificationSoundCategory.CriticalAlert))
        assertTrue(default.isCategoryEnabled(NotificationSoundCategory.WarningAlert))
        assertFalse(default.isCategoryEnabled(NotificationSoundCategory.InfoAlert))
        assertTrue(default.isCategoryEnabled(NotificationSoundCategory.ChargeComplete))
        assertFalse(default.isCategoryEnabled(NotificationSoundCategory.DriveComplete))
        assertFalse(default.isCategoryEnabled(NotificationSoundCategory.AutomationRun))
        assertFalse(default.isCategoryEnabled(NotificationSoundCategory.Achievement))
    }

    @Test
    fun normalizeFillsMissingChannelsAndClampsVolume() {
        val prefs =
            NotificationSoundPrefs.normalize(
                master = true,
                perCategory = mapOf(NotificationSoundCategory.CriticalAlert to false),
                volume = 2f,
            )
        assertEquals(NotificationSoundCategory.entries.size, prefs.perCategory.size)
        assertFalse(prefs.isCategoryEnabled(NotificationSoundCategory.CriticalAlert))
        // A channel absent from the candidate falls back to its default gate.
        assertTrue(prefs.isCategoryEnabled(NotificationSoundCategory.WarningAlert))
        assertEquals(1f, prefs.volume)
    }

    @Test
    fun applyPatchMergesPerCategoryShallowlyAndKeepsUnsetFields() {
        val patched =
            NotificationSoundPrefs.DEFAULT.applyPatch(
                NotificationSoundPrefsPatch(perCategory = mapOf(NotificationSoundCategory.InfoAlert to true)),
            )
        assertTrue(patched.isCategoryEnabled(NotificationSoundCategory.InfoAlert))
        assertTrue(patched.isCategoryEnabled(NotificationSoundCategory.CriticalAlert))
        assertFalse(patched.master)
        assertEquals(0.6f, patched.volume)
    }

    @Test
    fun applyPatchClampsSuppliedVolume() {
        assertEquals(1f, NotificationSoundPrefs.DEFAULT.applyPatch(NotificationSoundPrefsPatch(volume = 9f)).volume)
        assertEquals(0f, NotificationSoundPrefs.DEFAULT.applyPatch(NotificationSoundPrefsPatch(volume = -1f)).volume)
    }

    @Test
    fun clampVolumeMatchesWebClamp() {
        assertEquals(0f, clampVolume(Float.NaN))
        assertEquals(0f, clampVolume(-0.2f))
        assertEquals(1f, clampVolume(1.4f))
        assertEquals(0.5f, clampVolume(0.5f))
    }

    @Test
    fun volumePercentRoundsLikeWeb() {
        assertEquals(60, NotificationSoundPrefs.DEFAULT.volumePercent)
        assertEquals(56, NotificationSoundPrefs.DEFAULT.copy(volume = 0.555f).volumePercent)
        assertEquals(0, NotificationSoundPrefs.DEFAULT.copy(volume = 0f).volumePercent)
    }

    @Test
    fun testOverrideForcesMasterChannelAndVolume() {
        val override = NotificationSoundPrefs.DEFAULT.testOverrideFor(NotificationSoundCategory.InfoAlert)
        assertTrue(override.master)
        assertTrue(override.isCategoryEnabled(NotificationSoundCategory.InfoAlert))
        assertEquals(0.6f, override.volume)
        // A zero saved volume lifts to 50% so the Test cue is audible (web `volume <= 0 ? 0.5 : volume`).
        val fromZero = NotificationSoundPrefs.DEFAULT.copy(volume = 0f).testOverrideFor(NotificationSoundCategory.CriticalAlert)
        assertEquals(0.5f, fromZero.volume)
    }

    @Test
    fun decideSoundPlayReportsEachGate() {
        val cat = NotificationSoundCategory.CriticalAlert
        assertEquals(SoundPlayDecision.MasterOff, decideSoundPlay(NotificationSoundPrefs.DEFAULT, cat))
        val masterOn = NotificationSoundPrefs.DEFAULT.copy(master = true)
        assertEquals(SoundPlayDecision.Play, decideSoundPlay(masterOn, cat))
        assertEquals(
            SoundPlayDecision.CategoryOff,
            decideSoundPlay(masterOn, NotificationSoundCategory.InfoAlert),
        )
        assertEquals(SoundPlayDecision.VolumeZero, decideSoundPlay(masterOn.copy(volume = 0f), cat))
    }

    @Test
    fun tabSignalsDefaultOnUnlessExplicitlyFalse() {
        assertEquals(TabSignals(badgeEnabled = true, criticalFlashEnabled = true), TabSignals.read(null))
        assertEquals(TabSignals(badgeEnabled = true, criticalFlashEnabled = true), TabSignals.read(buildJsonObject {}))
        val off = TabSignals.read(buildJsonObject { put(FIELD_TAB_BADGE_ENABLED, false) })
        assertFalse(off.badgeEnabled)
        assertTrue(off.criticalFlashEnabled)
        // A non-boolean value is not `false`, so it reads as on (web `!== false`).
        val nonBool = TabSignals.read(buildJsonObject { put(FIELD_TAB_BADGE_ENABLED, "nope") })
        assertTrue(nonBool.badgeEnabled)
    }

    @Test
    fun mergeTabSignalPreservesEveryOtherField() {
        val document =
            buildJsonObject {
                put(FIELD_TAB_BADGE_ENABLED, true)
                put(FIELD_CRITICAL_FLASH_ENABLED, true)
                put("other_setting", "keep-me")
            }
        val merged = mergeTabSignal(document, FIELD_TAB_BADGE_ENABLED, false)
        assertEquals(false, merged[FIELD_TAB_BADGE_ENABLED]?.jsonPrimitive?.booleanOrNull)
        assertEquals(true, merged[FIELD_CRITICAL_FLASH_ENABLED]?.jsonPrimitive?.booleanOrNull)
        assertEquals("keep-me", merged["other_setting"]?.jsonPrimitive?.content)
    }

    @Test
    fun mergeTabSignalIntoNullYieldsSingleField() {
        val merged = mergeTabSignal(null, FIELD_CRITICAL_FLASH_ENABLED, false)
        assertEquals(1, merged.size)
        assertEquals(false, merged[FIELD_CRITICAL_FLASH_ENABLED]?.jsonPrimitive?.booleanOrNull)
    }

    @Test
    fun browserNotifControlMatchesPermissionBranch() {
        assertEquals(BrowserNotifControl.RequestPermission, browserNotifControl(BrowserNotifPermission.Default))
        assertEquals(BrowserNotifControl.ShowEnabledBadge, browserNotifControl(BrowserNotifPermission.Granted))
        assertEquals(BrowserNotifControl.ShowBlockedMessage, browserNotifControl(BrowserNotifPermission.Denied))
    }

    @Test
    fun eventPreferencesShowOnlyWhenGranted() {
        assertTrue(showsEventPreferences(BrowserNotifPermission.Granted))
        assertFalse(showsEventPreferences(BrowserNotifPermission.Default))
        assertFalse(showsEventPreferences(BrowserNotifPermission.Denied))
    }

    @Test
    fun tabSignalsSurfaceLoadingTakesPrecedenceOverError() {
        assertEquals(TabSignalsSurface.Loading, tabSignalsSurfaceFor(isLoading = true, isError = true))
        assertEquals(TabSignalsSurface.Error, tabSignalsSurfaceFor(isLoading = false, isError = true))
        assertEquals(TabSignalsSurface.Ready, tabSignalsSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun categoryWireRoundTripsAndOrderMirrorsWeb() {
        assertEquals(NotificationSoundCategory.CriticalAlert, NotificationSoundCategory.fromWire("critical_alert"))
        assertNull(NotificationSoundCategory.fromWire("unknown_channel"))
        assertEquals(
            listOf(
                "critical_alert",
                "warning_alert",
                "info_alert",
                "charge_complete",
                "drive_complete",
                "automation_run",
                "achievement",
            ),
            NotificationSoundCategory.entries.map { it.wire },
        )
    }

    @Test
    fun categoryLabelKeysMatchTheGeneratedCatalog() {
        // a11y contract: each channel resolves its label through the P1/S10 catalog key the composable uses.
        assertEquals("translation_notificationSounds_category_critical_alert", NotificationSoundCategory.CriticalAlert.labelKey)
        assertEquals("translation_notificationSounds_category_achievement", NotificationSoundCategory.Achievement.labelKey)
    }

    @Test
    fun recordViewOpenedEmitsOnlyTheSurfaceSlug() {
        val logger = RecordingLogger()
        recordNotificationSettingsOpened(logger)
        assertEquals(1, logger.events.size)
        assertEquals("view.opened", logger.events.single().first)
        assertEquals(mapOf("surface" to "NotificationSettings"), logger.events.single().second)
    }

    @Test
    fun toTabSignalsMapsEveryResourceVariant() {
        val docOff = buildJsonObject { put(FIELD_TAB_BADGE_ENABLED, false) }
        val success = Resource.Success<JsonElement>(docOff, fetchedAt = 5L, stale = false).toTabSignals()
        assertEquals(TabSignals(badgeEnabled = false, criticalFlashEnabled = true), (success as Resource.Success).data)

        val loading = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false).toTabSignals()
        assertNull((loading as Resource.Loading).cached)

        val error =
            Resource
                .Error<JsonElement>(
                    cached = null,
                    fetchedAt = null,
                    stale = false,
                    error = RuntimeException("boom"),
                ).toTabSignals()
        assertNull((error as Resource.Error).cached)
    }

    @Test
    fun nonObjectDocumentReadsAsDefaultsOn() {
        assertEquals(TabSignals.DEFAULT, TabSignals.read(null))
        // A non-object document (array/primitive) cannot carry the flags, so both read as on.
        assertEquals(TabSignals.DEFAULT, TabSignals.read(JsonPrimitive("not-an-object")))
    }

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
}
