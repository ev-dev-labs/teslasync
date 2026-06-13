// Adapter tests for the Toast surface's shared state holder — [DefaultToastController], the native
// `ToastProvider` queue owner that `useToast`/`useOptionalToast`/`useMutationToast` bind to. Covers the
// imperative API (show/success/error/info/warning/dismiss/clear), the unique-id assignment, the
// most-recent cap, and the mutation-toast binder. Framework-free; runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toast

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ToastControllerTest {
    private fun controller(): DefaultToastController {
        var counter = 0
        return DefaultToastController(idFactory = { "t${counter++}" })
    }

    @Test
    fun showFromPartsAssignsAnIdAndDefaultDuration() {
        val controller = controller()

        val id = controller.show(ToastTone.Info, title = "Hello")

        val toast = controller.toasts.value.single()
        assertEquals(id, toast.id)
        assertEquals(ToastTone.Info, toast.tone)
        assertEquals(ToastRegistration.DEFAULT_DURATION_MILLIS, toast.durationMillis)
    }

    @Test
    fun showWithABlankIdAssignsAFreshId() {
        val controller = controller()

        val id = controller.show(ToastMessage(id = "", tone = ToastTone.Info, title = "Hi"))

        assertTrue(id.isNotBlank())
        assertEquals(
            id,
            controller.toasts.value
                .single()
                .id,
        )
    }

    @Test
    fun showWithAnExplicitIdHonoursIt() {
        val controller = controller()

        controller.show(ToastMessage(id = "keep-me", tone = ToastTone.Info, title = "Hi"))

        assertEquals(
            "keep-me",
            controller.toasts.value
                .single()
                .id,
        )
    }

    @Test
    fun convenienceHelpersSetTheirTone() {
        val controller = controller()

        controller.success("ok")
        controller.error("bad")
        controller.info("fyi")
        controller.warning("careful")

        assertEquals(
            listOf(ToastTone.Success, ToastTone.Error, ToastTone.Info, ToastTone.Warning),
            controller.toasts.value.map { it.tone },
        )
    }

    @Test
    fun theQueueIsCappedToTheMostRecent() {
        val controller = controller()

        repeat(7) { i -> controller.info("m$i") }

        assertEquals(ToastRegistration.MAX_VISIBLE, controller.toasts.value.size)
        assertEquals(
            "m6",
            controller.toasts.value
                .last()
                .title,
        )
    }

    @Test
    fun dismissRemovesByIdAndClearEmpties() {
        val controller = controller()
        val a = controller.info("a")
        controller.info("b")

        controller.dismiss(a)
        assertEquals(listOf("b"), controller.toasts.value.map { it.title })

        controller.clear()
        assertTrue(controller.toasts.value.isEmpty())
    }

    @Test
    fun defaultIdFactoryProducesDistinctIds() {
        val factory = defaultToastIdFactory()
        assertNotEquals(factory(), factory())
    }

    @Test
    fun mutationToastEnqueuesTheMappedOutcome() {
        val controller = controller()
        val copy = MutationToastCopy(successTitle = "Saved", errorTitle = "Failed")

        controller.mutationToast(succeeded = true, copy = copy)
        controller.mutationToast(succeeded = false, copy = copy)

        val toasts = controller.toasts.value
        assertEquals(ToastTone.Success, toasts[0].tone)
        assertEquals("Saved", toasts[0].title)
        assertEquals(ToastTone.Error, toasts[1].tone)
        assertEquals("Failed", toasts[1].title)
    }
}
