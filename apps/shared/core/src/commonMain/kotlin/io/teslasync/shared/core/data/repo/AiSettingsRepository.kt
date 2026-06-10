package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderRequest
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderResult
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * The S7 data port for the Settings → AI panel — the cross-platform analogue of the web
 * `useAiSettings` hook domain (web/src/api/hooks/useAiSettings.ts). Every native AI-settings
 * surface (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively
 * through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * Both members are non-throwing suspend actions returning a [Result] — `useAiSettings.ts`
 * contains no `useQuery` reads, only two `useMutation`s, so there are no cache-then-network
 * feeds here. Payloads are carried as raw [JsonElement]/[JsonObject] (the same verbatim-SI
 * strategy as [AdminRepository]): the settings document is not unit-bearing, so there is no
 * display conversion to do, and the exact server shape round-trips unchanged.
 */
public interface AiSettingsRepository {
    /**
     * Partial-merge wrapper for `PUT /settings` (web `useSaveAiSettings`). Reads the latest
     * cached settings document, shallow-merges [patch] on top (patch keys win — the verbatim
     * `{ ...current, ...patch }` spread), and re-submits the full document because `/settings`
     * is full-replace. Fails closed with the cache-empty error when no settings document is
     * cached, rather than submitting a partial blob that would overwrite saved preferences.
     * On success it invalidates the settings cache key (mirrors the web `invalidateQueries`).
     */
    public suspend fun saveAiSettings(patch: JsonObject): Result<JsonElement>

    /**
     * Pre-flight provider validation via `POST /settings/ai/validate-config` (web
     * `useValidateAiProvider`). A 2xx resolves to [ValidateAiProviderResult.Success]; a 422 is
     * re-shaped into [ValidateAiProviderResult.Failure] (a validation outcome, surfaced as a
     * `Result.success`); any other HTTP/transport failure surfaces as `Result.failure` so the
     * consumer can distinguish "user gave a bad config" from "the network is down".
     */
    public suspend fun validateAiProvider(request: ValidateAiProviderRequest): Result<ValidateAiProviderResult>
}
