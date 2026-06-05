package io.teslasync.shared.core.presentation.aisettings

import io.teslasync.shared.core.data.repo.AiSettingsRepository
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * Verifies the S8 [AiSettingsStore] routes each action to the right S7 [AiSettingsRepository]
 * call and returns its [Result] verbatim — using a fake repository, so no network or cache is
 * involved. `useAiSettings.ts` has no `useQuery` reads, so there are no feeds to assert here.
 */
class AiSettingsStoreTest {
    /** Fake S7 port: records each call's arguments and returns a programmable result. */
    private class FakeAiSettingsRepository : AiSettingsRepository {
        val savedPatches: MutableList<JsonObject> = mutableListOf()
        val validatedRequests: MutableList<ValidateAiProviderRequest> = mutableListOf()
        var saveResult: Result<JsonElement> = Result.success(JsonPrimitive("saved"))
        var validateResult: Result<ValidateAiProviderResult> =
            Result.success(ValidateAiProviderResult.Success(mode = "local", baseUrl = "http://localhost"))

        override suspend fun saveAiSettings(patch: JsonObject): Result<JsonElement> {
            savedPatches += patch
            return saveResult
        }

        override suspend fun validateAiProvider(request: ValidateAiProviderRequest): Result<ValidateAiProviderResult> {
            validatedRequests += request
            return validateResult
        }
    }

    @Test
    fun saveAiSettingsDelegatesPatchAndReturnsResult() =
        runTest {
            val repo = FakeAiSettingsRepository()
            val expected: JsonElement = JsonPrimitive("merged-doc")
            repo.saveResult = Result.success(expected)
            val store = AiSettingsStore(repo)

            val patch = buildJsonObject { put("ai_mode", "cloud") }
            val result = store.saveAiSettings(patch)

            assertEquals(listOf(patch), repo.savedPatches)
            assertTrue(result.isSuccess)
            assertSame(expected, result.getOrNull())
        }

    @Test
    fun saveAiSettingsPropagatesFailure() =
        runTest {
            val repo = FakeAiSettingsRepository()
            val boom = IllegalStateException("settings cache empty — refresh the page and try again")
            repo.saveResult = Result.failure(boom)
            val store = AiSettingsStore(repo)

            val result = store.saveAiSettings(buildJsonObject { put("ai_mode", "off") })

            assertTrue(result.isFailure)
            assertSame(boom, result.exceptionOrNull())
        }

    @Test
    fun validateAiProviderDelegatesRequestAndReturnsSuccess() =
        runTest {
            val repo = FakeAiSettingsRepository()
            val success = ValidateAiProviderResult.Success(mode = "cloud", baseUrl = "https://api.openai.com", probedModel = "gpt-4o")
            repo.validateResult = Result.success(success)
            val store = AiSettingsStore(repo)

            val request = ValidateAiProviderRequest(mode = "cloud", provider = "openai", apiKey = "sk-test")
            val result = store.validateAiProvider(request)

            assertEquals(listOf(request), repo.validatedRequests)
            assertSame(success, result.getOrNull())
        }

    @Test
    fun validateAiProviderReturnsFailureVariantForRejection() =
        runTest {
            val repo = FakeAiSettingsRepository()
            val failure = ValidateAiProviderResult.Failure(ValidateAiProviderReason.NOT_LOCAL, "public address")
            repo.validateResult = Result.success(failure)
            val store = AiSettingsStore(repo)

            val result = store.validateAiProvider(ValidateAiProviderRequest(mode = "local", baseUrl = "http://1.2.3.4"))

            assertTrue(result.isSuccess)
            assertEquals(failure, result.getOrNull())
        }
}
