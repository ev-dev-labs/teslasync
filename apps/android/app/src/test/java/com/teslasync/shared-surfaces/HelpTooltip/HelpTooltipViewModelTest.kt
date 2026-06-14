// Tests [HelpTooltipViewModel] against a fake [LinkOpener] seam — covering the one-shot `view.opened`
// diagnostic, the link open that routes the chosen URL through the seam and records the `opened` outcome (web:
// the new tab launching), the failed open that records `failed` when the platform has no handler (web: a
// blocked navigation), the exact URL reaching the seam (while never reaching the diagnostic), and the PII-safe
// diagnostic shape (surface slug + coarse outcome only). The framework-free model is covered by
// HelpTooltipModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helptooltip

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HelpTooltipViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private class RecordingOpener(
        private val accept: Boolean,
    ) : LinkOpener {
        val opened = mutableListOf<String>()

        override fun open(url: String): Boolean {
            opened += url
            return accept
        }
    }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = HelpTooltipViewModel(RecordingOpener(accept = true), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("HelpTooltip", opened.first().fields["surface"])
        }

    @Test
    fun learnMoreOpensTheUrlAndRecordsOpenedWhenAccepted() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val opener = RecordingOpener(accept = true)
            val model = HelpTooltipViewModel(opener, logger, backgroundScope)

            model.onLearnMore("https://docs.example/vampire-drain")

            assertEquals(listOf("https://docs.example/vampire-drain"), opener.opened)
            val record = logger.records.single { it.event == "helpTooltip.learnMore" }
            assertEquals(mapOf("surface" to "HelpTooltip", "outcome" to "opened"), record.fields)
        }

    @Test
    fun learnMoreRecordsFailedWhenThePlatformRejectsTheOpen() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val opener = RecordingOpener(accept = false)
            val model = HelpTooltipViewModel(opener, logger, backgroundScope)

            model.onLearnMore("tel:+100")

            assertEquals(listOf("tel:+100"), opener.opened)
            val record = logger.records.single { it.event == "helpTooltip.learnMore" }
            assertEquals("failed", record.fields["outcome"])
        }

    @Test
    fun learnMoreDiagnosticNeverCarriesTheUrl() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val secretUrl = "https://docs.example/secret?token=abc123"
            val model = HelpTooltipViewModel(RecordingOpener(accept = true), logger, backgroundScope)

            model.onLearnMore(secretUrl)

            val record = logger.records.single { it.event == "helpTooltip.learnMore" }
            // Only the surface slug and the coarse outcome — the opened URL never reaches a diagnostic field.
            assertEquals(setOf("surface", "outcome"), record.fields.keys)
            assertTrue(record.fields.values.none { it.contains("token") })
        }
}
