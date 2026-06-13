using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Sharing;

/// <summary>
/// One shared-drive aggregate (the normalized v2 shape of <c>GET /share/{token}</c> — web
/// <c>SharedDriveInfo</c> in web/src/types/sharing.ts). Distance is SI metres, duration SI seconds, speed SI
/// metres-per-second and efficiency SI watt-hours-per-metre; elevations are SI metres and battery is a
/// dimensionless state-of-charge percentage. Every measure is nullable so a partial wire row never throws and
/// the projection applies the same web visibility gating (<c>!= null</c>) before rendering its stat card.
/// </summary>
public sealed record SharedDriveInfo(
    string Date,
    double DistanceM,
    double DurationS,
    string? StartAddress,
    string? EndAddress,
    double? StartBattery,
    double? EndBattery,
    double? ElevationGain,
    double? ElevationLoss,
    double? MaxSpeedMps,
    double? AvgSpeedMps,
    double? EfficiencyWhPerM);

/// <summary>The shared vehicle badge (web <c>SharedVehicle</c>): the marketing model + colour, both required.</summary>
public sealed record SharedVehicle(string Model, string Color);

/// <summary>One route trail coordinate (web <c>SharedMapPoint</c> — lat/lng degrees).</summary>
public readonly record struct SharedMapPoint(double Lat, double Lng);

/// <summary>One elevation-profile sample (web <c>SharedElevationPoint</c> — SI distance metres + SI elevation metres).</summary>
public readonly record struct SharedElevationPoint(double DistanceM, double ElevationM);

/// <summary>One speed-profile sample (web <c>SharedSpeedPoint</c> — SI distance metres + SI speed metres-per-second).</summary>
public readonly record struct SharedSpeedPoint(double DistanceM, double SpeedMps);

/// <summary>
/// The full normalized shared-drive payload (web <c>SharedDriveData</c>). The public <c>GET /share/{token}</c>
/// endpoint serves either the SI v2 envelope or the legacy unit-suffixed v1 envelope; <see cref="FromJson"/>
/// reproduces the web <c>normalizeSharedDriveData</c> upgrade so the rest of the surface only ever sees SI. Lists
/// are never null (empty is valid) so the view never null-checks before iterating.
/// </summary>
public sealed record SharedDriveData(
    string Title,
    string? Description,
    SharedDriveInfo Drive,
    SharedVehicle? Vehicle,
    IReadOnlyList<SharedMapPoint> MapPoints,
    IReadOnlyList<SharedElevationPoint> ElevationProfile,
    IReadOnlyList<SharedSpeedPoint> SpeedProfile)
{
    private const double MetersPerKm = 1000.0;
    private const double KmhPerMps = 3.6;
    private const int SecondsPerMinute = 60;

    /// <summary>
    /// Parse + normalize a <c>GET /share/{token}</c> body to the SI v2 shape, or null when the body is not a
    /// shared-drive object (a missing/expired link returns an error status the client surfaces instead). Mirrors
    /// the web <c>normalizeSharedDriveData</c>: a <c>payload_version === 'v2'</c> body is read as SI directly; any
    /// other body is treated as the legacy v1 envelope and lifted to SI (km→m, min→s, km/h→m/s, Wh/km→Wh/m).
    /// </summary>
    public static SharedDriveData? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("drive", out var drive)
            || drive.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        bool isV2 = string.Equals(SharedDriveJson.String(root, "payload_version"), "v2", StringComparison.Ordinal);
        return isV2 ? FromV2(root, drive) : FromV1(root, drive);
    }

    private static SharedDriveData FromV2(JsonElement root, JsonElement drive)
    {
        var info = new SharedDriveInfo(
            Date: SharedDriveJson.String(drive, "date") ?? string.Empty,
            DistanceM: SharedDriveJson.Double(drive, "distance_m") ?? 0,
            DurationS: SharedDriveJson.Double(drive, "duration_s") ?? 0,
            StartAddress: SharedDriveJson.String(drive, "start_address"),
            EndAddress: SharedDriveJson.String(drive, "end_address"),
            StartBattery: SharedDriveJson.Double(drive, "start_battery"),
            EndBattery: SharedDriveJson.Double(drive, "end_battery"),
            ElevationGain: SharedDriveJson.Double(drive, "elevation_gain"),
            ElevationLoss: SharedDriveJson.Double(drive, "elevation_loss"),
            MaxSpeedMps: SharedDriveJson.Double(drive, "max_speed_mps"),
            AvgSpeedMps: SharedDriveJson.Double(drive, "avg_speed_mps"),
            EfficiencyWhPerM: SharedDriveJson.Double(drive, "efficiency_wh_per_m"));

        var elevation = SharedDriveJson.Map(root, "elevation_profile", static p => new SharedElevationPoint(
            SharedDriveJson.Double(p, "distance_m") ?? 0,
            SharedDriveJson.Double(p, "elevation_m") ?? 0));

        var speed = SharedDriveJson.Map(root, "speed_profile", static p => new SharedSpeedPoint(
            SharedDriveJson.Double(p, "distance_m") ?? 0,
            SharedDriveJson.Double(p, "speed_mps") ?? 0));

        return Build(root, info, elevation, speed);
    }

    private static SharedDriveData FromV1(JsonElement root, JsonElement drive)
    {
        double? maxKmh = SharedDriveJson.Double(drive, "max_speed_kmh");
        double? avgKmh = SharedDriveJson.Double(drive, "avg_speed_kmh");
        double? effWhKm = SharedDriveJson.Double(drive, "efficiency_wh_km");

        var info = new SharedDriveInfo(
            Date: SharedDriveJson.String(drive, "date") ?? string.Empty,
            DistanceM: (SharedDriveJson.Double(drive, "distance_km") ?? 0) * MetersPerKm,
            DurationS: Math.Round((SharedDriveJson.Double(drive, "duration_min") ?? 0) * SecondsPerMinute),
            StartAddress: SharedDriveJson.String(drive, "start_address"),
            EndAddress: SharedDriveJson.String(drive, "end_address"),
            StartBattery: SharedDriveJson.Double(drive, "start_battery"),
            EndBattery: SharedDriveJson.Double(drive, "end_battery"),
            ElevationGain: SharedDriveJson.Double(drive, "elevation_gain"),
            ElevationLoss: SharedDriveJson.Double(drive, "elevation_loss"),
            MaxSpeedMps: maxKmh is { } mk ? mk / KmhPerMps : null,
            AvgSpeedMps: avgKmh is { } ak ? ak / KmhPerMps : null,
            EfficiencyWhPerM: effWhKm is { } e ? e / MetersPerKm : null);

        var elevation = SharedDriveJson.Map(root, "elevation_profile", static p => new SharedElevationPoint(
            (SharedDriveJson.Double(p, "distance_km") ?? 0) * MetersPerKm,
            SharedDriveJson.Double(p, "elevation_m") ?? 0));

        var speed = SharedDriveJson.Map(root, "speed_profile", static p => new SharedSpeedPoint(
            (SharedDriveJson.Double(p, "distance_km") ?? 0) * MetersPerKm,
            (SharedDriveJson.Double(p, "speed_kmh") ?? 0) / KmhPerMps));

        return Build(root, info, elevation, speed);
    }

    private static SharedDriveData Build(
        JsonElement root,
        SharedDriveInfo info,
        IReadOnlyList<SharedElevationPoint> elevation,
        IReadOnlyList<SharedSpeedPoint> speed)
    {
        SharedVehicle? vehicle = null;
        if (root.TryGetProperty("vehicle", out var v) && v.ValueKind == JsonValueKind.Object)
        {
            string? model = SharedDriveJson.String(v, "model");
            if (model is not null)
            {
                vehicle = new SharedVehicle(model, SharedDriveJson.String(v, "color") ?? string.Empty);
            }
        }

        var points = SharedDriveJson.Map(root, "map_points", static p => new SharedMapPoint(
            SharedDriveJson.Double(p, "lat") ?? 0,
            SharedDriveJson.Double(p, "lng") ?? 0));

        return new SharedDriveData(
            Title: SharedDriveJson.String(root, "title") ?? string.Empty,
            Description: SharedDriveJson.String(root, "description"),
            Drive: info,
            Vehicle: vehicle,
            MapPoints: points,
            ElevationProfile: elevation,
            SpeedProfile: speed);
    }
}

/// <summary>The single-source snapshot the view-model reads (web <c>useSharedDrive</c>'s resolved data, or null).</summary>
public sealed record SharedDriveSnapshot(SharedDriveData? Data)
{
    /// <summary>The empty snapshot — the loading / unavailable surface the shell shows by default.</summary>
    public static SharedDriveSnapshot Empty { get; } = new((SharedDriveData?)null);

    /// <summary>True when a shared drive resolved.</summary>
    public bool HasData => Data is not null;
}

/// <summary>The render-time model: the parsed snapshot plus the page lifecycle flags (web query <c>isLoading</c> / error).</summary>
public sealed record SharedDrivePageModel(SharedDriveSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the share query is in flight with nothing resolved yet.</summary>
    public static SharedDrivePageModel Initial { get; } = new(SharedDriveSnapshot.Empty, true, null);
}

/// <summary>
/// The three top-level data states the public report renders. Mirrors the web page's branch order
/// (<c>if (isLoading)</c> spinner → <c>if (error || !data)</c> the expired/unavailable view → the report). The
/// web query is non-retrying, so the unavailable view is a terminal content-unavailable surface with a home
/// link, never a Retry affordance.
/// </summary>
public enum SharedDriveState
{
    /// <summary>The share read is in flight with nothing to show — the centered loading spinner.</summary>
    Loading,

    /// <summary>The link is expired / revoked / unresolved (web <c>error || !data</c>) — the unavailable view.</summary>
    Empty,

    /// <summary>A shared drive resolved — the full branded report.</summary>
    Success,
}

/// <summary>One projected stat tile (web <c>StatCard</c>): a localized label, a pre-formatted value, an accent
/// glyph and the web conditional-render <see cref="Visible"/> gate.</summary>
public sealed record SharedStatDisplay(string Label, string Value, string Glyph, bool Visible);

/// <summary>
/// The fully-resolved, render-ready projection of the web <c>SharedDrivePage</c> — every region as pure data so
/// the WinUI view is a thin renderer and the whole contract is unit-tested without a UI host. The three-state
/// flag drives the top-level surface; the per-section <c>Show*</c> flags reproduce the web conditional renders
/// (efficiency / battery / speeds / elevation gain, the vehicle badge, the two charts, and the no-route
/// fallback) so no populated region is ever hidden and no empty region is ever blank.
/// </summary>
public sealed record SharedDrivePageDisplay
{
    public required SharedDriveState State { get; init; }
    public required string AutomationName { get; init; }

    // ── Header (web Logo + "Shared Drive Report") ──
    public required string HeaderLabel { get; init; }

    // ── Unavailable view (web ExpiredShareView) ──
    public required string ExpiredTitle { get; init; }
    public required string ExpiredDescription { get; init; }
    public required string ExpiredHomeLabel { get; init; }

    // ── Title block ──
    public required string Title { get; init; }
    public required string? Description { get; init; }
    public required string DateText { get; init; }
    public required string? RouteText { get; init; }

    // ── Stat grid (web StatCard set) ──
    public required SharedStatDisplay Distance { get; init; }
    public required SharedStatDisplay Duration { get; init; }
    public required SharedStatDisplay Efficiency { get; init; }
    public required SharedStatDisplay Battery { get; init; }
    public required SharedStatDisplay MaxSpeed { get; init; }
    public required SharedStatDisplay AvgSpeed { get; init; }
    public required SharedStatDisplay ElevationGain { get; init; }

    // ── Vehicle badge (web GlassPanel) ──
    public required bool ShowVehicle { get; init; }
    public required string VehicleTitle { get; init; }
    public required string VehicleColor { get; init; }

    // ── Hero map (web MapContainer + Polyline + start/end CircleMarkers) ──
    public required bool ShowMap { get; init; }
    public required IReadOnlyList<GeoPoint> Trail { get; init; }
    public required GeoPoint Center { get; init; }
    public required int Zoom { get; init; }
    public required GeoPoint? StartMarker { get; init; }
    public required GeoPoint? EndMarker { get; init; }
    public required string StartLabel { get; init; }
    public required string EndLabel { get; init; }
    public required string MapLabel { get; init; }

    // ── Elevation profile (web ChartContainer + AreaChart) ──
    public required bool ShowElevation { get; init; }
    public required string ElevationTitle { get; init; }
    public required string ElevationAria { get; init; }
    public required string ElevationTooltipLabel { get; init; }
    public required string ElevationUnit { get; init; }
    public required IReadOnlyList<ChartPoint> ElevationData { get; init; }

    // ── Speed profile (web ChartContainer + LineChart) ──
    public required bool ShowSpeed { get; init; }
    public required string SpeedTitle { get; init; }
    public required string SpeedAria { get; init; }
    public required string SpeedTooltipLabel { get; init; }
    public required string SpeedUnit { get; init; }
    public required IReadOnlyList<ChartPoint> SpeedData { get; init; }

    // ── No-route fallback (web EmptyState in GlassPanel) ──
    public required bool ShowNoData { get; init; }
    public required string NoMapDataMessage { get; init; }

    // ── Footer ──
    public required string FooterText { get; init; }
    public required string LearnMoreText { get; init; }

    /// <summary>True only in the success state (the report body renders).</summary>
    public bool ShowContent => State == SharedDriveState.Success;

    /// <summary>True while the share read is in flight (the loading spinner renders).</summary>
    public bool ShowLoading => State == SharedDriveState.Loading;

    /// <summary>True when the link is unavailable (the expired view renders).</summary>
    public bool ShowExpired => State == SharedDriveState.Empty;
}

/// <summary>
/// Resolves the page's twenty visible strings through the i18n facade once per render (web key names + defaults,
/// verbatim). Every key is requested in every state so the localization contract is asserted unconditionally and
/// the manifest's twenty <c>share.*</c> keys flow through the resource pipeline even on the loading / unavailable
/// surfaces. The five keys the web leaves to its i18next default (the <c>expired.*</c> + <c>*.aria</c> keys) fall
/// back to the same English copy here — byte-identical public-report behaviour.
/// </summary>
public sealed record SharedDriveStrings
{
    public required string Header { get; init; }
    public required string Distance { get; init; }
    public required string Duration { get; init; }
    public required string Efficiency { get; init; }
    public required string Battery { get; init; }
    public required string MaxSpeed { get; init; }
    public required string AvgSpeed { get; init; }
    public required string ElevGain { get; init; }
    public required string Elevation { get; init; }
    public required string ElevationAria { get; init; }
    public required string ElevTooltipLabel { get; init; }
    public required string Speed { get; init; }
    public required string SpeedAria { get; init; }
    public required string SpeedTooltipLabel { get; init; }
    public required string NoMapData { get; init; }
    public required string Footer { get; init; }
    public required string LearnMore { get; init; }
    public required string ExpiredTitle { get; init; }
    public required string ExpiredDescription { get; init; }
    public required string ExpiredHome { get; init; }

    /// <summary>Resolve all twenty strings (web key names + defaults).</summary>
    public static SharedDriveStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new SharedDriveStrings
        {
            Header = localizer.GetString("share.header", "Shared Drive Report"),
            Distance = localizer.GetString("share.distance", "Distance"),
            Duration = localizer.GetString("share.duration", "Duration"),
            Efficiency = localizer.GetString("share.efficiency", "Efficiency"),
            Battery = localizer.GetString("share.battery", "Battery"),
            MaxSpeed = localizer.GetString("share.maxSpeed", "Max Speed"),
            AvgSpeed = localizer.GetString("share.avgSpeed", "Avg Speed"),
            ElevGain = localizer.GetString("share.elevGain", "Elevation Gain"),
            Elevation = localizer.GetString("share.elevation", "Elevation Profile"),
            ElevationAria = localizer.GetString("share.elevation.aria", "Shared drive elevation profile area chart by distance"),
            ElevTooltipLabel = localizer.GetString("share.elevTooltipLabel", "Elevation"),
            Speed = localizer.GetString("share.speed", "Speed Profile"),
            SpeedAria = localizer.GetString("share.speed.aria", "Shared drive speed profile line chart by distance"),
            SpeedTooltipLabel = localizer.GetString("share.speedTooltipLabel", "Speed"),
            NoMapData = localizer.GetString("share.noMapData", "Route data is not available for this shared drive."),
            Footer = localizer.GetString("share.footer", "Shared via TeslaSync \u2014 Self-hosted Tesla Fleet Intelligence"),
            LearnMore = localizer.GetString("share.learnMore", "Learn more \u2192"),
            ExpiredTitle = localizer.GetString("share.expired.title", "Share Link Unavailable"),
            ExpiredDescription = localizer.GetString("share.expired.description", "This shared drive link has expired or been revoked."),
            ExpiredHome = localizer.GetString("share.expired.home", "Go to TeslaSync"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="SharedDrivePageModel"/> to its <see cref="SharedDrivePageDisplay"/> — the
/// native port of web/src/features/sharing/pages/SharedDrivePage.tsx. It selects the three-state matrix, resolves
/// every visible label through the i18n facade, reproduces the web unit helpers (elevation label, efficiency
/// unit, the km-per-mile + metres-per-foot inline conversions) and the web visibility gating, and pre-converts
/// the chart traces at the SI display boundary so the view only renders. No WinUI types — the whole contract is
/// unit-tested without a UI host.
/// </summary>
public static class SharedDrivePageProjection
{
    private const string RouteArrow = "\u2192";
    private const string BatteryArrow = "\u2192";
    private const double KmPerMile = 1.609344;
    private const double MetersPerFoot = 0.3048;
    private const double MetersPerKm = 1000.0;
    private const int SecondsPerHour = 3600;
    private const int SecondsPerMinute = 60;

    // Default map centre (web fallback [47.6, -122.3]).
    private static readonly GeoPoint DefaultCenter = new(47.6, -122.3);
    private const int RouteZoom = 7; // web MapContainer zoom={7}

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    public static SharedDrivePageDisplay Project(
        SharedDrivePageModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        _ = now;

        // Resolve every visible string unconditionally so the twenty manifest keys are requested in every state.
        SharedDriveStrings s = SharedDriveStrings.Resolve(localizer);
        SharedDriveData? data = model.Snapshot.Data;

        SharedDriveState state =
            model.Loading && data is null ? SharedDriveState.Loading
            : model.ErrorDetail is not null || data is null ? SharedDriveState.Empty
            : SharedDriveState.Success;

        // Map trail (web mapPoints) + derived centre / endpoints.
        IReadOnlyList<GeoPoint> trail = data is null
            ? Array.Empty<GeoPoint>()
            : data.MapPoints.Select(static p => new GeoPoint(p.Lat, p.Lng)).ToList();
        bool hasRoute = trail.Count > 1; // web `mapPoints.length > 1`
        GeoPoint center = trail.Count > 0 ? trail[trail.Count / 2] : DefaultCenter;
        GeoPoint? startMarker = trail.Count > 0 ? trail[0] : null;
        GeoPoint? endMarker = trail.Count > 1 ? trail[^1] : null;

        // Chart traces, pre-converted to display units at this boundary.
        IReadOnlyList<ChartPoint> elevationData = data is null
            ? Array.Empty<ChartPoint>()
            : data.ElevationProfile
                .Select(p => new ChartPoint(
                    UnitConverters.DistanceFromSi(p.DistanceM, units.Distance),
                    ConvertElevation(p.ElevationM, units.Distance)))
                .ToList();

        IReadOnlyList<ChartPoint> speedData = data is null
            ? Array.Empty<ChartPoint>()
            : data.SpeedProfile
                .Select(p => new ChartPoint(
                    UnitConverters.DistanceFromSi(p.DistanceM, units.Distance),
                    UnitConverters.SpeedFromSi(p.SpeedMps, units.Speed)))
                .ToList();

        SharedDriveInfo? drive = data?.Drive;
        bool showNoData = trail.Count == 0 && elevationData.Count == 0 && speedData.Count == 0;

        return new SharedDrivePageDisplay
        {
            State = state,
            AutomationName = data is null ? s.ExpiredTitle : ReportName(data, s),

            HeaderLabel = s.Header,
            ExpiredTitle = s.ExpiredTitle,
            ExpiredDescription = s.ExpiredDescription,
            ExpiredHomeLabel = s.ExpiredHome,

            Title = data?.Title ?? string.Empty,
            Description = data?.Description,
            DateText = drive?.Date ?? string.Empty,
            RouteText = RouteText(drive),

            Distance = new SharedStatDisplay(
                s.Distance,
                drive is null ? string.Empty : UnitFormatters.FormatDistance(drive.DistanceM, units, 1),
                SharedDrivePageRegistration.DistanceGlyph,
                Visible: drive is not null),
            Duration = new SharedStatDisplay(
                s.Duration,
                drive is null ? string.Empty : FormatDurationMinutes(drive.DurationS, units),
                SharedDrivePageRegistration.DurationGlyph,
                Visible: drive is not null),
            Efficiency = new SharedStatDisplay(
                s.Efficiency,
                EfficiencyValue(drive, units),
                SharedDrivePageRegistration.EfficiencyGlyph,
                Visible: drive?.EfficiencyWhPerM is not null),
            Battery = new SharedStatDisplay(
                s.Battery,
                BatteryValue(drive),
                SharedDrivePageRegistration.BatteryGlyph,
                Visible: drive is { StartBattery: not null, EndBattery: not null }),
            MaxSpeed = new SharedStatDisplay(
                s.MaxSpeed,
                drive?.MaxSpeedMps is { } max ? UnitFormatters.FormatSpeed(max, units, 0) : string.Empty,
                SharedDrivePageRegistration.MaxSpeedGlyph,
                Visible: drive?.MaxSpeedMps is not null),
            AvgSpeed = new SharedStatDisplay(
                s.AvgSpeed,
                drive?.AvgSpeedMps is { } avg ? UnitFormatters.FormatSpeed(avg, units, 0) : string.Empty,
                SharedDrivePageRegistration.AvgSpeedGlyph,
                Visible: drive?.AvgSpeedMps is not null),
            ElevationGain = new SharedStatDisplay(
                s.ElevGain,
                ElevationGainValue(drive, units),
                SharedDrivePageRegistration.ElevationGlyph,
                Visible: drive?.ElevationGain is not null),

            ShowVehicle = data?.Vehicle is not null,
            VehicleTitle = data?.Vehicle is { } veh ? $"Tesla {veh.Model}" : string.Empty,
            VehicleColor = data?.Vehicle?.Color ?? string.Empty,

            ShowMap = hasRoute,
            Trail = trail,
            Center = center,
            Zoom = RouteZoom,
            StartMarker = startMarker,
            EndMarker = endMarker,
            StartLabel = localizer.GetString("driveDetail.start", "Start"),
            EndLabel = localizer.GetString("driveDetail.end", "End"),
            MapLabel = s.Header,

            ShowElevation = elevationData.Count > 0,
            ElevationTitle = s.Elevation,
            ElevationAria = s.ElevationAria,
            ElevationTooltipLabel = s.ElevTooltipLabel,
            ElevationUnit = ElevationUnitLabel(units.Distance),
            ElevationData = elevationData,

            ShowSpeed = speedData.Count > 0,
            SpeedTitle = s.Speed,
            SpeedAria = s.SpeedAria,
            SpeedTooltipLabel = s.SpeedTooltipLabel,
            SpeedUnit = UnitLabels.Label(units.Speed),
            SpeedData = speedData,

            ShowNoData = showNoData,
            NoMapDataMessage = s.NoMapData,

            FooterText = s.Footer,
            LearnMoreText = s.LearnMore,
        };
    }

    private static string ReportName(SharedDriveData data, SharedDriveStrings s)
    {
        string title = string.IsNullOrEmpty(data.Title) ? s.Header : data.Title;
        string? route = RouteText(data.Drive);
        return route is null ? title : $"{title}. {route}";
    }

    private static string? RouteText(SharedDriveInfo? drive)
    {
        if (drive is null
            || string.IsNullOrEmpty(drive.StartAddress)
            || string.IsNullOrEmpty(drive.EndAddress))
        {
            return null;
        }

        return $"{drive.StartAddress} {RouteArrow} {drive.EndAddress}";
    }

    // web: `${Math.round(toEfficiencyDisplay(eff_wh_per_m * METERS_PER_KM, distancePref))} ${effPref}`.
    private static string EfficiencyValue(SharedDriveInfo? drive, UnitPref units)
    {
        if (drive?.EfficiencyWhPerM is not { } whPerM)
        {
            return string.Empty;
        }

        double whPerKm = whPerM * MetersPerKm;
        double display = units.Distance == DistanceUnit.Mi ? whPerKm * KmPerMile : whPerKm;
        return $"{RoundInt(display)} {EfficiencyUnitLabel(units.Distance)}";
    }

    // web: `${drive.start_battery}% → ${drive.end_battery}%`.
    private static string BatteryValue(SharedDriveInfo? drive)
    {
        if (drive is not { StartBattery: { } start, EndBattery: { } end })
        {
            return string.Empty;
        }

        return $"{RoundInt(start)}% {BatteryArrow} {RoundInt(end)}%";
    }

    // web: `${Math.round(convertElevation(elevation_gain, distancePref))} ${elevPref}`.
    private static string ElevationGainValue(SharedDriveInfo? drive, UnitPref units)
    {
        if (drive?.ElevationGain is not { } gain)
        {
            return string.Empty;
        }

        return $"{RoundInt(ConvertElevation(gain, units.Distance))} {ElevationUnitLabel(units.Distance)}";
    }

    // web `formatDurationSecondsAsMinutes`: "Xm" under an hour, else "Xh Ym" (dropping a zero-minute remainder).
    private static string FormatDurationMinutes(double seconds, UnitPref units)
    {
        if (double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0)
        {
            return units.EmptyDisplay ?? UnitFormatters.DefaultEmptyDisplay;
        }

        int hours = (int)Math.Floor(seconds / SecondsPerHour);
        double minutes = (seconds % SecondsPerHour) / SecondsPerMinute;
        if (hours == 0)
        {
            return $"{RoundInt(minutes)}m";
        }

        return minutes >= 0.5
            ? $"{hours}h {RoundInt(minutes)}m"
            : $"{hours}h";
    }

    // web elevationLabel(distancePref): 'ft' for imperial, else 'm'.
    private static string ElevationUnitLabel(DistanceUnit distance) =>
        distance == DistanceUnit.Mi ? "ft" : "m";

    // web convertElevation(meters, distancePref): metres → feet for imperial, else passthrough.
    private static double ConvertElevation(double meters, DistanceUnit distance) =>
        distance == DistanceUnit.Mi ? meters / MetersPerFoot : meters;

    // web efficiencyUnit(distancePref): 'Wh/mi' for imperial, else 'Wh/km'.
    private static string EfficiencyUnitLabel(DistanceUnit distance) =>
        distance == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";

    // web template-literal `${Math.round(x)}`: invariant integer, no grouping separators.
    private static string RoundInt(double value) =>
        ((long)Math.Round(value, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture);
}

/// <summary>
/// Canonical registration metadata for the <c>SharedDrivePage</c> surface — the public shell route name, the
/// diagnostics slug, the generated-client operation id for the one read the web page performs
/// (<c>GET /share/{token}</c>), the route path-parameter name, and the Segoe Fluent glyphs the stat cards / header
/// use. The route is chrome-less + unauthenticated (web <c>/s/:token</c>).
/// </summary>
public static class SharedDrivePageRegistration
{
    /// <summary>The route / page-factory name the shell registers this page under (web <c>SharedDrive</c>).</summary>
    public const string RouteName = "SharedDrive";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SharedDrivePage";

    /// <summary>The public shared-drive read — web <c>GET /share/{token}</c> (returns the SharedDriveData envelope).</summary>
    public const string ShareOperation = "get_api_v1_share_token";

    /// <summary>The route path-parameter name for the share token (web <c>:token</c>).</summary>
    public const string TokenParam = "token";

    /// <summary>Segoe Fluent — MapPin (web Distance MapPin + header brand mark).</summary>
    public const string DistanceGlyph = "\uE707";

    /// <summary>Segoe Fluent — Clock (web Duration Clock).</summary>
    public const string DurationGlyph = "\uE917";

    /// <summary>Segoe Fluent — Lightning (web Efficiency Zap + vehicle badge).</summary>
    public const string EfficiencyGlyph = "\uE945";

    /// <summary>Segoe Fluent — Battery (web Battery).</summary>
    public const string BatteryGlyph = "\uE83E";

    /// <summary>Segoe Fluent — Speed (web Max-Speed Gauge).</summary>
    public const string MaxSpeedGlyph = "\uE7C0";

    /// <summary>Segoe Fluent — StockUp / trending (web Avg-Speed TrendingUp).</summary>
    public const string AvgSpeedGlyph = "\uEB05";

    /// <summary>Segoe Fluent — Up (web Elevation-Gain Mountain).</summary>
    public const string ElevationGlyph = "\uE74A";
}

/// <summary>
/// PII-safe diagnostics for the <c>SharedDrivePage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a share token, address, location or VIN — so
/// a diagnostics line can never leak fleet data from the public report. Thread-safe.
/// </summary>
public sealed class SharedDrivePageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SharedDrivePageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SharedDrivePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SharedDrivePageRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the shared-drive parsers (mirrors the sibling feature json
/// helpers). Every read is null-safe so a partial wire object never throws; numeric-strings are tolerated to
/// match the Go API's mixed scalar encoding.
/// </summary>
internal static class SharedDriveJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric / non-finite.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? str = v.GetString();
            return string.IsNullOrEmpty(str) ? null : str;
        }

        return null;
    }

    /// <summary>Projects each object element of an array property through <paramref name="select"/>, or an empty list when absent.</summary>
    public static IReadOnlyList<T> Map<T>(JsonElement obj, string name, Func<JsonElement, T> select)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var arr)
            || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<T>();
        }

        var list = new List<T>(arr.GetArrayLength());
        foreach (var element in arr.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                list.Add(select(element));
            }
        }

        return list;
    }
}
