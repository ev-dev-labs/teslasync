package io.teslasync.android.feature.views.resultpanel

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ResultPanel's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/admin/components/devtools/ResultPanel.tsx): the `hasData` /
 * `stringifiedData` reads, the error-precedes-data tint expression, the copy-when-data affordance that is
 * independent of the error branch, the two-space `JSON.stringify(data, null, 2)` formatting, and the
 * three-way body branch (error / result / idle). Because the surface is purely presentational this is also
 * the per-state "snapshot": each [ResultPanelDisplay] is exactly what the thin composable renders, and
 * [ResultPanelDisplay.bodyText] is the text the body exposes to TalkBack.
 */
class ResultPanelProjectionTest {
    private val title = "Run result"
    private val idle = "No result yet"

    private fun sampleData() =
        buildJsonObject {
            put("chart", "1.4.2")
            put("count", 3)
        }

    @Test
    fun resultBranchPrettyPrintsDataWithTwoSpaceIndentAndOffersCopy() {
        val display = ResultPanelProjection.project(title, sampleData(), error = null, idleMessage = idle)

        assertEquals(ResultPanelMode.Result, display.mode)
        assertEquals(ResultPanelTone.Success, display.tone)
        assertTrue(display.showCopy)
        // Web `JSON.stringify(data, null, 2)`: two-space indent, `": "` separators, one entry per line.
        val expected = "{\n  \"chart\": \"1.4.2\",\n  \"count\": 3\n}"
        assertEquals(expected, display.bodyText)
        assertEquals(expected, display.copyText)
    }

    @Test
    fun prettyPrintUsesTwoSpacesNotFour() {
        val body = ResultPanelProjection.project(title, sampleData(), error = null, idleMessage = idle).bodyText

        assertTrue("expected a two-space-indented first key", body.contains("\n  \"chart\""))
        assertFalse("must not use a four-space indent", body.contains("\n    \"chart\""))
    }

    @Test
    fun errorBranchTakesPrecedenceForToneAndBodyButCopyStillFollowsData() {
        // Web: tint + body key off `error` first, but `{hasData ? <CopyButton/> : null}` keys off data alone —
        // so an error carrying a payload still renders the copy affordance over the (red) error surface.
        val display = ResultPanelProjection.project(title, sampleData(), error = "boom", idleMessage = idle)

        assertEquals(ResultPanelMode.Error, display.mode)
        assertEquals(ResultPanelTone.Danger, display.tone)
        assertEquals("boom", display.bodyText)
        assertTrue(display.showCopy)
        assertEquals("{\n  \"chart\": \"1.4.2\",\n  \"count\": 3\n}", display.copyText)
    }

    @Test
    fun errorWithoutDataHidesCopyAndHasNoCopyText() {
        val display = ResultPanelProjection.project(title, data = null, error = "boom", idleMessage = idle)

        assertEquals(ResultPanelMode.Error, display.mode)
        assertEquals(ResultPanelTone.Danger, display.tone)
        assertEquals("boom", display.bodyText)
        assertFalse(display.showCopy)
        assertEquals("", display.copyText)
    }

    @Test
    fun emptyErrorStringIsNotTreatedAsAnError() {
        // Web `error ?` is falsy for an empty string, so the data branch wins.
        val display = ResultPanelProjection.project(title, sampleData(), error = "", idleMessage = idle)

        assertEquals(ResultPanelMode.Result, display.mode)
        assertEquals(ResultPanelTone.Success, display.tone)
    }

    @Test
    fun idleBranchRendersTheProvidedMessageWithNeutralToneAndNoCopy() {
        val display = ResultPanelProjection.project(title, data = null, error = null, idleMessage = idle)

        assertEquals(ResultPanelMode.Idle, display.mode)
        assertEquals(ResultPanelTone.Neutral, display.tone)
        assertEquals(idle, display.bodyText)
        assertFalse(display.showCopy)
        assertEquals("", display.copyText)
    }

    @Test
    fun jsonNullPayloadIsTreatedAsNoData() {
        // Web `data != null` is false for a JS `null`; the JSON null literal is the kotlinx analogue.
        val display = ResultPanelProjection.project(title, data = JsonNull, error = null, idleMessage = idle)

        assertEquals(ResultPanelMode.Idle, display.mode)
        assertFalse(display.showCopy)
    }

    @Test
    fun exposesTitleAndAccessibleBodyTextForEachState() {
        // The thin composable renders `title` as a heading and `bodyText` as the body's accessible text, so
        // these assertions are the surface's per-state accessibility contract.
        val error = ResultPanelProjection.project(title, data = null, error = "down", idleMessage = idle)
        val result = ResultPanelProjection.project(title, sampleData(), error = null, idleMessage = idle)
        val idleState = ResultPanelProjection.project(title, data = null, error = null, idleMessage = idle)

        assertEquals(title, error.title)
        assertEquals(title, result.title)
        assertEquals(title, idleState.title)
        assertEquals("down", error.bodyText)
        assertTrue(result.bodyText.contains("\"chart\": \"1.4.2\""))
        assertEquals(idle, idleState.bodyText)
    }
}
