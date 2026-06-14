// Off-device coverage of the framework-free PinButton model — the pin-state derivation (web
// `pinned.some(p => String(p.item_id) === String(itemId))`), the cache-then-network resource projection
// (envelope preserved), the toggle direction (web `!isPinned`), the action vs visible label split (web
// `tooltipLabel` / `aria-label` vs the `showLabel` text), the toggle toast-title mapping (web
// `useTogglePin` `onSuccess`/`onError`), the read-error classification, and the PII-safe diagnostics (slug
// + outcome only, never the item id). Runs in the :android:testReleaseUnitTest gate; the state holder is
// covered by PinButtonViewModelTest.
package io.teslasync.android.sharedsurfaces.pinbutton

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PinButtonModelTest {
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

    private val labels = PinButtonLabels(pin = "Pin", pinned = "Pinned", unpin = "Unpin")
    private val toastCopy =
        PinButtonToastCopy(
            pinnedSuccess = "Pinned",
            pinnedError = "Failed to pin",
            unpinnedSuccess = "Unpinned",
            unpinnedError = "Failed to unpin",
        )

    private fun pin(
        itemId: String,
        type: PinnedItemType = PinnedItemType.Vehicle,
    ): PinnedItem =
        PinnedItem(
            id = 1,
            itemType = type,
            itemId = itemId,
            position = 0,
            pinnedAt = "2026-01-01T00:00:00Z",
        )

    // ── isItemPinned / projectPinButton ───────────────────────────────────────────────────────────────

    @Test
    fun itemIsPinnedWhenPresentInTheList() {
        assertTrue(isItemPinned(listOf(pin("42"), pin("7")), "42"))
        assertTrue(projectPinButton(listOf(pin("42")), "42").isPinned)
    }

    @Test
    fun itemIsNotPinnedWhenAbsentOrListEmpty() {
        assertFalse(isItemPinned(listOf(pin("7")), "42"))
        // An empty pin list is the unpinned content state, never a separate "empty" surface.
        assertFalse(projectPinButton(emptyList(), "42").isPinned)
        assertFalse(PinButtonData.UNPINNED.isPinned)
    }

    @Test
    fun pinMatchIsAnExactStringComparison() {
        // The wire item_id is a string; "42" must not match "042" or "4".
        assertFalse(isItemPinned(listOf(pin("042")), "42"))
        assertFalse(isItemPinned(listOf(pin("4")), "42"))
    }

    // ── projectPinButtonResource: the cache-then-network envelope is preserved ─────────────────────────

    @Test
    fun loadingWithNoCacheProjectsToLoadingWithNullCache() {
        val projected = projectPinButtonResource(Resource.Loading(cached = null, fetchedAt = null, stale = false), "42")
        val loading = projected as Resource.Loading
        assertEquals(null, loading.cached)
    }

    @Test
    fun loadingWithCacheProjectsTheCachedPinState() {
        val source = Resource.Loading(cached = listOf(pin("42")), fetchedAt = 100L, stale = true)
        val loading = projectPinButtonResource(source, "42") as Resource.Loading
        assertTrue(loading.cached?.isPinned ?: false)
        assertEquals(100L, loading.fetchedAt)
        assertTrue(loading.stale)
    }

    @Test
    fun successProjectsThePinStateAndKeepsFreshness() {
        val source = Resource.Success(listOf(pin("42")), fetchedAt = 200L, stale = false)
        val success = projectPinButtonResource(source, "42") as Resource.Success
        assertTrue(success.data.isPinned)
        assertEquals(200L, success.fetchedAt)
    }

    @Test
    fun errorWithCacheKeepsTheCachedPinStateAndTheError() {
        val cause = ApiError.Network()
        val source = Resource.Error(cached = listOf(pin("42")), fetchedAt = 300L, stale = true, error = cause)
        val error = projectPinButtonResource(source, "42") as Resource.Error
        assertTrue(error.cached?.isPinned ?: false)
        assertEquals(cause, error.error)
    }

    @Test
    fun errorWithNoCacheProjectsToErrorWithNullCache() {
        val source = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val error = projectPinButtonResource(source, "42") as Resource.Error
        assertEquals(null, error.cached)
    }

    // ── pinToggleTarget / labels ───────────────────────────────────────────────────────────────────────

    @Test
    fun toggleTargetIsTheInverseOfTheCurrentState() {
        assertTrue(pinToggleTarget(isPinned = false))
        assertFalse(pinToggleTarget(isPinned = true))
    }

    @Test
    fun actionLabelIsTheVerbThatMatchesTheNextTap() {
        // Tooltip + aria-label: an unpinned item offers "Pin", a pinned item offers "Unpin".
        assertEquals("Pin", pinActionLabel(isPinned = false, labels))
        assertEquals("Unpin", pinActionLabel(isPinned = true, labels))
    }

    @Test
    fun stateLabelIsTheNounThatMatchesTheCurrentState() {
        // Visible showLabel text: "Pin" when unpinned, "Pinned" when pinned (differs from the action verb).
        assertEquals("Pin", pinStateLabel(isPinned = false, labels))
        assertEquals("Pinned", pinStateLabel(isPinned = true, labels))
    }

    // ── pinToggleToastTitle: web useTogglePin onSuccess/onError copy ───────────────────────────────────

    @Test
    fun toastTitleCoversEveryDirectionAndOutcome() {
        assertEquals("Pinned", pinToggleToastTitle(pin = true, succeeded = true, toastCopy))
        assertEquals("Failed to pin", pinToggleToastTitle(pin = true, succeeded = false, toastCopy))
        assertEquals("Unpinned", pinToggleToastTitle(pin = false, succeeded = true, toastCopy))
        assertEquals("Failed to unpin", pinToggleToastTitle(pin = false, succeeded = false, toastCopy))
    }

    // ── pinToggleOutcome ──────────────────────────────────────────────────────────────────────────────

    @Test
    fun toggleOutcomeMapsDirectionAndSuccess() {
        assertEquals(PinToggleOutcome.Pinned, pinToggleOutcome(pin = true, succeeded = true))
        assertEquals(PinToggleOutcome.Unpinned, pinToggleOutcome(pin = false, succeeded = true))
        assertEquals(PinToggleOutcome.Failed, pinToggleOutcome(pin = true, succeeded = false))
        assertEquals(PinToggleOutcome.Failed, pinToggleOutcome(pin = false, succeeded = false))
    }

    // ── pinButtonErrorKind ────────────────────────────────────────────────────────────────────────────

    @Test
    fun errorKindFoldsConnectivityAndStatus() {
        assertEquals(QueryErrorKind.Waiting, pinButtonErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Offline, pinButtonErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, pinButtonErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.NotFound, pinButtonErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, pinButtonErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Network, pinButtonErrorKind(ErrorKind.Unknown, null))
    }

    // ── registration + per-placement id ───────────────────────────────────────────────────────────────

    @Test
    fun surfaceSlugIsTheMandatedDiagnosticsSlug() {
        assertEquals("PinButton", PinButtonRegistration.SLUG)
    }

    @Test
    fun perPlacementInstanceIdsAreUnique() {
        assertTrue(randomPinButtonInstanceId() != randomPinButtonInstanceId())
    }

    @Test
    fun i18nKeyNamesMatchTheGeneratedCatalog() {
        assertEquals("translation_pin_pin", PinButtonKeys.PIN)
        assertEquals("translation_pin_pinned", PinButtonKeys.PINNED)
        assertEquals("translation_pin_unpin", PinButtonKeys.UNPIN)
        assertEquals("translation_toast_pin_pinned_success", PinButtonKeys.TOAST_PINNED_SUCCESS)
        assertEquals("translation_toast_pin_unpinned_success", PinButtonKeys.TOAST_UNPINNED_SUCCESS)
    }

    // ── diagnostics: PII-safe slug + outcome only ─────────────────────────────────────────────────────

    @Test
    fun viewOpenedRecordsSlugOnly() {
        val logger = RecordingLogger()
        recordPinButtonOpened(logger)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_VIEW_OPENED, record.event)
        assertEquals(mapOf(FIELD_SURFACE to PinButtonRegistration.SLUG), record.fields)
    }

    @Test
    fun toggleRecordsSlugAndLowercasedOutcome() {
        val logger = RecordingLogger()
        recordPinButtonToggle(logger, PinToggleOutcome.Pinned)
        val record = logger.records.single()
        assertEquals(EVENT_TOGGLE, record.event)
        assertEquals(
            mapOf(FIELD_SURFACE to PinButtonRegistration.SLUG, FIELD_OUTCOME to "pinned"),
            record.fields,
        )
    }

    @Test
    fun everyOutcomeMapsToItsLowercaseName() {
        val logger = RecordingLogger()
        PinToggleOutcome.entries.forEach { recordPinButtonToggle(logger, it) }
        val outcomes = logger.records.map { it.fields.getValue(FIELD_OUTCOME) }
        assertEquals(listOf("pinned", "unpinned", "failed"), outcomes)
    }

    @Test
    fun toggleDiagnosticsNeverCarryAnItemIdField() {
        val logger = RecordingLogger()
        recordPinButtonToggle(logger, PinToggleOutcome.Unpinned)
        // Only the surface slug + the outcome enum are ever recorded — never the pinned item id.
        val record = logger.records.single()
        assertEquals(setOf(FIELD_SURFACE, FIELD_OUTCOME), record.fields.keys)
    }

    @Test
    fun retryRecordsSlugOnly() {
        val logger = RecordingLogger()
        recordPinButtonRetry(logger)
        val record = logger.records.single()
        assertEquals(EVENT_RETRY, record.event)
        assertEquals(mapOf(FIELD_SURFACE to PinButtonRegistration.SLUG), record.fields)
    }
}
