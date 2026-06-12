using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Tesla fleet charging-sessions map surface. Every getter
/// returns a nullable / fallback rather than throwing so a partial or schema-drifted body from
/// <c>GET /tesla/charging/sessions/</c> never aborts the parse (web parity: the React component reads
/// <c>s.latitude ?? 0</c> / <c>s.total_energy_added_wh != null</c> and tolerates an undefined field). Kept private
/// to the surface and free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class TeslaChargingSessionsMapJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)Math.Round(d),
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The double value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The timestamp value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        var raw = GetString(obj, name);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var dto)
            ? dto
            : null;
    }
}

/// <summary>The mutually-exclusive surface state the map renders, across the web component's data lifecycle.</summary>
public enum TeslaChargingSessionsMapState
{
    /// <summary>Initial fetch, no cache yet — skeleton chrome.</summary>
    Loading,

    /// <summary>Sessions resolved — the map with its clustered session markers.</summary>
    Ready,

    /// <summary>Resolved with no sessions (or none with coordinates) — the map over a friendly empty overlay.</summary>
    Empty,

    /// <summary>A cached payload past the freshness window — the map plus a stale freshness chip.</summary>
    Stale,

    /// <summary>The network failed but a cached payload is still shown — the map plus an offline chip.</summary>
    Offline,

    /// <summary>A hard failure with no cache — a retryable error surface.</summary>
    Error,
}

/// <summary>
/// One parsed Tesla fleet charging session (the web <c>TeslaChargingSession</c> shape, SI on the wire). Only the
/// fields the map surface needs are modelled; nullable fields stay nullable so the projection reproduces the web
/// component's <c>?? 0</c> / <c>!= null</c> guards exactly.
/// </summary>
/// <param name="SessionId">The session id (web <c>session_id</c>, used as the marker key).</param>
/// <param name="SiteLocationName">The charger site name (web <c>site_location_name</c>).</param>
/// <param name="ChargeStart">The charge start timestamp (web <c>charge_start_datetime</c>).</param>
/// <param name="TotalEnergyAddedWh">Energy added in SI watt-hours (web <c>total_energy_added_wh</c>).</param>
/// <param name="TotalCost">Session cost (web <c>total_cost</c>).</param>
/// <param name="ChargerType">Charger type label (web <c>charger_type</c>).</param>
/// <param name="Latitude">Site latitude in degrees (web <c>latitude</c>).</param>
/// <param name="Longitude">Site longitude in degrees (web <c>longitude</c>).</param>
public sealed record TeslaChargingSessionRow(
    long SessionId,
    string? SiteLocationName,
    DateTimeOffset? ChargeStart,
    double? TotalEnergyAddedWh,
    double? TotalCost,
    string? ChargerType,
    double? Latitude,
    double? Longitude);

/// <summary>
/// The parsed read-model for the charging-sessions map — the list of sessions the web page feeds into the
/// component as the <c>sessions</c> prop. <see cref="FromJson"/> tolerates the documented
/// <c>{ "sessions": [...], "summary": {...} }</c> envelope as well as a bare session array, so a schema drift
/// degrades to an empty map rather than a throw.
/// </summary>
/// <param name="Sessions">The parsed sessions (never null; empty when the body carried none).</param>
public sealed record TeslaChargingSessionsMapData(IReadOnlyList<TeslaChargingSessionRow> Sessions)
{
    /// <summary>An empty read-model (no sessions).</summary>
    public static TeslaChargingSessionsMapData Empty { get; } = new(Array.Empty<TeslaChargingSessionRow>());

    /// <summary>Parse a fleet charging-sessions response into the typed read-model.</summary>
    public static TeslaChargingSessionsMapData FromJson(JsonElement root)
    {
        JsonElement array;
        if (root.ValueKind == JsonValueKind.Array)
        {
            array = root;
        }
        else if (root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("sessions", out var sessions)
            && sessions.ValueKind == JsonValueKind.Array)
        {
            array = sessions;
        }
        else
        {
            return Empty;
        }

        var rows = new List<TeslaChargingSessionRow>(array.GetArrayLength());
        foreach (var element in array.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            rows.Add(new TeslaChargingSessionRow(
                SessionId: TeslaChargingSessionsMapJson.GetLong(element, "session_id") ?? 0,
                SiteLocationName: TeslaChargingSessionsMapJson.GetString(element, "site_location_name"),
                ChargeStart: TeslaChargingSessionsMapJson.GetDateTime(element, "charge_start_datetime"),
                TotalEnergyAddedWh: TeslaChargingSessionsMapJson.GetDouble(element, "total_energy_added_wh"),
                TotalCost: TeslaChargingSessionsMapJson.GetDouble(element, "total_cost"),
                ChargerType: TeslaChargingSessionsMapJson.GetString(element, "charger_type"),
                Latitude: TeslaChargingSessionsMapJson.GetDouble(element, "latitude"),
                Longitude: TeslaChargingSessionsMapJson.GetDouble(element, "longitude")));
        }

        return new TeslaChargingSessionsMapData(rows);
    }
}

/// <summary>
/// A single render-ready map marker — the native projection of one web cluster point. Carries the geographic
/// position, the cyan marker color (web <c>defaultColor="#22d3ee"</c>), the Narrator label (web
/// <c>ariaLabel</c>), and the popup content (web <c>popupHtml</c>) decomposed into a bold site name plus the
/// secondary detail lines, already localized and formatted so the view stays a thin renderer.
/// </summary>
/// <param name="Id">Stable marker id (the web <c>session_id</c>).</param>
/// <param name="Latitude">Marker latitude in degrees.</param>
/// <param name="Longitude">Marker longitude in degrees.</param>
/// <param name="MarkerColor">The marker color hex (web cluster <c>defaultColor</c>).</param>
/// <param name="AriaLabel">The Narrator label for the marker (web <c>ariaLabel</c>).</param>
/// <param name="SiteName">The popup heading — the site name or the localized "Unknown".</param>
/// <param name="DetailLines">The popup body lines (date, then optional energy / cost / charger).</param>
public sealed record TeslaChargingSessionMapPoint(
    string Id,
    double Latitude,
    double Longitude,
    string MarkerColor,
    string AriaLabel,
    string SiteName,
    IReadOnlyList<string> DetailLines);

/// <summary>
/// The render-ready projection of the charging-sessions map — the viewport (center + zoom), the clustered marker
/// set, and the localized chrome copy (map label + empty message). A 1:1 port of the web component's
/// <c>useMemo(center)</c> / <c>useMemo(clusterPoints)</c> computation plus its <c>aria-label</c>s.
/// </summary>
/// <param name="CenterLatitude">The map center latitude (avg of all sessions, or the default).</param>
/// <param name="CenterLongitude">The map center longitude (avg of all sessions, or the default).</param>
/// <param name="Zoom">The initial zoom level (web <c>zoom={5}</c>).</param>
/// <param name="Points">The clustered session markers (sessions with finite coordinates).</param>
/// <param name="MapLabel">The accessible name of the map region (web <c>aria-label</c>).</param>
/// <param name="EmptyMessage">The empty-overlay copy shown when no marker has coordinates.</param>
/// <param name="TotalSessions">The number of resolved sessions (with or without coordinates).</param>
public sealed record TeslaChargingSessionsMapDisplay(
    double CenterLatitude,
    double CenterLongitude,
    int Zoom,
    IReadOnlyList<TeslaChargingSessionMapPoint> Points,
    string MapLabel,
    string EmptyMessage,
    int TotalSessions)
{
    /// <summary>True when at least one session resolved to a finite map coordinate.</summary>
    public bool HasPoints => Points.Count > 0;
}

/// <summary>
/// Pure, WinUI-free projection from the parsed sessions to the display model — the native port of the web
/// component's inline <c>useMemo</c> computations in
/// <c>web/src/features/charging/pages/TeslaChargingSessionsMap.tsx</c>. The center is the mean of every session's
/// coordinate (web <c>s.latitude ?? 0</c>), falling back to the default San-Francisco view when there are no
/// sessions; a marker is emitted for every session with a finite lat/lng (web
/// <c>typeof s.latitude === 'number' &amp;&amp; !Number.isNaN(...)</c>); the popup mirrors the web HTML
/// (<c>fmtNumber(convertEnergyFromSI(wh,'kWh'),1)+' kWh'</c>, <c>formatCurrency(cost,2)</c>, the uppercased
/// charger type) and the Narrator label resolves <c>tesla_sessions.markerLabel</c>. Every string flows through the
/// i18n facade.
/// </summary>
public static class TeslaChargingSessionsMapProjection
{
    /// <summary>Default center latitude when there are no sessions (web <c>{ lat: 37.77 }</c>).</summary>
    public const double DefaultCenterLatitude = 37.77;

    /// <summary>Default center longitude when there are no sessions (web <c>{ lng: -122.42 }</c>).</summary>
    public const double DefaultCenterLongitude = -122.42;

    /// <summary>The initial zoom level (web <c>zoom={5}</c>).</summary>
    public const int DefaultZoom = 5;

    /// <summary>The marker color (web cluster <c>defaultColor="#22d3ee"</c>).</summary>
    public const string MarkerColorHex = "#22d3ee";

    /// <summary>The energy unit the popup hardcodes (web <c>convertEnergyFromSI(wh, 'kWh')</c>).</summary>
    public const string EnergyUnitLabel = "kWh";

    /// <summary>Fraction digits for the popup energy readout (web <c>fmtNumber(..., 1)</c>).</summary>
    public const int EnergyPrecision = 1;

    /// <summary>Fraction digits for the popup cost readout (web <c>formatCurrency(cost, 2)</c>).</summary>
    public const int CostPrecision = 2;

    /// <summary>Project <paramref name="data"/> into the viewport + marker set using the localizer for every label.</summary>
    /// <param name="data">The parsed sessions, or null when none resolved.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock used to format each session's start time.</param>
    /// <param name="currencySymbol">The active currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public static TeslaChargingSessionsMapDisplay Project(
        TeslaChargingSessionsMapData? data,
        ILocalizer localizer,
        DateTimeOffset now,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? TeslaChargingSessionsMapRegistration.DefaultCurrencySymbol
            : currencySymbol;
        string unknown = TeslaChargingSessionsMapRegistration.Unknown(localizer);

        IReadOnlyList<TeslaChargingSessionRow> sessions = data?.Sessions ?? Array.Empty<TeslaChargingSessionRow>();

        var (centerLat, centerLng) = ComputeCenter(sessions);

        var points = new List<TeslaChargingSessionMapPoint>(sessions.Count);
        foreach (var session in sessions)
        {
            if (!IsFiniteCoordinate(session.Latitude) || !IsFiniteCoordinate(session.Longitude))
            {
                continue;
            }

            string rawName = string.IsNullOrEmpty(session.SiteLocationName) ? unknown : session.SiteLocationName!;

            var detail = new List<string>(4)
            {
                DateTimeFormatting.Format(session.ChargeStart, DateTimeVariant.Full, now),
            };

            if (session.TotalEnergyAddedWh is { } wh)
            {
                double kwh = UnitConverters.EnergyFromSi(wh, EnergyUnit.Kwh);
                detail.Add($"{ScalarFormatters.FormatNumber(kwh, EnergyPrecision)} {EnergyUnitLabel}");
            }

            if (session.TotalCost is { } cost)
            {
                detail.Add(ScalarFormatters.FormatCurrency(cost, symbol, CostPrecision));
            }

            if (!string.IsNullOrEmpty(session.ChargerType))
            {
                detail.Add(session.ChargerType!.ToUpperInvariant());
            }

            points.Add(new TeslaChargingSessionMapPoint(
                Id: session.SessionId.ToString(CultureInfo.InvariantCulture),
                Latitude: session.Latitude!.Value,
                Longitude: session.Longitude!.Value,
                MarkerColor: MarkerColorHex,
                AriaLabel: TeslaChargingSessionsMapRegistration.MarkerLabel(localizer, rawName),
                SiteName: rawName,
                DetailLines: detail));
        }

        return new TeslaChargingSessionsMapDisplay(
            CenterLatitude: centerLat,
            CenterLongitude: centerLng,
            Zoom: DefaultZoom,
            Points: points,
            MapLabel: TeslaChargingSessionsMapRegistration.MapLabel(localizer),
            EmptyMessage: TeslaChargingSessionsMapRegistration.NoMapData(localizer),
            TotalSessions: sessions.Count);
    }

    // Web parity: average of every session's (lat ?? 0, lng ?? 0); the default SF view when there are none.
    private static (double Lat, double Lng) ComputeCenter(IReadOnlyList<TeslaChargingSessionRow> sessions)
    {
        if (sessions.Count == 0)
        {
            return (DefaultCenterLatitude, DefaultCenterLongitude);
        }

        double sumLat = 0;
        double sumLng = 0;
        foreach (var session in sessions)
        {
            sumLat += session.Latitude ?? 0;
            sumLng += session.Longitude ?? 0;
        }

        return (sumLat / sessions.Count, sumLng / sessions.Count);
    }

    private static bool IsFiniteCoordinate(double? value) => value is { } v && double.IsFinite(v);
}

/// <summary>
/// Maps a raw cache-then-network <see cref="JsonElement"/> emission to a typed
/// <see cref="TeslaChargingSessionsMapData"/> result, preserving the lifecycle status so the view-model keeps
/// content visible while refreshing (the same contract <c>ChargingTabResultMapper</c> follows).
/// </summary>
public static class TeslaChargingSessionsMapResultMapper
{
    /// <summary>Map a raw fleet charging-sessions emission to a typed map result.</summary>
    public static RepositoryResult<TeslaChargingSessionsMapData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<TeslaChargingSessionsMapData>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<TeslaChargingSessionsMapData>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<TeslaChargingSessionsMapData>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var data = TeslaChargingSessionsMapData.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<TeslaChargingSessionsMapData>.Cached(data, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<TeslaChargingSessionsMapData>.Refreshing(data, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<TeslaChargingSessionsMapData>.OfflineCached(
                data, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<TeslaChargingSessionsMapData>.Loaded(data, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical metadata + localized copy for the charging-sessions map surface — the native mirror of the web
/// component at <c>web/src/features/charging/pages/TeslaChargingSessionsMap.tsx</c>. Centralises the diagnostics
/// slug, the default currency symbol, the map pin glyph, and the i18n keys (the same <c>tesla_sessions.*</c> keys
/// the web component uses, plus shared <c>common.*</c> / <c>error.*</c> chrome keys) so the view and view-model
/// stay free of literal strings.
/// </summary>
public static class TeslaChargingSessionsMapRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "TeslaChargingSessionsMap";

    /// <summary>The default currency symbol for the popup cost line (web settings default "$").</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Segoe Fluent "MapPin" glyph (web Leaflet marker / empty-state pin).</summary>
    public const string MapPinGlyph = "\uE707";

    /// <summary>The accessible map-region name (web <c>aria-label</c> "Charging sessions map").</summary>
    public static string MapLabel(ILocalizer localizer) =>
        Require(localizer).GetString("tesla_sessions.mapLabel", "Charging sessions map");

    /// <summary>The "Unknown" fallback site name (web <c>t('tesla_sessions.unknown')</c>).</summary>
    public static string Unknown(ILocalizer localizer) =>
        Require(localizer).GetString("tesla_sessions.unknown", "Unknown");

    /// <summary>The empty-overlay copy when no session has coordinates.</summary>
    public static string NoMapData(ILocalizer localizer) =>
        Require(localizer).GetString("tesla_sessions.noMapData", "No location data available yet.");

    /// <summary>The per-marker Narrator label (web <c>tesla_sessions.markerLabel</c>) with the site name interpolated.</summary>
    public static string MarkerLabel(ILocalizer localizer, string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        // The generated Windows catalog renders the web i18next "{{name}}" token as the positional
        // string.Format slot "{0}" (apps/shared/i18n/generators/gen-i18n.ts), so the marker's
        // accessible label is composed with string.Format — mirroring the web t('…', { name }) call.
        string template = Require(localizer).GetString("tesla_sessions.markerLabel", "{0} charging session");
        return string.Format(CultureInfo.CurrentCulture, template, name);
    }

    /// <summary>The stale freshness-chip label.</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("mqtt.stale", "Stale");

    /// <summary>The offline freshness-chip label.</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.offline", "Offline");

    /// <summary>The retry affordance label (web <c>QueryError</c> retry).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.retry", "Retry");

    /// <summary>The loading Narrator announcement.</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.loading", "Loading...");

    /// <summary>The hard-error copy shown when no cached payload exists.</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("error.loadFailed", "Failed to load data");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the charging-sessions map surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a site name, coordinate, cost, VIN or
/// session id — so a diagnostics line can never leak a user's charging whereabouts. Thread-safe.
/// </summary>
public sealed class TeslaChargingSessionsMapDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public TeslaChargingSessionsMapDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TeslaChargingSessionsMap</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TeslaChargingSessionsMapRegistration.Slug}");
    }
}
