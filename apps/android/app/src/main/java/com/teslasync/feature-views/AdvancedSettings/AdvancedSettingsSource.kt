// The persistence port the Advanced Settings surface binds to (P1/S8 state-holder seam) — the native
// analogue of the web panel's `@/lib/confirmSilence` helpers (`listSilenced` / `unsilence` /
// `clearAllSilenced`) that the web component imports directly
// (web/src/features/settings/components/AdvancedSettings.tsx, web/src/lib/confirmSilence.ts). The view
// never touches storage; a concrete adapter over device-local `SharedPreferences` (or a test fake)
// drives this seam. The data is purely device-local (no HTTP, no network) — it works identically
// offline, satisfying ADR-002 (the view performs no I/O of its own). The [silencedResource] adapter
// folds a store outcome into a cache-then-network [Resource], so the same off-device unit test that
// pins the projection also pins the freshness / error envelope and the view-model renders the full
// state matrix uniformly with every other surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AdvancedSettings) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed: the mandated `AdvancedSettings*` filename cannot match the
// surface's `ConfirmSilenceStore` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.featureviews.advancedsettings

import android.content.Context
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The "Don't ask again" allowlist seam the [AdvancedSettingsViewModel] binds to — the native port of
 * the web `@/lib/confirmSilence` reader/mutator surface the panel uses. A narrow three-method seam so
 * the view-model depends on an abstraction (real device-local adapter ↔ test fake), never on
 * `SharedPreferences` directly. Every method is `suspend` so the production adapter can hop to
 * [Dispatchers.IO] for the disk read/commit; the returned set is the resulting allowlist (so the
 * view-model never re-reads to learn the new state).
 */
interface ConfirmSilenceStore {
    /** All currently-silenced action ids (web `listSilenced` / `load`). Order is normalised by the model. */
    suspend fun list(): Set<String>

    /** Re-enable the prompt for a single action [key] (web `unsilence`); returns the resulting allowlist. */
    suspend fun unsilence(key: String): Set<String>

    /** Wipe every silenced action id (web `clearAllSilenced` / "Restore all"); returns the empty allowlist. */
    suspend fun clearAll(): Set<String>
}

/**
 * The production [ConfirmSilenceStore] backed by private `SharedPreferences` — the device-local analogue
 * of the web lib's `localStorage` allowlist (web `STORAGE_KEY = 'teslasync:confirm-silence:v1'`). The
 * ids are stored as an idiomatic Android string set (a platform-native choice over the web's JSON-array
 * encoding); reads/writes hop to [Dispatchers.IO] since the commit touches disk. A missing/blank entry
 * reads as the empty allowlist, exactly as the web `load()` returns an empty `Set` when nothing is
 * stored. The `:v1` schema note is preserved in [PREFS]/[KEY] so the shape can migrate without colliding.
 */
class SharedPreferencesConfirmSilenceStore(
    context: Context,
) : ConfirmSilenceStore {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override suspend fun list(): Set<String> =
        withContext(Dispatchers.IO) {
            prefs.getStringSet(KEY, emptySet())?.toSet() ?: emptySet()
        }

    override suspend fun unsilence(key: String): Set<String> =
        withContext(Dispatchers.IO) {
            if (key.isEmpty()) return@withContext currentLocked()
            val next = currentLocked().toMutableSet()
            if (next.remove(key)) prefs.edit().putStringSet(KEY, next).apply()
            next
        }

    override suspend fun clearAll(): Set<String> =
        withContext(Dispatchers.IO) {
            prefs.edit().remove(KEY).apply()
            emptySet()
        }

    private fun currentLocked(): Set<String> = prefs.getStringSet(KEY, emptySet())?.toSet() ?: emptySet()

    private companion object {
        // Mirrors the device-local AppSettings prefs naming; the `.v1` segment is the web `:v1` schema tag.
        const val PREFS = "teslasync.confirm.silence.v1"
        const val KEY = "silenced_keys"
    }
}

/**
 * An in-memory [ConfirmSilenceStore] for previews, the host's pre-persistence fallback, and tests — the
 * native analogue of the web lib operating before anything is written. Mutations are reflected on the
 * next [list]. Not thread-safe by design (single-writer, like the web component itself).
 */
class InMemoryConfirmSilenceStore(
    initial: Set<String> = emptySet(),
) : ConfirmSilenceStore {
    private val current = initial.toMutableSet()

    override suspend fun list(): Set<String> = current.toSet()

    override suspend fun unsilence(key: String): Set<String> {
        current.remove(key)
        return current.toSet()
    }

    override suspend fun clearAll(): Set<String> {
        current.clear()
        return current.toSet()
    }
}

/**
 * Folds a store [result] into a cache-then-network [Resource] of the canonical allowlist — the data
 * adapter the state holder collects (and the unit test drives directly). A success becomes a fresh
 * [Resource.Success] stamped [nowMs]; a failure keeps any prior allowlist visible as a stale
 * [Resource.Error] (so a failed read/restore never blanks the working list — the ADR-013
 * "offline / last known" rule), or, with no prior list, surfaces as a hard [Resource.Error] the view
 * renders as the error state with a retry.
 */
internal fun silencedResource(
    result: Result<SilencedPrompts>,
    cached: SilencedPrompts?,
    cachedFetchedAt: Long?,
    nowMs: Long,
): Resource<SilencedPrompts> =
    result.fold(
        onSuccess = { prompts -> Resource.Success(prompts, fetchedAt = nowMs, stale = false) },
        onFailure = { error ->
            Resource.Error(
                cached = cached,
                fetchedAt = cached?.let { cachedFetchedAt },
                stale = cached != null,
                error = error,
            )
        },
    )
