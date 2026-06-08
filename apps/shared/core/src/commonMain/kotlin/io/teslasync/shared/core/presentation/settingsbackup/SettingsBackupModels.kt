package io.teslasync.shared.core.presentation.settingsbackup

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/**
 * The settings backup bundle — the cross-platform port of the web `SettingsBundle` interface
 * (web/src/lib/settingsImportSchema.ts), itself mirroring the Go `settingsdb.SettingsBundle`
 * struct (internal/database/settings/serializer.go). It is the wire shape `GET /settings/export`
 * returns and the body `POST /settings/import` carries under `bundle`.
 *
 * Keys arrive snake_case and are matched verbatim via [SerialName] so a fetched bundle re-serializes
 * unchanged for the subsequent import (byte-stable round-trip). The section payloads are deliberately
 * left opaque ([SettingsBundleSections]) — the backend owns their schema, and tightening it here would
 * only create maintenance coupling without catching real bugs, exactly as the web type keeps them as
 * `unknown`/`unknown[]`. No field is unit-bearing, so there is no SI conversion at this layer.
 *
 * @property schemaVersion the bundle format version (`SETTINGS_BUNDLE_SCHEMA_VERSION` on web).
 * @property exportedAt the RFC3339 UTC timestamp the server stamped the export with.
 * @property sections the per-section payloads, each independently optional.
 */
@Serializable
public data class SettingsBundle(
    @SerialName("schema_version") val schemaVersion: Int,
    @SerialName("exported_at") val exportedAt: String,
    val sections: SettingsBundleSections = SettingsBundleSections(),
)

/**
 * The opaque section payloads inside a [SettingsBundle] — the port of the web `SettingsBundle.sections`
 * shape, mirroring the Go `SettingsBundleSections` (every field `omitempty`). Each section is
 * independently optional, so a partial bundle (e.g. only `alert_rules`) is valid and a sparse bundle
 * still decodes. The payloads are carried as raw [JsonObject]/[JsonArray] so their contents round-trip
 * shape-preserving without imposing a schema — the backend is the source of truth for them.
 *
 * @property settings the system-settings blob (web `Record<string, unknown>`); a JSON object.
 * @property alertRules the alert-rule rows (web `unknown[]`); a JSON array.
 * @property geofences the geofence rows (web `unknown[]`); a JSON array.
 * @property quietHours the quiet-hours windows (web `unknown[]`); a JSON array.
 */
@Serializable
public data class SettingsBundleSections(
    val settings: JsonObject? = null,
    @SerialName("alert_rules") val alertRules: JsonArray? = null,
    val geofences: JsonArray? = null,
    @SerialName("quiet_hours") val quietHours: JsonArray? = null,
)

/**
 * One section's diff/apply summary — the port of the web `SettingsImportSectionResult`, mirroring the
 * Go `settingsdb.SectionResult`. [added]/[updated]/[skipped] are always present; [conflicts] is
 * `omitempty` on the wire and so defaults to `null` (distinct from an empty list) when the section had
 * no conflicts.
 */
@Serializable
public data class SettingsImportSectionResult(
    val added: Int = 0,
    val updated: Int = 0,
    val skipped: Int = 0,
    val conflicts: List<String>? = null,
)

/**
 * The import endpoint response — the port of the web `SettingsImportResult`, mirroring the Go
 * `settingsdb.ImportResult`. Dry-run and apply share this exact shape; [dryRun] echoes which mode the
 * server ran and [sections] maps each touched section key (`settings`/`alert_rules`/`geofences`/
 * `quiet_hours`) to its [SettingsImportSectionResult]. A section absent from the bundle is absent here.
 */
@Serializable
public data class SettingsImportResult(
    @SerialName("dry_run") val dryRun: Boolean = false,
    val sections: Map<String, SettingsImportSectionResult> = emptyMap(),
)

/**
 * The folded-across-sections totals for an import — the port of the web `summariseImportResult` return
 * shape (web/src/lib/settingsImportSchema.ts). [total] is `added + updated` (NOT including [skipped]),
 * matching the web helper exactly: the page labels the Apply button "Apply N changes" off [total].
 * Locked by golden vectors shared with the C# port.
 */
public data class ImportSummary(
    val added: Int,
    val updated: Int,
    val skipped: Int,
    val total: Int,
)
