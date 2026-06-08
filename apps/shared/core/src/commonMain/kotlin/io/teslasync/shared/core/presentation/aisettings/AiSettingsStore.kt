package io.teslasync.shared.core.presentation.aisettings

import io.teslasync.shared.core.data.repo.AiSettingsRepository
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * UI-free shared state holder for the Settings → AI panel — the cross-platform port of the web
 * `useAiSettings` hook domain (web/src/api/hooks/useAiSettings.ts). Every native AI-settings
 * screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather
 * than re-implementing endpoints, the settings-merge rule, or the 422→failure mapping.
 *
 * `useAiSettings.ts` exposes two `useMutation`s and no `useQuery` reads, so this holder carries
 * no cache-then-network [kotlinx.coroutines.flow.StateFlow] feeds: both members are imperative,
 * non-throwing suspend actions returning a [Result], mirroring `mutation.mutateAsync`. It makes
 * no network calls itself — it delegates entirely to the injected [AiSettingsRepository] (S7),
 * which owns the cache read/merge/invalidate that the web hook performs against the TanStack
 * query cache. No clock is injected because this domain has no time-based derivation.
 *
 * @property repo the S7 data port both actions are routed through.
 */
public class AiSettingsStore(
    private val repo: AiSettingsRepository,
) {
    /**
     * Saves an AI-settings [patch] by deep(shallow)-merging it into the cached full settings
     * document and re-submitting via `PUT /settings`; invalidates the settings cache on success.
     * Mirrors web `useSaveAiSettings.mutateAsync(patch)`.
     */
    public suspend fun saveAiSettings(patch: JsonObject): Result<JsonElement> = repo.saveAiSettings(patch)

    /**
     * Runs a pre-flight provider validation. Resolves to a [ValidateAiProviderResult] (Success or
     * the 422-derived Failure) on success, or a `Result.failure` for non-422 transport/HTTP
     * errors. Mirrors web `useValidateAiProvider.mutateAsync(request)`.
     */
    public suspend fun validateAiProvider(request: ValidateAiProviderRequest): Result<ValidateAiProviderResult> =
        repo.validateAiProvider(request)
}
