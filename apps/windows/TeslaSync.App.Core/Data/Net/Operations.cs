namespace TeslaSync.App.Core.Data.Net;

/// <summary>
/// The OpenAPI operation ids the Windows repositories consume, grouped by domain.
/// Centralizing them as constants keeps the string literals out of repository code and
/// lets a single test (<c>OperationsResolveTests</c>) assert every one resolves against
/// the generated endpoint table — catching contract drift at build/test time rather
/// than at runtime. Every id below is a GET read used for cache-then-network loads.
/// </summary>
public static class Operations
{
    /// <summary>Vehicle list/detail/state and per-vehicle subsystem reads.</summary>
    public static class Vehicles
    {
        public const string List = "get_api_v1_vehicles";
        public const string Detail = "get_api_v1_vehicles_vehicleID";
        public const string State = "get_api_v1_vehicles_vehicleID_state";
        public const string Battery = "get_api_v1_vehicles_vehicleID_battery";
        public const string Energy = "get_api_v1_vehicles_vehicleID_energy";
        public const string Positions = "get_api_v1_vehicles_vehicleID_positions";
        public const string Specs = "get_api_v1_vehicles_vehicleID_specs";
        public const string Options = "get_api_v1_vehicles_vehicleID_options";
        public const string Guard = "get_api_v1_vehicles_vehicleID_guard";
    }

    /// <summary>Drive history and per-drive telemetry/positions.</summary>
    public static class Drives
    {
        public const string List = "get_api_v1_drives";
        public const string Detail = "get_api_v1_drives_driveID";
        public const string Telemetry = "get_api_v1_drives_driveID_telemetry";
        public const string Positions = "get_api_v1_drives_driveID_positions";
        public const string Stats = "get_api_v1_drives_stats";
    }

    /// <summary>Trip rollups.</summary>
    public static class Trips
    {
        public const string List = "get_api_v1_trips";
        public const string Detail = "get_api_v1_trips_trip_id";
    }

    /// <summary>Charging sessions and per-session telemetry.</summary>
    public static class Charging
    {
        public const string Sessions = "get_api_v1_charging_sessions";
        public const string SessionDetail = "get_api_v1_charging_sessions_sessionID";
        public const string SessionTelemetry = "get_api_v1_charging_sessionID_telemetry";
        public const string TelemetryLatest = "get_api_v1_charging_telemetry_latest";
    }

    /// <summary>Battery/energy analytics rows.</summary>
    public static class Energy
    {
        public const string Analytics = "get_api_v1_analytics_energy";
    }

    /// <summary>Fleet/efficiency/battery analytics endpoints.</summary>
    public static class Analytics
    {
        public const string Fleet = "get_api_v1_analytics_fleet";
        public const string Tco = "get_api_v1_analytics_tco";
        public const string BatteryDegradation = "get_api_v1_analytics_battery_degradation";
        public const string BatteryHealth = "get_api_v1_analytics_battery_health";
        public const string Regen = "get_api_v1_analytics_regen";
        public const string Sleep = "get_api_v1_analytics_sleep";
        public const string SpeedProfile = "get_api_v1_analytics_speed_profile";
        public const string TemperatureImpact = "get_api_v1_analytics_temperature_impact";
        public const string RouteEfficiency = "get_api_v1_analytics_route_efficiency";
        public const string Lifetime = "get_api_v1_analytics_lifetime";
        public const string YearReview = "get_api_v1_analytics_year_review";
        public const string RangeProjection = "get_api_v1_analytics_range_projection";
    }

    /// <summary>Saved locations, geofences and the latest per-vehicle location snapshot.</summary>
    public static class Locations
    {
        public const string List = "get_api_v1_locations";
        public const string Geofences = "get_api_v1_geofences";
        public const string GeofenceDetail = "get_api_v1_geofences_geofenceID";
        public const string SnapshotLatest = "get_api_v1_location_snapshots_latest";
    }

    /// <summary>Vehicle subsystem snapshots (media/guard/specs/options).</summary>
    public static class VehicleSystems
    {
        public const string MediaLatest = "get_api_v1_media_latest";
    }

    /// <summary>Climate / HVAC snapshot reads.</summary>
    public static class Climate
    {
        public const string Latest = "get_api_v1_climate_latest";
        public const string History = "get_api_v1_climate";
    }

    /// <summary>Automations, history and presets.</summary>
    public static class Automations
    {
        public const string List = "get_api_v1_automations";
        public const string Detail = "get_api_v1_automations_id";
        public const string History = "get_api_v1_automations_history";
        public const string Presets = "get_api_v1_automations_presets";
    }

    /// <summary>Notifications inbox, stats and logs.</summary>
    public static class Notifications
    {
        public const string List = "get_api_v1_notifications";
        public const string Stats = "get_api_v1_notifications_stats";
        public const string Logs = "get_api_v1_notifications_logs";
        public const string UnreadCount = "get_api_v1_notifications_unread_count";
    }

    /// <summary>Telemetry signal catalog/availability/history.</summary>
    public static class Signals
    {
        public const string Available = "get_api_v1_signals_vehicleID_available";
        public const string History = "get_api_v1_signals_vehicleID_signalName_history";
        public const string Catalog = "get_api_v1_signals_catalog";
    }

    /// <summary>System status/health/version and audit.</summary>
    public static class SystemAdmin
    {
        public const string Status = "get_api_v1_system_status";
        public const string Health = "get_api_v1_system_health";
        public const string Version = "get_api_v1_system_version";
        public const string Audit = "get_api_v1_system_audit";
        public const string AdminAuditLog = "get_api_v1_admin_audit_log";
    }

    /// <summary>User settings, polling config and dashboard layouts.</summary>
    public static class Settings
    {
        public const string Get = "get_api_v1_settings";
        public const string PollingConfig = "get_api_v1_settings_polling_config";
        public const string DashboardLayouts = "get_api_v1_settings_dashboard_layouts";
    }

    /// <summary>Data export jobs and column catalog.</summary>
    public static class Exports
    {
        public const string Jobs = "get_api_v1_export_jobs";
        public const string JobDetail = "get_api_v1_export_jobs_jobID";
        public const string Columns = "get_api_v1_exports_columns";
    }

    /// <summary>Drive sharing / share-link reads.</summary>
    public static class Sharing
    {
        public const string DriveShares = "get_api_v1_drives_driveID_shares";
        public const string ShareToken = "get_api_v1_share_token";
    }
}
