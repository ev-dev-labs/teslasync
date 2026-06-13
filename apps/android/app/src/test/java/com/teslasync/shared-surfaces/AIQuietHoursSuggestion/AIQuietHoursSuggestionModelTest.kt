// Off-device unit tests for the AIQuietHoursSuggestion model + projection (the :android:testReleaseUnitTest
// gate). These cover the framework-free core the composable renders: the `tool_result` → QuietHoursWindowProposal
// extraction (web `handleEvent`), the SSE frame parser (the consume side of web `useAiStream`), the
// every-state render projection (resting / loading / content / empty / error / stale / offline), the i18n key
// folding + fallback parity that backs every accessible label, and the parameterized preview-line builder. The
// composable is a thin render layer over these, so exercising them here is the surface's behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiquiethourssuggestion

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AIQuietHoursSuggestionModelTest {
    // ── i18n folding + fallback parity (backs every accessible label) ─────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals(
            "translation_notifications_quietHours_aiSuggestion_title",
            foldCatalogKey(AiQuietHoursKeys.TITLE),
        )
        assertEquals(
            "translation_notifications_quietHours_aiSuggestion_button",
            foldCatalogKey(AiQuietHoursKeys.SUGGEST_BUTTON),
        )
        assertEquals(
            "translation_notifications_quietHours_aiSuggestion_previewWindow",
            foldCatalogKey(QuietHoursPreviewKey.Window.dottedKey),
        )
        assertEquals("translation_common_noData", foldCatalogKey(AiQuietHoursKeys.EMPTY))
    }

    @Test
    fun labels_resolveToWebEnglishViaFallback() {
        val labels = aiQuietHoursLabels(FallbackResolver)
        assertEquals("Suggest a quiet-hours window from your notification history", labels.title)
        assertEquals("Helix", labels.badge)
        assertEquals("Suggest quiet hours", labels.suggestButton)
        assertEquals("Apply to form", labels.applyButton)
        assertEquals("Proposed window (review before saving):", labels.previewLabel)
        assertEquals("Ask Helix", labels.askHelix)
        assertTrue(labels.description.startsWith("Ask Helix to recommend ONE quiet-hours window"))
    }

    @Test
    fun labels_consultCatalogForSourceKeys() {
        val catalog =
            mapOf(
                AiQuietHoursKeys.TITLE to "Catálogo title",
                AiQuietHoursKeys.SUGGEST_BUTTON to "Catálogo suggest",
            )
        val resolve: StringResolver = { key, fallback -> catalog[key] ?: fallback }
        val labels = aiQuietHoursLabels(resolve)
        assertEquals("Catálogo title", labels.title)
        assertEquals("Catálogo suggest", labels.suggestButton)
        // A key absent from the catalog still falls back to the web English.
        assertEquals("Apply to form", labels.applyButton)
    }

    @Test
    fun suggestButtonContentDescription_matchesWebAriaLabel() {
        assertEquals("Ask Helix · Suggest quiet hours", suggestButtonContentDescription(FallbackResolver))
    }

    @Test
    fun allLabels_areNonBlank() {
        val labels = aiQuietHoursLabels(FallbackResolver)
        listOf(
            labels.title,
            labels.description,
            labels.badge,
            labels.badgeAria,
            labels.suggestButton,
            labels.applyButton,
            labels.previewLabel,
            labels.askHelix,
            labels.thinking,
            labels.empty,
            labels.errorTitle,
            labels.retry,
            labels.offline,
            labels.stale,
        ).forEach { assertTrue("label must be non-blank", it.isNotBlank()) }
    }

    // ── tool_result → QuietHoursWindowProposal extraction (web handleEvent) ───────────────────────────────

    @Test
    fun extractQuietHoursProposal_capturesWindow() {
        val proposal = extractQuietHoursProposal(toolResult(fullWindow()))
        assertEquals(
            QuietHoursWindowProposal(
                startLocal = "22:00",
                endLocal = "07:00",
                timezone = "America/Los_Angeles",
                weekdays = 127,
                bypassSeverities = listOf("critical", "high"),
                status = "ok",
                existingWindowsCount = 2,
            ),
            proposal,
        )
    }

    @Test
    fun extractQuietHoursProposal_ignoresWrongToolName() {
        assertNull(extractQuietHoursProposal(toolResult(fullWindow(), name = "some_other_tool")))
    }

    @Test
    fun extractQuietHoursProposal_ignoresNotOk() {
        assertNull(extractQuietHoursProposal(toolResult(fullWindow(), ok = false)))
    }

    @Test
    fun extractQuietHoursProposal_ignoresNonToolResultEvent() {
        assertNull(extractQuietHoursProposal(AiStreamEvent.Delta("hello")))
        assertNull(extractQuietHoursProposal(AiStreamEvent.Done("stop")))
    }

    @Test
    fun parseProposal_requiresStartLocalString() {
        val window =
            buildJsonObject {
                put("end_local", "07:00")
                put("timezone", "America/Los_Angeles")
                put("weekdays", 127)
                putJsonArray("bypass_severities") { add("critical") }
            }
        assertNull(parseProposal(window))
    }

    @Test
    fun parseProposal_requiresNumericWeekdays() {
        val window =
            buildJsonObject {
                put("start_local", "22:00")
                put("end_local", "07:00")
                put("timezone", "America/Los_Angeles")
                put("weekdays", "127") // string, not a number → ignored (web `typeof === 'number'`)
                putJsonArray("bypass_severities") { add("critical") }
            }
        assertNull(parseProposal(window))
    }

    @Test
    fun parseProposal_requiresBypassArray() {
        val window =
            buildJsonObject {
                put("start_local", "22:00")
                put("end_local", "07:00")
                put("timezone", "America/Los_Angeles")
                put("weekdays", 127)
                put("bypass_severities", "critical") // not an array → rejected (web `Array.isArray`)
            }
        assertNull(parseProposal(window))
    }

    @Test
    fun parseProposal_defaultsStatusAndExistingCount() {
        val window =
            buildJsonObject {
                put("start_local", "22:00")
                put("end_local", "07:00")
                put("timezone", "America/Los_Angeles")
                put("weekdays", 96)
                putJsonArray("bypass_severities") { add("critical") }
            }
        val proposal = parseProposal(window)
        assertEquals("ok", proposal?.status)
        assertEquals(0, proposal?.existingWindowsCount)
    }

    @Test
    fun parseProposal_filtersNonStringSeverities() {
        val window =
            buildJsonObject {
                put("start_local", "22:00")
                put("end_local", "07:00")
                put("timezone", "America/Los_Angeles")
                put("weekdays", 127)
                putJsonArray("bypass_severities") {
                    add("critical")
                    add(3) // non-string element → dropped (web `.filter(s => typeof s === 'string')`)
                    add("high")
                }
            }
        assertEquals(listOf("critical", "high"), parseProposal(window)?.bypassSeverities)
    }

    // ── apply patch (web handleApply / QuietHoursWindowInput) ─────────────────────────────────────────────

    @Test
    fun toInput_copiesScalarsEnabled() {
        val proposal =
            QuietHoursWindowProposal(
                startLocal = "23:30",
                endLocal = "06:15",
                timezone = "Europe/Berlin",
                weekdays = 62,
                bypassSeverities = listOf("critical"),
                status = "ok",
                existingWindowsCount = 0,
            )
        assertEquals(
            QuietHoursWindowInput(
                enabled = true,
                startLocal = "23:30",
                endLocal = "06:15",
                timezone = "Europe/Berlin",
                weekdays = 62,
                bypassSeverities = listOf("critical"),
            ),
            proposal.toInput(),
        )
    }

    // ── parameterized preview lines (web previewWindow / previewWeekdays / … interpolation) ───────────────

    @Test
    fun previewLines_orderAndTokensForBaseWindow() {
        val lines = quietHoursPreviewLines(baseProposal(), FallbackPreviewProvider)
        assertEquals(
            listOf(
                QuietHoursPreviewLine("Window: 22:00 → 07:00 (America/Los_Angeles)", PreviewTone.Secondary),
                QuietHoursPreviewLine("Weekday bitmask: 127", PreviewTone.Secondary),
                QuietHoursPreviewLine("Bypass severities: critical, high", PreviewTone.Secondary),
            ),
            lines,
        )
    }

    @Test
    fun previewLines_addsInsufficientHistoryWarning() {
        val lines = quietHoursPreviewLines(baseProposal().copy(status = STATUS_INSUFFICIENT_HISTORY), FallbackPreviewProvider)
        val caveat = lines.last()
        assertEquals(PreviewTone.Warning, caveat.tone)
        assertEquals("Helix had insufficient notification history; this is a conservative default.", caveat.text)
    }

    @Test
    fun previewLines_addsExistingCountWhenPositive() {
        val lines = quietHoursPreviewLines(baseProposal().copy(existingWindowsCount = 2), FallbackPreviewProvider)
        assertEquals(
            QuietHoursPreviewLine("You already have 2 quiet-hours window(s) configured.", PreviewTone.Secondary),
            lines.last(),
        )
    }

    @Test
    fun previewLines_includeEveryLineWhenBothFlagsSet() {
        val proposal = baseProposal().copy(status = STATUS_INSUFFICIENT_HISTORY, existingWindowsCount = 3)
        val lines = quietHoursPreviewLines(proposal, FallbackPreviewProvider)
        assertEquals(5, lines.size)
        assertEquals(PreviewTone.Warning, lines[3].tone)
        assertEquals("You already have 3 quiet-hours window(s) configured.", lines[4].text)
    }

    @Test
    fun previewLines_omitConditionalLinesForOkStatusZeroCount() {
        val lines = quietHoursPreviewLines(baseProposal(), FallbackPreviewProvider)
        assertEquals(3, lines.size)
        assertTrue(lines.all { it.tone == PreviewTone.Secondary })
    }

    // ── render-state projection (every mandated state) ───────────────────────────────────────────────────

    @Test
    fun project_restingWhenIdleNoProposal() {
        val snapshot = projectQuietHours(StreamRuntime(), online = true)
        assertEquals(QuietHoursRenderState.Resting, snapshot.renderState)
        assertTrue(snapshot.canStart)
        assertFalse(snapshot.isBusy)
    }

    @Test
    fun project_contentWhenProposalCaptured() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, proposal = baseProposal())
        val snapshot = projectQuietHours(runtime, online = true)
        assertEquals(QuietHoursRenderState.Content, snapshot.renderState)
        assertEquals("22:00", snapshot.proposal?.startLocal)
    }

    @Test
    fun project_contentWhenStreamedReplayText() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, streamedText = "Reviewed 30 days…")
        assertEquals(QuietHoursRenderState.Content, projectQuietHours(runtime, online = true).renderState)
    }

    @Test
    fun project_loadingWhenStreamingNoProposal() {
        val snapshot = projectQuietHours(StreamRuntime(phase = AiStreamPhase.Streaming), online = true)
        assertEquals(QuietHoursRenderState.Loading, snapshot.renderState)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_staleWhenStreamingOverLastKnownProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Streaming, proposal = baseProposal())
        val snapshot = projectQuietHours(runtime, online = true)
        assertEquals(QuietHoursRenderState.Stale, snapshot.renderState)
        assertTrue(snapshot.stale)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_loadingAndNotStartableWhilePausedConfirm() {
        val snapshot = projectQuietHours(StreamRuntime(phase = AiStreamPhase.PausedConfirm), online = true)
        assertEquals(QuietHoursRenderState.Loading, snapshot.renderState)
        assertFalse(snapshot.canStart)
        assertTrue(snapshot.isBusy)
    }

    @Test
    fun project_errorWhenStreamErrorIsNotNetwork() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "stream_http_503")
        val snapshot = projectQuietHours(runtime, online = true)
        assertEquals(QuietHoursRenderState.Error, snapshot.renderState)
        assertEquals("stream_http_503", snapshot.errorMessage)
        assertTrue(snapshot.canStart)
    }

    @Test
    fun project_offlineWhenStreamErrorIsNetwork() {
        val byMessage = StreamRuntime(phase = AiStreamPhase.Error, errorMessage = "network is unreachable")
        assertEquals(QuietHoursRenderState.Offline, projectQuietHours(byMessage, online = true).renderState)

        val byLimit =
            StreamRuntime(
                phase = AiStreamPhase.Error,
                errorMessage = "capped",
                limit = AiLimitInfo("timeout", 5, "warn", baselineAvailable = true),
            )
        assertEquals(QuietHoursRenderState.Offline, projectQuietHours(byLimit, online = true).renderState)
    }

    @Test
    fun project_offlineWhenDisconnectedKeepsLastKnownProposal() {
        val runtime = StreamRuntime(phase = AiStreamPhase.Done, proposal = baseProposal())
        val snapshot = projectQuietHours(runtime, online = false)
        assertEquals(QuietHoursRenderState.Offline, snapshot.renderState)
        assertTrue(snapshot.offline)
        assertTrue(snapshot.stale)
        assertEquals("22:00", snapshot.proposal?.startLocal)
        assertFalse(snapshot.canStart)
    }

    @Test
    fun project_emptyWhenDoneWithNothing() {
        val snapshot = projectQuietHours(StreamRuntime(phase = AiStreamPhase.Done), online = true)
        assertEquals(QuietHoursRenderState.Empty, snapshot.renderState)
    }

    // ── SSE frame parsing (web parseSSEFrame + toTypedEvent) ──────────────────────────────────────────────

    @Test
    fun parseSseFrame_delta() {
        assertEquals(AiStreamEvent.Delta("hi"), parseSseFrame("event: delta\ndata: {\"text\":\"hi\"}"))
    }

    @Test
    fun parseSseFrame_toolResultThenExtractsProposal() {
        val raw =
            "event: tool_result\n" +
                "data: {\"id\":\"1\",\"name\":\"draft_quiet_hours_window\",\"ok\":true," +
                "\"data\":{\"start_local\":\"22:00\",\"end_local\":\"07:00\",\"timezone\":\"UTC\"," +
                "\"weekdays\":127,\"bypass_severities\":[\"critical\"]}}"
        val event = parseSseFrame(raw)
        assertTrue(event is AiStreamEvent.ToolResult)
        val proposal = extractQuietHoursProposal(event!!)
        assertEquals("22:00", proposal?.startLocal)
        assertEquals("UTC", proposal?.timezone)
        assertEquals(127, proposal?.weekdays)
        assertEquals(listOf("critical"), proposal?.bypassSeverities)
    }

    @Test
    fun parseSseFrame_errorWithStructuredLimit() {
        val raw =
            "event: error\n" +
                "data: {\"message\":\"capped\",\"reason\":\"cost_cap\",\"retry_after_s\":30,\"banner_level\":\"warn\"}"
        val event = parseSseFrame(raw)
        assertTrue(event is AiStreamEvent.StreamError)
        val error = event as AiStreamEvent.StreamError
        assertEquals("capped", error.message)
        assertEquals("cost_cap", error.reason)
        assertEquals(30, error.retryAfterS)
        assertEquals("warn", error.bannerLevel)
    }

    @Test
    fun parseSseFrame_unknownEventReturnsNull() {
        assertNull(parseSseFrame("event: mystery\ndata: {}"))
    }

    @Test
    fun parseSseFrame_malformedJsonReturnsNull() {
        assertNull(parseSseFrame("event: delta\ndata: {bad json"))
    }

    @Test
    fun parseSseFrame_missingEventReturnsNull() {
        assertNull(parseSseFrame("data: {\"text\":\"x\"}"))
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────

    private fun toolResult(
        data: JsonObject,
        name: String = DRAFT_TOOL_NAME,
        ok: Boolean = true,
    ): AiStreamEvent.ToolResult = AiStreamEvent.ToolResult(id = "t1", name = name, ok = ok, data = data, error = null)

    private fun fullWindow(): JsonObject =
        buildJsonObject {
            put("start_local", "22:00")
            put("end_local", "07:00")
            put("timezone", "America/Los_Angeles")
            put("weekdays", 127)
            putJsonArray("bypass_severities") {
                add("critical")
                add("high")
            }
            put("status", "ok")
            put("existing_windows_count", 2)
        }

    private fun baseProposal(): QuietHoursWindowProposal =
        QuietHoursWindowProposal(
            startLocal = "22:00",
            endLocal = "07:00",
            timezone = "America/Los_Angeles",
            weekdays = 127,
            bypassSeverities = listOf("critical", "high"),
            status = "ok",
            existingWindowsCount = 0,
        )
}
