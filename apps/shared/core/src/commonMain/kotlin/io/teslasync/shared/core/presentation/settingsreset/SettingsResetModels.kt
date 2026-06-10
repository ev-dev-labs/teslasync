package io.teslasync.shared.core.presentation.settingsreset

import kotlinx.serialization.Serializable

/**
 * One section's reset receipt — the cross-platform port of the web `SettingsResetSectionResult`
 * interface (web/src/api/hooks/useSettingsReset.ts), itself mirroring the Go
 * `settingsdb.SettingsResetSectionResult` struct (internal/database/settings/reset.go). It is one
 * element of the [SettingsResetResult.sections] list `POST /settings/reset` returns.
 *
 * [section] is the canonical lower-snake-case section name (as listed in the backend's
 * `AllSettingsResetSections()`) and [reset] is the number of rows that section cleared. Neither
 * field is display-unit-bearing, so the value round-trips verbatim with no SI conversion (S5).
 *
 * @property section the canonical lower-snake-case section name that ran.
 * @property reset the number of rows cleared for [section].
 */
@Serializable
public data class SettingsResetSectionResult(
    val section: String = "",
    val reset: Long = 0,
)

/**
 * The top-level reset receipt — the cross-platform port of the web `SettingsResetResult` interface
 * (web/src/api/hooks/useSettingsReset.ts), mirroring the Go `settingsdb.SettingsResetResult` struct
 * (internal/database/settings/reset.go). It is the wire shape both `POST /settings/reset { section }`
 * (single section) and `POST /settings/reset {}` (every whitelisted section) return.
 *
 * [reset] is the sum of the per-section counts and [sections] lists each [SettingsResetSectionResult]
 * in the order the orchestrator ran it. No field is display-unit-bearing, so the value round-trips
 * verbatim with no SI conversion (S5).
 *
 * @property reset the total number of rows cleared across every [sections] entry.
 * @property sections the per-section receipts, in run order.
 */
@Serializable
public data class SettingsResetResult(
    val reset: Long = 0,
    val sections: List<SettingsResetSectionResult> = emptyList(),
)
