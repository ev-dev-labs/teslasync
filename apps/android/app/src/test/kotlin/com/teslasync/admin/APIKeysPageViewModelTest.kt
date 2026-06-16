@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A no-op [Logger] for the off-device ViewModel tests — diagnostics are not the unit under test here. */
private object NoopLogger : Logger {
    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) = Unit
}

/**
 * Off-device coverage for [ApiKeysPageViewModel]: the interaction-state transitions (the web `useState` group)
 * and the three mutations routed through a recording [InMemoryApiKeysSource] fake — no Compose/Android/HTTP in
 * scope. Each test runs on an [UnconfinedTestDispatcher] so the ViewModel's launched mutations execute eagerly,
 * and the feed StateFlow lives in `backgroundScope` so it is never counted as a leak.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class APIKeysPageViewModelTest {
    @Test
    fun openAndCloseCreate_toggleTheModalAndClearTheForm() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = ApiKeysPageViewModel(InMemoryApiKeysSource(), NoopLogger, backgroundScope)

            vm.openCreate()
            assertTrue(vm.interaction.value.showCreate)
            assertNull(vm.interaction.value.generatedKey)

            vm.setName("My Application")
            vm.closeCreate()
            assertFalse(vm.interaction.value.showCreate)
            assertEquals("", vm.interaction.value.newName)
            assertNull(vm.interaction.value.generatedKey)
        }

    @Test
    fun canGenerate_requiresANonBlankName() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = ApiKeysPageViewModel(InMemoryApiKeysSource(), NoopLogger, backgroundScope)

            assertFalse(vm.interaction.value.canGenerate)
            vm.setName("   ")
            assertFalse(vm.interaction.value.canGenerate)
            vm.setName("My Application")
            assertTrue(vm.interaction.value.canGenerate)
        }

    @Test
    fun generate_mintsTheKeyRevealsTheSecretAndClearsTheName() =
        runTest(UnconfinedTestDispatcher()) {
            val source = InMemoryApiKeysSource()
            val vm = ApiKeysPageViewModel(source, NoopLogger, backgroundScope)

            vm.setName("My Application")
            vm.setPermission(PermissionLevel.Admin)
            vm.generate()

            assertEquals(listOf("My Application" to PermissionLevel.Admin), source.createCalls)
            assertEquals(InMemoryApiKeysSource.SAMPLE_NEW_KEY, vm.interaction.value.generatedKey)
            assertEquals("", vm.interaction.value.newName)
            assertFalse(vm.interaction.value.creating)
        }

    @Test
    fun generate_isANoOpWhenTheNameIsBlank() =
        runTest(UnconfinedTestDispatcher()) {
            val source = InMemoryApiKeysSource()
            val vm = ApiKeysPageViewModel(source, NoopLogger, backgroundScope)

            vm.generate()

            assertTrue(source.createCalls.isEmpty())
            assertNull(vm.interaction.value.generatedKey)
        }

    @Test
    fun requestThenConfirmDelete_callsTheSourceAndClearsTheTarget() =
        runTest(UnconfinedTestDispatcher()) {
            val source = InMemoryApiKeysSource()
            val vm = ApiKeysPageViewModel(source, NoopLogger, backgroundScope)
            val target = InMemoryApiKeysSource.SAMPLE_KEYS.first()

            vm.requestDelete(target)
            assertEquals(target, vm.interaction.value.deleteTarget)

            vm.confirmDelete()

            assertEquals(listOf(target.id), source.deleteCalls)
            assertNull(vm.interaction.value.deleteTarget)
        }

    @Test
    fun cancelDelete_dismissesTheConfirmationWithoutCalling() =
        runTest(UnconfinedTestDispatcher()) {
            val source = InMemoryApiKeysSource()
            val vm = ApiKeysPageViewModel(source, NoopLogger, backgroundScope)

            vm.requestDelete(InMemoryApiKeysSource.SAMPLE_KEYS.first())
            vm.cancelDelete()

            assertNull(vm.interaction.value.deleteTarget)
            assertTrue(source.deleteCalls.isEmpty())
        }

    @Test
    fun revoke_callsTheSourceWithTheKeyId() =
        runTest(UnconfinedTestDispatcher()) {
            val source = InMemoryApiKeysSource()
            val vm = ApiKeysPageViewModel(source, NoopLogger, backgroundScope)

            vm.revoke(42L)

            assertEquals(listOf(42L), source.revokeCalls)
        }
}
