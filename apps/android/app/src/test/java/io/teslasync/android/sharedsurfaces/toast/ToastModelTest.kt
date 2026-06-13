// Pure-projection tests for the Toast surface model — the framework-free contract the composable
// renders: the tone → palette/live-region mapping, the navigate-vs-callback action resolution
// (navigation wins), the enqueue cap (web `slice(-4)` → five), dismissal, the folded host state, and
// the mutation-toast mapping. Runs in :android:testReleaseUnitTest with no Android/Compose host.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toast

import io.teslasync.android.components.feedback.Tone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ToastModelTest {
    private fun message(
        id: String,
        tone: ToastTone = ToastTone.Info,
        durationMillis: Long = ToastRegistration.DEFAULT_DURATION_MILLIS,
    ) = ToastMessage(id = id, tone = tone, title = "t-$id", durationMillis = durationMillis)

    @Test
    fun toneMapsOntoTheSharedPaletteTone() {
        assertEquals(Tone.Success, ToastTone.Success.toFeedbackTone())
        assertEquals(Tone.Danger, ToastTone.Error.toFeedbackTone())
        assertEquals(Tone.Info, ToastTone.Info.toFeedbackTone())
        assertEquals(Tone.Warning, ToastTone.Warning.toFeedbackTone())
    }

    @Test
    fun onlyTheErrorVariantAnnouncesAssertively() {
        assertEquals(ToastLiveRegion.Assertive, ToastTone.Error.liveRegion())
        assertEquals(ToastLiveRegion.Polite, ToastTone.Success.liveRegion())
        assertEquals(ToastLiveRegion.Polite, ToastTone.Info.liveRegion())
        assertEquals(ToastLiveRegion.Polite, ToastTone.Warning.liveRegion())
        assertTrue(message("e", ToastTone.Error).isAssertive)
        assertFalse(message("s", ToastTone.Success).isAssertive)
    }

    @Test
    fun navigationActionWinsWhenBothTargetsAreSupplied() {
        val nav = toastAction(label = "View", route = "/battery", onClick = {})
        assertTrue(nav is ToastAction.Navigate)
        assertEquals("/battery", (nav as ToastAction.Navigate).route)
    }

    @Test
    fun callbackActionIsBuiltWhenOnlyAHandlerIsSupplied() {
        var fired = false
        val action = toastAction(label = "Undo", onClick = { fired = true })
        assertTrue(action is ToastAction.Callback)
        (action as ToastAction.Callback).onInvoke()
        assertTrue(fired)
    }

    @Test
    fun noActionIsBuiltWhenNeitherTargetIsSupplied() {
        assertNull(toastAction(label = "View"))
    }

    @Test
    fun autoDismissesReflectsAPositiveDuration() {
        assertTrue(message("a", durationMillis = 4_000L).autoDismisses)
        assertFalse(message("b", durationMillis = 0L).autoDismisses)
        assertFalse(message("c", durationMillis = -1L).autoDismisses)
    }

    @Test
    fun enqueueAppendsAndCapsToTheMostRecent() {
        var queue = emptyList<ToastMessage>()
        repeat(7) { i -> queue = enqueueToastMessage(queue, message("m$i"), max = ToastRegistration.MAX_VISIBLE) }

        assertEquals(ToastRegistration.MAX_VISIBLE, queue.size)
        assertEquals(listOf("m2", "m3", "m4", "m5", "m6"), queue.map { it.id })
    }

    @Test
    fun enqueueReplacesAToastReusingAnId() {
        val first = enqueueToastMessage(emptyList(), message("dup", ToastTone.Info))
        val replaced = enqueueToastMessage(first, message("dup", ToastTone.Error))

        assertEquals(1, replaced.size)
        assertEquals(ToastTone.Error, replaced.single().tone)
    }

    @Test
    fun dismissRemovesTheMatchingToast() {
        val queue = listOf(message("a"), message("b"), message("c"))
        assertEquals(listOf("a", "c"), dismissToastMessage(queue, "b").map { it.id })
    }

    @Test
    fun projectFoldsTheQueueIntoTheHostState() {
        assertTrue(projectToastHost(emptyList()).isEmpty)
        val populated = projectToastHost(listOf(message("a", ToastTone.Error), message("b")))
        assertTrue(populated.isVisible)
        assertFalse(populated.isEmpty)
        assertTrue(populated.hasAssertive)
        assertFalse(projectToastHost(listOf(message("c", ToastTone.Info))).hasAssertive)
    }

    @Test
    fun mutationToastMessageMapsTheOutcomeOntoTheTone() {
        val copy = MutationToastCopy(successTitle = "Saved", errorTitle = "Failed")

        val ok = mutationToastMessage(id = "ok", succeeded = true, copy = copy)
        assertEquals(ToastTone.Success, ok.tone)
        assertEquals("Saved", ok.title)

        val bad = mutationToastMessage(id = "bad", succeeded = false, copy = copy)
        assertEquals(ToastTone.Error, bad.tone)
        assertEquals("Failed", bad.title)
    }
}
