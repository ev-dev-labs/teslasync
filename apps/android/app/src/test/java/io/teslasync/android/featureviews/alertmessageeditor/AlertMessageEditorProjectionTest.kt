package io.teslasync.android.featureviews.alertmessageeditor

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AlertMessageEditor's pure logic — the native analogue of the data derivations
 * the web component performs (web/src/features/notifications/components/AlertMessageEditor.tsx): the `{{key}}`
 * token extraction (web `extractTemplateKeys`), the autocomplete filter + grouping (web `filteredPlaceholders`
 * + grouping), the op-validity preset filter (web `opValidPresets`), the tag set (web `presetTags`), the
 * active-tag filter (web `filteredPresets`), the cursor clamp, the `{{`-trigger detect (web
 * `handleTextareaChange`), the token splice (web `insertPlaceholder`), and the PII-safe `view.opened`
 * diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class AlertMessageEditorProjectionTest {
    private fun token(
        key: String,
        label: String = key,
        group: String = "General",
    ): TemplateToken = TemplateToken(key = key, label = label, group = group)

    private fun preset(
        id: String,
        template: String,
        tags: List<String> = emptyList(),
    ): MessagePreset = MessagePreset(id = id, name = "Preset $id", template = template, tags = tags)

    // ── extractTemplateKeys (web PLACEHOLDER_TOKEN_RE) ──────────────────────────

    @Test
    fun extractTemplateKeysPullsEveryBraceTokenInOrder() {
        val keys = AlertMessageEditorProjection.extractTemplateKeys("{{VehicleName}} is at {{ BatteryLevel }}% now")

        assertEquals(listOf("VehicleName", "BatteryLevel"), keys)
    }

    @Test
    fun extractTemplateKeysIgnoresMalformedOrSingleBraces() {
        assertTrue(AlertMessageEditorProjection.extractTemplateKeys("no tokens here").isEmpty())
        assertTrue(AlertMessageEditorProjection.extractTemplateKeys("{single} and {{1Invalid}}").isEmpty())
    }

    // ── filterTokens (web filteredPlaceholders) ─────────────────────────────────

    @Test
    fun filterTokensReturnsAllForBlankNeedle() {
        val all = listOf(token("BatteryLevel"), token("Speed"))

        assertEquals(all, AlertMessageEditorProjection.filterTokens(all, "   "))
    }

    @Test
    fun filterTokensMatchesKeyOrLabelCaseInsensitively() {
        val all = listOf(token("BatteryLevel", label = "Battery level"), token("Speed", label = "Speed (mph)"))

        assertEquals(listOf("BatteryLevel"), AlertMessageEditorProjection.filterTokens(all, "bat").map { it.key })
        assertEquals(listOf("Speed"), AlertMessageEditorProjection.filterTokens(all, "MPH").map { it.key })
        assertTrue(AlertMessageEditorProjection.filterTokens(all, "zzz").isEmpty())
    }

    // ── groupTokens (web PlaceholderAutocomplete grouping) ──────────────────────

    @Test
    fun groupTokensGroupsPreservingFirstSeenOrder() {
        val tokens =
            listOf(
                token("BatteryLevel", group = "Battery"),
                token("VehicleName", group = "Vehicle"),
                token("BatteryRange", group = "Battery"),
            )

        val groups = AlertMessageEditorProjection.groupTokens(tokens)

        assertEquals(listOf("Battery", "Vehicle"), groups.map { it.name })
        assertEquals(listOf("BatteryLevel", "BatteryRange"), groups[0].tokens.map { it.key })
        assertEquals(listOf("VehicleName"), groups[1].tokens.map { it.key })
    }

    // ── availableKeys + opValidPresets (web availableKeys / opValidPresets) ──────

    @Test
    fun availableKeysCollectsEveryTokenKey() {
        val keys = AlertMessageEditorProjection.availableKeys(listOf(token("A"), token("B")))

        assertEquals(setOf("A", "B"), keys)
    }

    @Test
    fun opValidPresetsShowsAllWhenLoadingEmptyKeysOrNoOp() {
        val presets = listOf(preset("p", "{{Min}} to {{Max}}"))
        val keys = setOf("BatteryLevel")

        assertEquals(presets, AlertMessageEditorProjection.opValidPresets(presets, keys, tokensLoading = true, hasOp = true))
        assertEquals(presets, AlertMessageEditorProjection.opValidPresets(presets, emptySet(), tokensLoading = false, hasOp = true))
        assertEquals(presets, AlertMessageEditorProjection.opValidPresets(presets, keys, tokensLoading = false, hasOp = false))
    }

    @Test
    fun opValidPresetsHidesPresetsReferencingUnavailableTokens() {
        val keep = preset("keep", "Battery {{BatteryLevel}}%")
        val drop = preset("drop", "Between {{Min}} and {{Max}}")
        val keys = setOf("BatteryLevel")

        val result =
            AlertMessageEditorProjection.opValidPresets(
                presets = listOf(keep, drop),
                availableKeys = keys,
                tokensLoading = false,
                hasOp = true,
            )

        assertEquals(listOf("keep"), result.map { it.id })
    }

    // ── presetTags + filterPresetsByTag (web presetTags / filteredPresets) ──────

    @Test
    fun presetTagsAreSortedAndDeduplicated() {
        val presets =
            listOf(
                preset("a", "x", tags = listOf("battery", "charging")),
                preset("b", "y", tags = listOf("battery", "alerts")),
            )

        assertEquals(listOf("alerts", "battery", "charging"), AlertMessageEditorProjection.presetTags(presets))
    }

    @Test
    fun filterPresetsByTagFiltersOrReturnsAllForNull() {
        val presets =
            listOf(
                preset("a", "x", tags = listOf("battery")),
                preset("b", "y", tags = listOf("alerts")),
            )

        assertEquals(presets, AlertMessageEditorProjection.filterPresetsByTag(presets, null))
        assertEquals(listOf("a"), AlertMessageEditorProjection.filterPresetsByTag(presets, "battery").map { it.id })
    }

    // ── clampCursor (web cursor re-clamp effect) ────────────────────────────────

    @Test
    fun clampCursorPinsEmptyToZeroAndClampsWithinBounds() {
        assertEquals(0, AlertMessageEditorProjection.clampCursor(5, 0))
        assertEquals(2, AlertMessageEditorProjection.clampCursor(9, 3))
        assertEquals(0, AlertMessageEditorProjection.clampCursor(-1, 3))
    }

    // ── detectTokenTrigger (web handleTextareaChange) ───────────────────────────

    @Test
    fun detectTokenTriggerFindsOpenTriggerAndItsPartial() {
        val trigger = AlertMessageEditorProjection.detectTokenTrigger("Battery {{Bat")

        assertEquals(8, trigger?.index)
        assertEquals("Bat", trigger?.filter)
    }

    @Test
    fun detectTokenTriggerReturnsNullWhenClosedOrWhitespaceOrAbsent() {
        assertNull(AlertMessageEditorProjection.detectTokenTrigger("{{BatteryLevel}}"))
        assertNull(AlertMessageEditorProjection.detectTokenTrigger("{{Bat tery"))
        assertNull(AlertMessageEditorProjection.detectTokenTrigger("no braces"))
    }

    @Test
    fun detectTokenTriggerHonoursTheCaret() {
        // The closing braces sit after the caret, so the trigger is still open at the caret.
        assertEquals(0, AlertMessageEditorProjection.detectTokenTrigger("{{Bat}} tail", caret = 5)?.index)
    }

    // ── insertToken (web insertPlaceholder) ─────────────────────────────────────

    @Test
    fun insertTokenSplicesCanonicalFormAndReportsCaret() {
        val result = AlertMessageEditorProjection.insertToken(text = "Battery {{Bat", triggerIndex = 8, key = "BatteryLevel")

        assertEquals("Battery {{BatteryLevel}}", result.text)
        assertEquals("Battery {{BatteryLevel}}".length, result.caret)
    }

    @Test
    fun insertTokenPreservesTextAfterTheCaret() {
        val result =
            AlertMessageEditorProjection.insertToken(
                text = "Battery {{Bat tail",
                triggerIndex = 8,
                key = "BatteryLevel",
                caret = 13,
            )

        assertEquals("Battery {{BatteryLevel}} tail", result.text)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ───────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordAlertMessageEditorOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AlertMessageEditor"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("alert-message-editor", AlertMessageEditorRegistration.ID)
        assertEquals("AlertMessageEditor", AlertMessageEditorRegistration.SLUG)
    }

    @Test
    fun defaultDraftHasNoOpSoPresetsAreNotFiltered() {
        assertFalse(!MessageEditorDraft().op.isNullOrBlank())
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
