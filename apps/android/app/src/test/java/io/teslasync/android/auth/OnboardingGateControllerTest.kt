package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.auth.TokenSet
import io.teslasync.shared.core.data.repo.OnboardingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [OnboardingGateController] — the navigation shell's auth-guard seam (P3/A4,
 * ADR-013). A fake auth [MutableStateFlow] drives the gate over a fake [OnboardingRepository] whose
 * cache-then-network emissions are hand-built, so the decisions are verified without a network:
 * a fresh sign-in reads the gate and requires onboarding only when it is incomplete, sign-out resets
 * it, the fetch fails open on a hard error, intermediate auth states are ignored, and a new session
 * re-evaluates.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingGateControllerTest {
    private class FakeOnboardingRepository : OnboardingRepository {
        var emissions: List<Resource<OnboardingStatus>> = listOf(Resource.Loading(null, null, false))

        override fun status(): Flow<Resource<OnboardingStatus>> = flow { emissions.forEach { emit(it) } }
    }

    private fun signedIn(): AuthState.SignedIn = AuthState.SignedIn(TokenSet("a", "r", null, 9_999L))

    private fun complete(isComplete: Boolean): Resource<OnboardingStatus> =
        Resource.Success(OnboardingStatus(isComplete = isComplete), 100L, false)

    @Test
    fun signedInWithIncompleteOnboardingRequiresIt() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeOnboardingRepository()
            repo.emissions = listOf(Resource.Loading(null, null, false), complete(isComplete = false))
            val auth = MutableStateFlow<AuthState>(AuthState.SignedOut)
            val gate = OnboardingGateController(repo, auth, backgroundScope)

            gate.start()
            auth.value = signedIn()
            advanceUntilIdle()

            assertTrue(gate.required.value)
        }

    @Test
    fun signedInWithCompleteOnboardingDoesNotRequireIt() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeOnboardingRepository()
            repo.emissions = listOf(complete(isComplete = true))
            val auth = MutableStateFlow<AuthState>(AuthState.SignedOut)
            val gate = OnboardingGateController(repo, auth, backgroundScope)

            gate.start()
            auth.value = signedIn()
            advanceUntilIdle()

            assertFalse(gate.required.value)
        }

    @Test
    fun signOutResetsRequirement() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeOnboardingRepository()
            repo.emissions = listOf(complete(isComplete = false))
            val auth = MutableStateFlow<AuthState>(AuthState.SignedOut)
            val gate = OnboardingGateController(repo, auth, backgroundScope)

            gate.start()
            auth.value = signedIn()
            advanceUntilIdle()
            assertTrue(gate.required.value)

            auth.value = AuthState.SignedOut
            advanceUntilIdle()
            assertFalse(gate.required.value)
        }

    @Test
    fun hardErrorWithNoCacheFailsOpenAndLeavesRequirementUnchanged() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeOnboardingRepository()
            repo.emissions = listOf(Resource.Error(null, null, false, RuntimeException("boom")))
            val auth = MutableStateFlow<AuthState>(AuthState.SignedOut)
            val gate = OnboardingGateController(repo, auth, backgroundScope)

            gate.start()
            auth.value = signedIn()
            advanceUntilIdle()

            // No cached gate metadata ⇒ the flag is never forced, so the user is not trapped in onboarding.
            assertFalse(gate.required.value)
        }

    @Test
    fun intermediateAuthStatesDoNotChangeRequirement() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeOnboardingRepository()
            repo.emissions = listOf(complete(isComplete = false))
            val auth = MutableStateFlow<AuthState>(AuthState.SignedOut)
            val gate = OnboardingGateController(repo, auth, backgroundScope)

            gate.start()
            auth.value = AuthState.Authenticating
            advanceUntilIdle()
            assertFalse(gate.required.value)

            auth.value = AuthState.Refreshing(TokenSet("a", "r", null, 9_999L))
            advanceUntilIdle()
            assertFalse(gate.required.value)
        }

    @Test
    fun aNewSessionReevaluatesTheGate() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeOnboardingRepository()
            repo.emissions = listOf(complete(isComplete = false))
            val auth = MutableStateFlow<AuthState>(AuthState.SignedOut)
            val gate = OnboardingGateController(repo, auth, backgroundScope)

            gate.start()
            auth.value = signedIn()
            advanceUntilIdle()
            assertTrue(gate.required.value)

            auth.value = AuthState.SignedOut
            advanceUntilIdle()
            assertFalse(gate.required.value)

            // A fresh session must re-read the gate rather than stay stuck at the reset value.
            auth.value = signedIn()
            advanceUntilIdle()
            assertTrue(gate.required.value)
        }

    @Test
    fun startIsIdempotent() =
        runTest(UnconfinedTestDispatcher()) {
            val repo = FakeOnboardingRepository()
            repo.emissions = listOf(complete(isComplete = false))
            val auth = MutableStateFlow<AuthState>(AuthState.SignedOut)
            val gate = OnboardingGateController(repo, auth, backgroundScope)

            gate.start()
            gate.start()
            auth.value = signedIn()
            advanceUntilIdle()

            assertTrue(gate.required.value)
        }
}
