// The localized feature-description catalog for the ExplorePage cards — the native mirror of the web
// `DESCRIPTIONS` record (web/src/features/explore/featureCatalog.ts), keyed by web route path. The web file holds
// a plain English `Record<path, string>`; for native parity those descriptions live in the localized string
// catalog (res/values*/strings.xml, ADR-014) and this object resolves a path to its `@StringRes` id so the
// composable can fold the localized text into the [ExploreEntry]s the model filters/highlights. A path with no
// curated description falls back at the render boundary to the localized `Open %1$s.` template (web's
// `Open ${item.label}.` fallback), so a card is never blank.
//
// This is a plain (non-`@Composable`) resolver: it returns resource ids, so the composable can build the whole
// catalog inside a single `remember` via `Context.getString` without a per-string composable read — keeping the
// ~120-card catalog stable across recompositions (e.g. on every search keystroke).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/explore) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.explore

import androidx.annotation.StringRes
import io.teslasync.android.R

/**
 * Resolves a web route [path] to its curated feature-description string resource — the native mirror of the web
 * `DESCRIPTIONS[item.to]` lookup. Returns `null` for a path with no curated blurb, so the render boundary applies
 * the localized `Open %1$s.` fallback (web's `Open ${item.label}.`).
 */
object ExploreDescriptions {
    /** The curated description resource id for [path], or `null` to fall back to the `Open %1$s.` template. */
    @StringRes
    fun resFor(path: String): Int? = DESCRIPTION_RES[path]

    private val DESCRIPTION_RES: Map<String, Int> =
        mapOf(
            "/" to R.string.translation_explore_desc_root,
            "/explore" to R.string.translation_explore_desc_explore,
            "/live" to R.string.translation_explore_desc_live,
            "/timeline" to R.string.translation_explore_desc_timeline,
            "/weekly-digest" to R.string.translation_explore_desc_weekly_digest,
            "/vehicles" to R.string.translation_explore_desc_vehicles,
            "/digital-twin" to R.string.translation_explore_desc_digital_twin,
            "/vehicle-comparison" to R.string.translation_explore_desc_vehicle_comparison,
            "/locations" to R.string.translation_explore_desc_locations,
            "/drives" to R.string.translation_explore_desc_drives,
            "/trips" to R.string.translation_explore_desc_trips,
            "/trip-planner" to R.string.translation_explore_desc_trip_planner,
            "/navigation" to R.string.translation_explore_desc_navigation,
            "/geofences" to R.string.translation_explore_desc_geofences,
            "/mileage" to R.string.translation_explore_desc_mileage,
            "/lifetime-stats" to R.string.translation_explore_desc_lifetime_stats,
            "/drive-score" to R.string.translation_explore_desc_drive_score,
            "/speed-profile" to R.string.translation_explore_desc_speed_profile,
            "/driving-dynamics" to R.string.translation_explore_desc_driving_dynamics,
            "/regen-efficiency" to R.string.translation_explore_desc_regen_efficiency,
            "/route-efficiency" to R.string.translation_explore_desc_route_efficiency,
            "/charging" to R.string.translation_explore_desc_charging,
            "/tesla-charging-history" to R.string.translation_explore_desc_tesla_charging_history,
            "/charging-curve" to R.string.translation_explore_desc_charging_curve,
            "/charging-heatmap" to R.string.translation_explore_desc_charging_heatmap,
            "/smart-charge" to R.string.translation_explore_desc_smart_charge,
            "/powershare" to R.string.translation_explore_desc_powershare,
            "/battery" to R.string.translation_explore_desc_battery,
            "/battery-cells" to R.string.translation_explore_desc_battery_cells,
            "/battery-degradation" to R.string.translation_explore_desc_battery_degradation,
            "/projected-range" to R.string.translation_explore_desc_projected_range,
            "/vampire-drain" to R.string.translation_explore_desc_vampire_drain,
            "/sleep-efficiency" to R.string.translation_explore_desc_sleep_efficiency,
            "/energy" to R.string.translation_explore_desc_energy,
            "/energy-flow" to R.string.translation_explore_desc_energy_flow,
            "/power-flow" to R.string.translation_explore_desc_power_flow,
            "/energy-products" to R.string.translation_explore_desc_energy_products,
            "/tire-pressure" to R.string.translation_explore_desc_tire_pressure,
            "/drivetrain-health" to R.string.translation_explore_desc_drivetrain_health,
            "/software-updates" to R.string.translation_explore_desc_software_updates,
            "/maintenance" to R.string.translation_explore_desc_maintenance,
            "/climate-control" to R.string.translation_explore_desc_climate_control,
            "/media-player" to R.string.translation_explore_desc_media_player,
            "/statistics" to R.string.translation_explore_desc_statistics,
            "/analytics" to R.string.translation_explore_desc_analytics,
            "/period-compare" to R.string.translation_explore_desc_period_compare,
            "/efficiency" to R.string.translation_explore_desc_efficiency,
            "/temperature-impact" to R.string.translation_explore_desc_temperature_impact,
            "/cost-analysis" to R.string.translation_explore_desc_cost_analysis,
            "/tco" to R.string.translation_explore_desc_tco,
            "/commands" to R.string.translation_explore_desc_commands,
            "/command-history" to R.string.translation_explore_desc_command_history,
            "/automations" to R.string.translation_explore_desc_automations,
            "/notifications/studio" to R.string.translation_explore_desc_notifications_studio,
            "/notifications/rules" to R.string.translation_explore_desc_notifications_rules,
            "/notifications/inbox" to R.string.translation_explore_desc_notifications_inbox,
            "/notifications/alerts" to R.string.translation_explore_desc_notifications_alerts,
            "/notifications/channels" to R.string.translation_explore_desc_notifications_channels,
            "/notifications/webhooks" to R.string.translation_explore_desc_notifications_webhooks,
            "/notifications/browser" to R.string.translation_explore_desc_notifications_browser,
            "/notifications/quiet-hours" to R.string.translation_explore_desc_notifications_quiet_hours,
            "/security-access" to R.string.translation_explore_desc_security_access,
            "/safety-settings" to R.string.translation_explore_desc_safety_settings,
            "/guard-mode" to R.string.translation_explore_desc_guard_mode,
            "/tesla-account" to R.string.translation_explore_desc_tesla_account,
            "/tesla-orders" to R.string.translation_explore_desc_tesla_orders,
            "/fleet-api" to R.string.translation_explore_desc_fleet_api,
            "/tesla-region" to R.string.translation_explore_desc_tesla_region,
            "/tesla-features" to R.string.translation_explore_desc_tesla_features,
            "/account/2fa" to R.string.translation_explore_desc_account_2fa,
            "/account/sessions" to R.string.translation_explore_desc_account_sessions,
            "/account/privacy" to R.string.translation_explore_desc_account_privacy,
            "/me/activity" to R.string.translation_explore_desc_me_activity,
            "/settings" to R.string.translation_explore_desc_settings,
            "/chatbot" to R.string.translation_explore_desc_chatbot,
            "/dev-tools" to R.string.translation_explore_desc_dev_tools,
            "/api-keys" to R.string.translation_explore_desc_api_keys,
            "/gas-price" to R.string.translation_explore_desc_gas_price,
            "/data-export" to R.string.translation_explore_desc_data_export,
            "/backup" to R.string.translation_explore_desc_backup,
            "/data-repair" to R.string.translation_explore_desc_data_repair,
            "/system-status" to R.string.translation_explore_desc_system_status,
            "/db-health" to R.string.translation_explore_desc_db_health,
            "/anomaly-detection" to R.string.translation_explore_desc_anomaly_detection,
            "/signals" to R.string.translation_explore_desc_signals,
            "/admin/live-signals" to R.string.translation_explore_desc_admin_live_signals,
            "/admin/ingest-xray" to R.string.translation_explore_desc_admin_ingest_xray,
            "/admin/dlq" to R.string.translation_explore_desc_admin_dlq,
            "/admin/flags" to R.string.translation_explore_desc_admin_flags,
            "/admin/schema-drift" to R.string.translation_explore_desc_admin_schema_drift,
            "/admin/slow-queries" to R.string.translation_explore_desc_admin_slow_queries,
            "/admin/vehicle-cost" to R.string.translation_explore_desc_admin_vehicle_cost,
            "/admin/disk-forecast" to R.string.translation_explore_desc_admin_disk_forecast,
            "/admin/secret-rotation" to R.string.translation_explore_desc_admin_secret_rotation,
            "/admin/audit-log" to R.string.translation_explore_desc_admin_audit_log,
            "/admin/gdpr-exports" to R.string.translation_explore_desc_admin_gdpr_exports,
            "/state-debugger" to R.string.translation_explore_desc_state_debugger,
            "/mqtt-inspector" to R.string.translation_explore_desc_mqtt_inspector,
            "/redis-signals" to R.string.translation_explore_desc_redis_signals,
            "/admin/telemetry/coverage" to R.string.translation_explore_desc_admin_telemetry_coverage,
            "/api-logs" to R.string.translation_explore_desc_api_logs,
            "/api-playground" to R.string.translation_explore_desc_api_playground,
            "/roadmap" to R.string.translation_explore_desc_roadmap,
        )
}
