package io.teslasync.android.sharedsurfaces.draftrecoverybanner

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * On-device Compose UI + accessibility verification of the DraftRecoveryBanner shared surface across every state
 * the web component renders (web/src/components/feedback/DraftRecoveryBanner.tsx): the hidden surface (no draft /
 * already acted → nothing), the named-item message ("{noun} draft restored from {when}."), the noun-free message
 * ("Draft restored from {when}."), and the relative-age phrase (just-now / minutes / unknown). It asserts the
 * localized i18n message renders, that both actions are labelled, displayed, clickable buttons (TalkBack names),
 * that tapping either action dismisses the banner and invokes the right callback, and that the one-shot PII-safe
 * `view.opened` diagnostic fires. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the
 * pure [classify] + [relativeDraftAge] + diagnostics.
 */
class DraftRecoveryBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun useDraftLabel() = context.getString(R.string.translation_draft_useDraft)

    private fun discardLabel() = context.getString(R.string.translation_draft_discardDraft)

    private fun setSurface(surface: DraftBannerSurface) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRecoveryBannerContent(surface = surface)
            }
        }
        compose.waitForIdle()
    }

    private fun mountStateful(
        onRestore: () -> Unit = {},
        onDiscard: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRecoveryBanner(
                    hasDraft = true,
                    draftSavedAt = Instant.now(),
                    onDiscard = onDiscard,
                    onRestore = onRestore,
                    itemNoun = "Alert rule",
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()
    }

    // ── State: named item — "{noun} draft restored from {when}." + both actions ───────────────────────

    @Test
    fun visibleWithNounShowsTheNamedMessageAndBothActions() {
        val noun = "Alert rule"
        setSurface(DraftBannerSurface.Visible(noun = noun, age = DraftAge.JustNow))

        val justNow = context.getString(R.string.translation_palette_recent_justNow)
        val message = context.getString(R.string.translation_draft_restoredItem, noun, justNow)
        compose.onNodeWithText(message).assertIsDisplayed()
        compose.onNodeWithText(useDraftLabel()).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(discardLabel()).assertIsDisplayed().assertHasClickAction()
    }

    // ── State: no noun — "Draft restored from {when}." ────────────────────────────────────────────────

    @Test
    fun visibleWithoutNounShowsTheNounFreeMessage() {
        setSurface(DraftBannerSurface.Visible(noun = null, age = DraftAge.Unknown))

        val aMomentAgo = context.getString(R.string.translation_draft_unknownTime)
        val message = context.getString(R.string.translation_draft_restored, aMomentAgo)
        compose.onNodeWithText(message).assertIsDisplayed()
    }

    // ── State: relative minutes — the pluralized "{n}m ago" phrase ────────────────────────────────────

    @Test
    fun minutesAgeRendersThePluralizedRelativePhrase() {
        setSurface(DraftBannerSurface.Visible(noun = null, age = DraftAge.Minutes(5)))

        val fiveMinutes = context.resources.getQuantityString(R.plurals.translation_palette_recent_minutesAgo, 5, 5)
        val message = context.getString(R.string.translation_draft_restored, fiveMinutes)
        compose.onNodeWithText(message).assertIsDisplayed()
    }

    // ── State: hidden — nothing renders (web `null`) ──────────────────────────────────────────────────

    @Test
    fun hiddenSurfaceRendersNothing() {
        setSurface(DraftBannerSurface.Hidden)

        compose.onNodeWithText(useDraftLabel()).assertDoesNotExist()
        compose.onNodeWithText(discardLabel()).assertDoesNotExist()
    }

    // ── Interaction: "Use draft" dismisses + invokes onRestore (web `handleRestore`) ──────────────────

    @Test
    fun tappingUseDraftDismissesAndInvokesRestore() {
        var restores = 0
        mountStateful(onRestore = { restores++ })

        compose.onNodeWithText(useDraftLabel()).performClick()
        compose.waitForIdle()

        assertEquals(1, restores)
        compose.onNodeWithText(useDraftLabel()).assertDoesNotExist()
    }

    // ── Interaction: "Discard draft" dismisses + invokes onDiscard (web `handleDiscard`) ──────────────

    @Test
    fun tappingDiscardDismissesAndInvokesDiscard() {
        var discards = 0
        mountStateful(onDiscard = { discards++ })

        compose.onNodeWithText(discardLabel()).performClick()
        compose.waitForIdle()

        assertEquals(1, discards)
        compose.onNodeWithText(discardLabel()).assertDoesNotExist()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DraftRecoveryBanner(
                    hasDraft = true,
                    draftSavedAt = Instant.now(),
                    onDiscard = {},
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DraftRecoveryBanner"), fields)
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
