package io.teslasync.shared.core.presentation.settingsreset

import io.teslasync.shared.core.data.repo.SettingsResetRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * UI-free shared state holder for the settings reset feature — the cross-platform port of the web
 * `useSettingsReset` hook domain (web/src/api/hooks/useSettingsReset.ts). Every native settings
 * reset surface (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather
 * than re-implementing endpoints, the last-receipt cache, or the invalidate-all rule.
 *
 * The web domain is two `useMutation`s with NO `useQuery` — the user explicitly clicks "Reset
 * section" / "Reset ALL settings", so there is no polling read and therefore no
 * [io.teslasync.shared.core.data.repo.Resource] feed here. Each web hook's `onSuccess` does two
 * things: it primes `settingsResetKeys.lastReset` with the receipt via `setQueryData`, and it calls
 * the argument-less `queryClient.invalidateQueries()` to flush every cached query (a reset can touch
 * any preference / rule / channel / geofence / automation / dashboard-layout / quiet-hours row).
 *
 * The two responsibilities are split across the two layers exactly as the web hook splits them:
 *  - the invalidate-all flush is the repository's job (it calls `CacheStore.clearAll()` on success,
 *    the data-layer analogue of `invalidateQueries()`), so this holder does not touch the cache;
 *  - the `setQueryData(lastReset, …)` priming is reproduced here as observable [StateFlow] state, so
 *    a native screen can render the most recent receipt ("cleared N rows") without re-fetching:
 *    [lastReset] mirrors `setQueryData(settingsResetKeys.lastReset, result)` and is updated on every
 *    successful [resetSection] AND [resetAll] (both web hooks write the same key).
 *
 * The mutations are non-throwing suspend [Result]s mirroring the web hooks' mutationFn + onSuccess:
 *  - [resetSection] (web `useResetSection`) — `POST /settings/reset { section }`, caches the receipt.
 *  - [resetAll] (web `useResetAllSettings`) — `POST /settings/reset {}`, caches the receipt.
 *
 * The holder makes no network calls itself; it injects the S7 repository. It mirrors the web hooks'
 * single-threaded usage and is not internally synchronised; drive it from one confinement (the
 * platform main scope).
 *
 * @property repo the S7 data port every mutation is routed through.
 */
public class SettingsResetStore(
    private val repo: SettingsResetRepository,
) {
    private val _lastReset = MutableStateFlow<SettingsResetResult?>(null)

    /**
     * The most recent reset receipt, single-section or global (web `settingsResetKeys.lastReset`),
     * or null before any reset. A screen renders "cleared [SettingsResetResult.reset] rows" off this.
     */
    public val lastReset: StateFlow<SettingsResetResult?> = _lastReset.asStateFlow()

    /**
     * Resets one named section and caches the receipt into [lastReset] on success (web
     * `useResetSection`). [section] is the canonical lower-snake-case name; an unknown/denied section
     * surfaces as a failed [Result] and leaves [lastReset] unchanged. The whole offline cache has
     * already been flushed by the repository before this returns.
     */
    public suspend fun resetSection(section: String): Result<SettingsResetResult> =
        repo.resetSection(section).onSuccess { _lastReset.value = it }

    /**
     * Resets every whitelisted section and caches the receipt into [lastReset] on success (web
     * `useResetAllSettings`). The whole offline cache has already been flushed by the repository
     * before this returns.
     */
    public suspend fun resetAll(): Result<SettingsResetResult> = repo.resetAll().onSuccess { _lastReset.value = it }
}
