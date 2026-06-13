// Off-device unit coverage for the NavigationGuardProvider surface's pure model + coordinator (P3 acceptance:
// adapter + per-state tests). Exercises the prompt-mandated registration slug, the guard [NavigationGuardRegistry]
// (membership, insertion-ordered findDirty, isolation, re-register replacement — the web provider's `guards` Map),
// the [NavigationGuardSurface] render states, the [NoopNavigationGuardController] (web `NOOP_CTX`), and the
// [NavigationGuardCoordinator] promise lifecycle (resolve-true on discard, resolve-false on keep-editing, the
// generic-vs-per-guard message, the single in-flight de-duplication mirroring the web `pendingPromiseRef`, and the
// idempotent resolve). No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference
// behaviour is web/src/components/feedback/NavigationGuardProvider.tsx.

package io.teslasync.android.sharedsurfaces.navigationguardprovider

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NavigationGuardProviderModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug ──────────────────────────────────────

    @Test
    fun registrationMetadataMatchesThePromptSlug() {
        assertEquals("navigation-guard-provider", NavigationGuardProviderRegistration.ID)
        assertEquals("NavigationGuardProvider", NavigationGuardProviderRegistration.SLUG)
    }

    @Test
    fun unsavedNavigationSilenceKeyMatchesTheWebContract() {
        // The web `<ConfirmDialog silenceKey="unsaved-navigation" />` — a stable storage id, not display copy.
        assertEquals("unsaved-navigation", UNSAVED_NAVIGATION_SILENCE_KEY)
    }

    // ── NavigationGuardEntry — the web entry shape ──────────────────────────────────────────────────────────

    @Test
    fun entryDefaultsToNoCustomMessage() {
        val entry = NavigationGuardEntry(id = "form", isDirty = { true })
        assertTrue(entry.isDirty())
        assertNull("a guard with no custom prompt falls back to the generic warning", entry.getMessage())
    }

    // ── NavigationGuardRegistry — the web `guards` Map + register + findDirty ────────────────────────────────

    @Test
    fun registerAddsAndUnregisterRemoves() {
        val registry = NavigationGuardRegistry()
        val unregister = registry.register(NavigationGuardEntry(id = "form", isDirty = { true }))
        assertEquals(1, registry.size)
        assertTrue(registry.isAnyDirty)

        unregister()
        assertEquals(0, registry.size)
        assertFalse(registry.isAnyDirty)
    }

    @Test
    fun findDirtyReturnsTheFirstRegisteredDirtyGuardInInsertionOrder() {
        val registry = NavigationGuardRegistry()
        registry.register(NavigationGuardEntry(id = "clean", isDirty = { false }))
        registry.register(NavigationGuardEntry(id = "first-dirty", isDirty = { true }, getMessage = { "first" }))
        registry.register(NavigationGuardEntry(id = "second-dirty", isDirty = { true }, getMessage = { "second" }))

        assertEquals("first-dirty", registry.findDirty()?.id)
    }

    @Test
    fun findDirtyIsNullWhenNoGuardIsDirty() {
        val registry = NavigationGuardRegistry()
        registry.register(NavigationGuardEntry(id = "a", isDirty = { false }))
        registry.register(NavigationGuardEntry(id = "b", isDirty = { false }))

        assertNull(registry.findDirty())
        assertFalse(registry.isAnyDirty)
    }

    @Test
    fun reRegisteringTheSameIdReplacesTheEntry() {
        val registry = NavigationGuardRegistry()
        registry.register(NavigationGuardEntry(id = "form", isDirty = { true }))
        registry.register(NavigationGuardEntry(id = "form", isDirty = { false }))

        assertEquals(1, registry.size)
        assertFalse(registry.isAnyDirty)
    }

    // ── NavigationGuardSurface — the render states (web `pending` null vs PendingConfirm) ────────────────────

    @Test
    fun confirmingSurfaceIsValueEqualByMessage() {
        assertEquals(NavigationGuardSurface.Confirming("m"), NavigationGuardSurface.Confirming("m"))
        assertNotEquals(NavigationGuardSurface.Confirming("m"), NavigationGuardSurface.Confirming(null))
    }

    // ── NoopNavigationGuardController — the web NOOP_CTX ─────────────────────────────────────────────────────

    @Test
    fun noopControllerAllowsNavigationAndRegistersNothing() =
        runTest(UnconfinedTestDispatcher()) {
            val unregister = NoopNavigationGuardController.register(NavigationGuardEntry(id = "x", isDirty = { true }))
            unregister() // no-op cleanup must not throw

            assertTrue("no provider mounted -> navigation is always allowed", NoopNavigationGuardController.confirmIfDirty())
        }

    // ── NavigationGuardCoordinator — confirmIfDirty promise lifecycle (web per-state) ───────────────────────

    @Test
    fun confirmIfDirtyResolvesTrueWhenNothingIsDirty() =
        runTest(UnconfinedTestDispatcher()) {
            val coordinator = NavigationGuardCoordinator()
            coordinator.register(NavigationGuardEntry(id = "form", isDirty = { false }))

            assertTrue(coordinator.confirmIfDirty())
            // No dialog was raised — the surface stays idle (web `if (!dirty) return Promise.resolve(true)`).
            assertEquals(NavigationGuardSurface.Idle, coordinator.surface.value)
        }

    @Test
    fun aDirtyGuardSurfacesTheDialogAndDiscardResolvesTrue() =
        runTest(UnconfinedTestDispatcher()) {
            val coordinator = NavigationGuardCoordinator()
            coordinator.register(NavigationGuardEntry(id = "form", isDirty = { true }))

            val result = async { coordinator.confirmIfDirty() }
            assertEquals(NavigationGuardSurface.Confirming(null), coordinator.surface.value)

            coordinator.confirm() // web handleConfirm -> resolve(true)
            assertTrue(result.await())
            assertEquals(NavigationGuardSurface.Idle, coordinator.surface.value)
        }

    @Test
    fun keepEditingResolvesFalseAndClosesTheDialog() =
        runTest(UnconfinedTestDispatcher()) {
            val coordinator = NavigationGuardCoordinator()
            coordinator.register(NavigationGuardEntry(id = "form", isDirty = { true }))

            val result = async { coordinator.confirmIfDirty() }
            assertEquals(NavigationGuardSurface.Confirming(null), coordinator.surface.value)

            coordinator.cancel() // web handleCancel -> resolve(false)
            assertFalse(result.await())
            assertEquals(NavigationGuardSurface.Idle, coordinator.surface.value)
        }

    @Test
    fun aDirtyGuardUsesItsOwnLocalizedMessageWhenProvided() =
        runTest(UnconfinedTestDispatcher()) {
            val coordinator = NavigationGuardCoordinator()
            coordinator.register(
                NavigationGuardEntry(id = "rule", isDirty = { true }, getMessage = { "You have an unsaved alert rule." }),
            )

            val result = async { coordinator.confirmIfDirty() }
            assertEquals(NavigationGuardSurface.Confirming("You have an unsaved alert rule."), coordinator.surface.value)

            coordinator.confirm()
            assertTrue(result.await())
        }

    @Test
    fun aSecondConfirmIfDirtyJoinsTheSameInFlightDialog() =
        runTest(UnconfinedTestDispatcher()) {
            // web pendingPromiseRef: a popstate dialog already open + a click intercept share ONE dialog.
            val coordinator = NavigationGuardCoordinator()
            coordinator.register(NavigationGuardEntry(id = "form", isDirty = { true }))

            val first = async { coordinator.confirmIfDirty() }
            val second = async { coordinator.confirmIfDirty() }
            assertEquals(NavigationGuardSurface.Confirming(null), coordinator.surface.value)

            coordinator.cancel()
            assertFalse(first.await())
            assertFalse(second.await())
            assertEquals(NavigationGuardSurface.Idle, coordinator.surface.value)
        }

    @Test
    fun resolveWithNothingPendingIsAnIdempotentNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val coordinator = NavigationGuardCoordinator()
            // A stray confirm/cancel after the dialog already closed must neither throw nor leave a stale surface.
            coordinator.confirm()
            coordinator.cancel()
            assertEquals(NavigationGuardSurface.Idle, coordinator.surface.value)
        }

    @Test
    fun coordinatorIsAnyDirtyReflectsTheRegistry() =
        runTest(UnconfinedTestDispatcher()) {
            val coordinator = NavigationGuardCoordinator()
            assertFalse(coordinator.isAnyDirty)

            val unregister = coordinator.register(NavigationGuardEntry(id = "form", isDirty = { true }))
            assertTrue(coordinator.isAnyDirty)

            unregister()
            assertFalse(coordinator.isAnyDirty)
        }
}
