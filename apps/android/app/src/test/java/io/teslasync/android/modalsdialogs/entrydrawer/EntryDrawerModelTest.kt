// Off-device unit coverage for the EntryDrawer modal/dialog's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the base64 -> UTF-8 decode (text, multibyte, empty, invalid base64, binary),
// the projection's `head = full ?? summary` selection + `||`/`??` dash fallbacks + `fmtInt` redelivery format +
// payload-text/copy-text per tab, the Replay-disabled matrix, the `loading && !full` spinner gate, the absolute
// timestamp format, the tab key mapping, the registry identifiers, and the PII-safe `view.opened` diagnostic.
// No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.entrydrawer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Base64

class EntryDrawerModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // A representative summary row; tests derive variants with `.copy(...)` so no wide builder is needed.
    private val baseSummary =
        DlqEntrySummary(
            id = 7,
            arrivedAt = "2024-06-01T12:34:56Z",
            dlqTopic = "telemetry.dlq.v1",
            parsedReason = "codec: unknown enum",
            parsedVin = "5YJ3E1EA7KF000000",
            parsedSourceTopic = "telemetry/5YJ/v/Soc",
            parsedRedeliveries = 3,
            parseError = null,
            replayable = true,
            rawPayloadSize = 1536,
            innerPayloadSize = 42,
        )

    private fun b64(text: String): String = Base64.getEncoder().encodeToString(text.toByteArray(Charsets.UTF_8))

    // ---- decodeBase64Utf8 (web `decodeBase64Utf8`) ----------------------------------------------

    @Test
    fun decode_returnsUtf8TextForValidBase64() {
        assertEquals("hello", decodeBase64Utf8(b64("hello")))
        // Multibyte UTF-8 (© = U+00A9, bytes C2 A9) must round-trip.
        assertEquals("\u00A9", decodeBase64Utf8("wqk="))
    }

    @Test
    fun decode_returnsEmptyForEmptyInput() {
        assertEquals("", decodeBase64Utf8(""))
    }

    @Test
    fun decode_returnsEmptyForInvalidBase64() {
        // '@' is outside the base64 alphabet — the decoder throws, the helper swallows it to "".
        assertEquals("", decodeBase64Utf8("@@@@"))
    }

    @Test
    fun decode_returnsEmptyForNonUtf8Binary() {
        // base64 of bytes 0xFF 0xFE — a valid byte run that is NOT valid UTF-8, so the fatal decoder reports it.
        assertEquals("", decodeBase64Utf8("//4="))
    }

    // ---- Projection: head selection + dash fallbacks ---------------------------------------------

    @Test
    fun project_returnsNullWhenNoHead() {
        assertNull(EntryDrawerProjection.project(summary = null, full = null))
    }

    @Test
    fun project_prefersFullOverSummaryForHead() {
        val full = DlqEntryFull(baseSummary.copy(id = 2), rawPayloadB64 = "", innerPayloadB64 = "")
        val display = EntryDrawerProjection.project(summary = baseSummary.copy(id = 1), full = full)!!
        assertEquals("2", display.id)
    }

    @Test
    fun project_appliesDashFallbacksLikeWeb() {
        val display =
            EntryDrawerProjection.project(
                summary =
                    baseSummary.copy(
                        dlqTopic = "",
                        parsedReason = "",
                        parsedVin = null,
                        parsedSourceTopic = null,
                        parsedRedeliveries = null,
                        parseError = null,
                    ),
                full = null,
            )!!
        val dash = EntryDrawerProjection.DASH
        assertEquals(dash, display.dlqTopic)
        assertEquals(dash, display.reason)
        assertEquals(dash, display.vin)
        assertEquals(dash, display.sourceTopic)
        assertEquals(dash, display.redeliveries)
        assertEquals(dash, display.parseError)
    }

    @Test
    fun project_dashesEmptyParseErrorButKeepsNonEmpty() {
        assertEquals(
            EntryDrawerProjection.DASH,
            EntryDrawerProjection.project(baseSummary.copy(parseError = ""), null)!!.parseError,
        )
        assertEquals("boom", EntryDrawerProjection.project(baseSummary.copy(parseError = "boom"), null)!!.parseError)
    }

    @Test
    fun project_formatsRedeliveriesWithGrouping() {
        assertEquals(
            "12,345",
            EntryDrawerProjection.project(baseSummary.copy(parsedRedeliveries = 12_345), null)!!.redeliveries,
        )
    }

    @Test
    fun project_decodesPayloadsOnlyWhenFullPresent() {
        val withoutFull = EntryDrawerProjection.project(baseSummary, null)!!
        assertEquals("", withoutFull.innerText)
        assertEquals("", withoutFull.rawText)
        assertEquals("", withoutFull.innerPayloadB64)
        assertEquals("", withoutFull.rawPayloadB64)

        val full =
            DlqEntryFull(
                baseSummary,
                rawPayloadB64 = b64("raw-text"),
                innerPayloadB64 = b64("inner-text"),
            )
        val withFull = EntryDrawerProjection.project(baseSummary, full)!!
        assertEquals("inner-text", withFull.innerText)
        assertEquals("raw-text", withFull.rawText)
        assertEquals(b64("inner-text"), withFull.innerPayloadB64)
        assertEquals(b64("raw-text"), withFull.rawPayloadB64)
    }

    // ---- copyText / payloadText / payloadSize ----------------------------------------------------

    @Test
    fun copyText_prefersDecodedTextThenBase64ThenEmpty() {
        val textual =
            EntryDrawerProjection.project(
                baseSummary,
                DlqEntryFull(baseSummary, rawPayloadB64 = b64("R"), innerPayloadB64 = b64("I")),
            )!!
        assertEquals("I", EntryDrawerProjection.copyText(EntryDrawerTab.Inner, textual))
        assertEquals("R", EntryDrawerProjection.copyText(EntryDrawerTab.Raw, textual))

        // Binary body (decoded text is "") falls back to the base64 blob.
        val binary =
            EntryDrawerProjection.project(
                baseSummary,
                DlqEntryFull(baseSummary, rawPayloadB64 = "//4=", innerPayloadB64 = "//4="),
            )!!
        assertEquals("//4=", EntryDrawerProjection.copyText(EntryDrawerTab.Inner, binary))
        assertEquals("//4=", EntryDrawerProjection.copyText(EntryDrawerTab.Raw, binary))

        // No full row at all → nothing to copy.
        val none = EntryDrawerProjection.project(baseSummary, null)!!
        assertEquals("", EntryDrawerProjection.copyText(EntryDrawerTab.Inner, none))
        assertEquals("", EntryDrawerProjection.copyText(EntryDrawerTab.Raw, none))
    }

    @Test
    fun payloadText_usesDecodedTextOrBinaryFallback() {
        val textual =
            EntryDrawerProjection.project(
                baseSummary,
                DlqEntryFull(baseSummary, rawPayloadB64 = b64("RAW"), innerPayloadB64 = b64("INNER")),
            )!!
        assertEquals("INNER", EntryDrawerProjection.payloadText(EntryDrawerTab.Inner, textual, "fallback"))

        val binary =
            EntryDrawerProjection.project(
                baseSummary,
                DlqEntryFull(baseSummary, rawPayloadB64 = "//4=", innerPayloadB64 = "//4="),
            )!!
        assertEquals("fallback", EntryDrawerProjection.payloadText(EntryDrawerTab.Inner, binary, "fallback"))
        assertEquals("fallback", EntryDrawerProjection.payloadText(EntryDrawerTab.Raw, binary, "fallback"))
    }

    @Test
    fun payloadSize_selectsTheActiveTabSize() {
        val display =
            EntryDrawerProjection.project(baseSummary.copy(innerPayloadSize = 11, rawPayloadSize = 99), null)!!
        assertEquals(11L, EntryDrawerProjection.payloadSize(EntryDrawerTab.Inner, display))
        assertEquals(99L, EntryDrawerProjection.payloadSize(EntryDrawerTab.Raw, display))
    }

    // ---- replayDisabled (web `!replayEnabled || !head?.replayable || replayInFlight || loading`) --

    @Test
    fun replayDisabled_falseOnlyWhenEverythingPermits() {
        assertFalse(
            EntryDrawerProjection.replayDisabled(
                replayEnabled = true,
                replayable = true,
                replayInFlight = false,
                loading = false,
            ),
        )
    }

    @Test
    fun replayDisabled_trueWhenAnyGateBlocks() {
        assertTrue(
            EntryDrawerProjection.replayDisabled(replayEnabled = false, replayable = true, replayInFlight = false, loading = false),
        )
        assertTrue(
            EntryDrawerProjection.replayDisabled(replayEnabled = true, replayable = false, replayInFlight = false, loading = false),
        )
        assertTrue(
            EntryDrawerProjection.replayDisabled(replayEnabled = true, replayable = true, replayInFlight = true, loading = false),
        )
        assertTrue(
            EntryDrawerProjection.replayDisabled(replayEnabled = true, replayable = true, replayInFlight = false, loading = true),
        )
    }

    // ---- showSpinner (web `loading && !full`) ----------------------------------------------------

    @Test
    fun showSpinner_onlyWhileLoadingWithoutFull() {
        assertTrue(EntryDrawerProjection.showSpinner(loading = true, hasFull = false))
        assertFalse(EntryDrawerProjection.showSpinner(loading = true, hasFull = true))
        assertFalse(EntryDrawerProjection.showSpinner(loading = false, hasFull = false))
    }

    // ---- fmtInt + formatArrivedAt ----------------------------------------------------------------

    @Test
    fun fmtInt_groupsThousands() {
        assertEquals("1,234,567", EntryDrawerProjection.fmtInt(1_234_567))
        assertEquals("0", EntryDrawerProjection.fmtInt(0))
    }

    @Test
    fun formatArrivedAt_formatsParsableInstantAndFallsBackOtherwise() {
        val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneOffset.UTC)
        assertEquals("2024-06-01 12:34", EntryDrawerProjection.formatArrivedAt("2024-06-01T12:34:56Z", formatter))
        // Offset form (no trailing Z) is tolerated and normalized to UTC.
        assertEquals("2024-06-01 10:34", EntryDrawerProjection.formatArrivedAt("2024-06-01T12:34:56+02:00", formatter))
        // Unparseable input returns the raw string unchanged.
        assertEquals("not-a-date", EntryDrawerProjection.formatArrivedAt("not-a-date", formatter))
    }

    // ---- Tab key mapping + registry --------------------------------------------------------------

    @Test
    fun tabFromKey_mapsKnownKeysAndDefaultsToInner() {
        assertEquals(EntryDrawerTab.Inner, EntryDrawerTab.fromKey("inner"))
        assertEquals(EntryDrawerTab.Raw, EntryDrawerTab.fromKey("raw"))
        assertEquals(EntryDrawerTab.Inner, EntryDrawerTab.fromKey("nonsense"))
    }

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("dlq-entry-drawer", EntryDrawerRegistration.ID)
        assertEquals("EntryDrawer", EntryDrawerRegistration.SLUG)
    }

    // ---- Diagnostics -----------------------------------------------------------------------------

    @Test
    fun recordEntryDrawerOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordEntryDrawerOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "EntryDrawer"), fields)
        // The diagnostic must carry no entry id, VIN, topic, or payload — only the surface slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
