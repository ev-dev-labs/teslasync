package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.settingsreset.SettingsResetResult

/**
 * The S7 data port for the settings reset feature — the cross-platform analogue of the web
 * `useSettingsReset` hook domain (web/src/api/hooks/useSettingsReset.ts). Every native settings
 * reset surface (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively
 * through this interface, so a single fake stands in for the whole domain in the S8 state-holder
 * tests.
 *
 * Both surfaces are mutations (the web hooks are `useMutation`, not `useQuery` — there is no
 * read-side query in this domain), so the port has NO cache-then-network read. Because a reset can
 * touch any preference / rule / channel / geofence / automation / dashboard-layout / quiet-hours
 * row, each mutation on success invalidates the ENTIRE offline cache (the data-layer analogue of the
 * web hooks' argument-less `queryClient.invalidateQueries()` that drops every cached query). The
 * web hooks additionally prime `settingsResetKeys.lastReset` with the receipt via `setQueryData`;
 * that "last result" state is the S8 state holder's job
 * ([io.teslasync.shared.core.presentation.settingsreset.SettingsResetStore]), not this layer's.
 *
 *  - [resetSection] — `POST /settings/reset { section }` (web `useResetSection`); resets one named
 *    whitelisted section.
 *  - [resetAll] — `POST /settings/reset {}` (web `useResetAllSettings`); resets every whitelisted
 *    section (the Danger-zone path).
 *
 * Both paths are sudo-gated upstream; the shared client transparently handles the backend's
 * `RequireSudo` step-up, so there is no bespoke step-up plumbing here. No receipt field is
 * display-unit-bearing, so payloads round-trip verbatim with no SI conversion (S5).
 */
public interface SettingsResetRepository {
    /**
     * `POST /settings/reset` with `{ section }` — resets one named section (web `useResetSection`).
     * The [section] is the canonical lower-snake-case name; anything else surfaces as a `Result`
     * failure (the backend answers 400 `SECTION_UNKNOWN` / `SECTION_DENIED`). On success the WHOLE
     * cache is invalidated.
     */
    public suspend fun resetSection(section: String): Result<SettingsResetResult>

    /**
     * `POST /settings/reset` with an empty body — resets every whitelisted section (web
     * `useResetAllSettings`). On success the WHOLE cache is invalidated.
     */
    public suspend fun resetAll(): Result<SettingsResetResult>
}

/**
 * The web `settingsResetKeys.root` tuple flattened (`['settings', 'reset']`). The settings reset
 * keys are flat parents the web hooks prime with `setQueryData`; their KMP analogue is the "last
 * reset" state the S8 store exposes, but the key strings are mirrored here so the C# port and KMP
 * agree on the cache namespace. Locked by golden vectors shared with the C# port.
 */
public const val SETTINGS_RESET_PREFIX: String = "settings:reset"

/**
 * Cache key for the last reset receipt — the web `settingsResetKeys.lastReset`
 * (`['settings', 'reset', 'last']`), the key both web hooks prime via `setQueryData`. Its KMP
 * analogue is the observable "last reset" state the S8 store exposes. Locked by golden vectors
 * shared with the C# port.
 */
public fun settingsLastResetKey(): String = "$SETTINGS_RESET_PREFIX:last"
