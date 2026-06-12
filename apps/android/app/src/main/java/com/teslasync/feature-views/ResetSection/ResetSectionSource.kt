// The data port the Reset-to-defaults surface binds to (P1/S8 state-holder seam) — the native analogue of the
// two web hooks the panel owns: `useResetSection` and `useResetAllSettings`
// (web/src/features/settings/components/ResetSection.tsx, web/src/api/hooks/useSettingsReset.ts). The view
// never performs HTTP (ADR-002); a concrete adapter over the shared S8
// [io.teslasync.shared.core.presentation.settingsreset.SettingsResetStore] (or a test fake) drives this seam.
//
// Both web hooks are `useMutation`s with NO `useQuery`, so the seam is two non-throwing suspend [Result]
// mutations and carries no cache-then-network feed. On success the shared repository has already flushed the
// whole offline cache (the data-layer analogue of the web hooks' argument-less `queryClient.invalidateQueries()`)
// and the shared store has cached the receipt — neither is this surface's concern. The backend path is
// sudo-gated, but the shared `ApiHttpClient` handles the `RequireSudo` step-up transparently via its sudo-token
// sink, so — unlike the web `request()` client's interactive ReauthDialog — there is no distinct "sudo
// canceled" outcome here: a failed step-up simply surfaces as a failed [Result], which the surface toasts.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ResetSection) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed: the mandated `ResetSection*` filename
// cannot match the seam's `ResetSectionSource` name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.featureviews.resetsection

import io.teslasync.shared.core.presentation.settingsreset.SettingsResetResult
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetSectionResult
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetStore

/**
 * The settings-reset mutation seam the surface binds to — the native port of the web `useResetSection` +
 * `useResetAllSettings` hooks. A narrow two-method port so the view-model depends on an abstraction (the
 * shared-layer adapter in production ↔ a fake in tests), never on the store or the HTTP client directly. Both
 * methods are `suspend` non-throwing [Result]s mirroring the web hooks' `mutateAsync`.
 */
interface ResetSectionSource {
    /**
     * Resets one named section (web `useResetSection` → `POST /settings/reset { section }`). [section] is the
     * canonical lower-snake-case name; an unknown/denied section surfaces as a failed [Result].
     */
    suspend fun resetSection(section: String): Result<SettingsResetResult>

    /** Resets every whitelisted section (web `useResetAllSettings` → `POST /settings/reset {}`). */
    suspend fun resetAll(): Result<SettingsResetResult>
}

/**
 * Binds the surface to the shared **S8** [SettingsResetStore] — the single cross-platform holder every reset
 * surface shares (it routes both mutations through the S7 repository, caches the receipt into `lastReset`, and
 * has already flushed the offline cache on success). The production composition wires this; the view receives
 * the resulting [ResetSectionSource].
 */
fun SettingsResetStore.asResetSectionSource(): ResetSectionSource {
    val store = this
    return object : ResetSectionSource {
        override suspend fun resetSection(section: String): Result<SettingsResetResult> = store.resetSection(section)

        override suspend fun resetAll(): Result<SettingsResetResult> = store.resetAll()
    }
}

/**
 * An in-memory [ResetSectionSource] for previews and tests — it records the calls it received and returns the
 * configured [Result]s ([sectionOutcome] / [allOutcome]). Not thread-safe by design (single-writer, like the
 * web component itself). The defaults are a small successful receipt so a preview's confirm flow resolves.
 *
 * @property sectionOutcome the result returned for a [resetSection] call (keyed by the section wire name).
 * @property allOutcome the result returned for a [resetAll] call.
 */
class InMemoryResetSectionSource(
    private val sectionOutcome: (String) -> Result<SettingsResetResult> = { Result.success(DEFAULT_SECTION_RESULT) },
    private val allOutcome: () -> Result<SettingsResetResult> = { Result.success(DEFAULT_ALL_RESULT) },
) : ResetSectionSource {
    private val recordedSectionCalls = mutableListOf<String>()
    private var recordedAllCalls = 0

    /** The section wire names passed to [resetSection], in call order (test assertion seam). */
    val sectionCalls: List<String> get() = recordedSectionCalls.toList()

    /** The number of [resetAll] calls received (test assertion seam). */
    val allCalls: Int get() = recordedAllCalls

    override suspend fun resetSection(section: String): Result<SettingsResetResult> {
        recordedSectionCalls += section
        return sectionOutcome(section)
    }

    override suspend fun resetAll(): Result<SettingsResetResult> {
        recordedAllCalls += 1
        return allOutcome()
    }

    private companion object {
        /** A single-section receipt: one section cleared a couple of rows. */
        val DEFAULT_SECTION_RESULT: SettingsResetResult =
            SettingsResetResult(reset = 2, sections = listOf(SettingsResetSectionResult(section = "general", reset = 2)))

        /** A global receipt: a few sections cleared several rows. */
        val DEFAULT_ALL_RESULT: SettingsResetResult =
            SettingsResetResult(
                reset = 7,
                sections =
                    listOf(
                        SettingsResetSectionResult(section = "alert_rules", reset = 3),
                        SettingsResetSectionResult(section = "geofences", reset = 2),
                        SettingsResetSectionResult(section = "automations", reset = 2),
                    ),
            )
    }
}
