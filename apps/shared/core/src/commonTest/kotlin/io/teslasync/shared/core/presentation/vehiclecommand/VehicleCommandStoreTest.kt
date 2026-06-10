package io.teslasync.shared.core.presentation.vehiclecommand

import io.teslasync.shared.core.data.repo.VehicleCommandRepository
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [VehicleCommandStore] routes the single web `useVehicleCommand` mutation to the
 * S7 [VehicleCommandRepository] verbatim — same input, same [Result] passthrough — using a fake
 * repository, so no network or cache is involved. The endpoint/body and the cache-invalidation set
 * are the repository's contract (covered by `VehicleCommandRepositoryContractTest`); here we only
 * assert the holder is a faithful, side-effect-free conduit.
 */
class VehicleCommandStoreTest {
    /** Fake S7 port: records each call's input and returns a programmable [Result]. */
    private class FakeVehicleCommandRepository(
        private val result: Result<CommandResult> = Result.success(CommandResult(success = true, message = "ok")),
    ) : VehicleCommandRepository {
        val calls: MutableList<SendVehicleCommandInput> = mutableListOf()

        override suspend fun sendCommand(input: SendVehicleCommandInput): Result<CommandResult> {
            calls += input
            return result
        }
    }

    @Test
    fun sendCommandForwardsTheInputVerbatim() =
        runTest {
            val repo = FakeVehicleCommandRepository()
            val store = VehicleCommandStore(repo)
            val params = buildJsonObject { put("temp", 21) }
            val input = SendVehicleCommandInput(vehicleId = 7, command = "set_temp", params = params)

            store.sendCommand(input)

            assertEquals(1, repo.calls.size)
            assertEquals(input, repo.calls.single())
        }

    @Test
    fun sendCommandReturnsTheRepositorySuccessVerbatim() =
        runTest {
            val expected = CommandResult(success = true, message = "Command sent")
            val store = VehicleCommandStore(FakeVehicleCommandRepository(Result.success(expected)))

            val result = store.sendCommand(SendVehicleCommandInput(vehicleId = 7, command = "wake_up"))

            assertTrue(result.isSuccess)
            assertEquals(expected, result.getOrNull())
        }

    @Test
    fun sendCommandPropagatesRepositoryFailureVerbatim() =
        runTest {
            val boom = IllegalStateException("tesla auth expired")
            val store = VehicleCommandStore(FakeVehicleCommandRepository(Result.failure(boom)))

            val result = store.sendCommand(SendVehicleCommandInput(vehicleId = 7, command = "wake_up"))

            assertTrue(result.isFailure)
            // The auth-expired failure flows out untouched so the platform recovery surface can act.
            assertSame(boom, result.exceptionOrNull())
        }

    @Test
    fun nullParamsAreForwardedUnchanged() =
        runTest {
            val repo = FakeVehicleCommandRepository()
            val store = VehicleCommandStore(repo)

            store.sendCommand(SendVehicleCommandInput(vehicleId = 7, command = "wake_up"))

            assertEquals(null, repo.calls.single().params)
        }
}
