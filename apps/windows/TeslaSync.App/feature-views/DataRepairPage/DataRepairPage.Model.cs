using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The active tab of the <c>DataRepairPage</c> — the native mirror of the web <c>Tab</c> union
/// (<c>'charging' | 'drives'</c>) the page tracks in <c>useState</c>
/// (web/src/features/system/pages/DataRepairPage.tsx). Selecting a tab swaps the stale-record list rendered
/// in the content area and collapses any open inline edit form (web <c>setExpandedId(null)</c>).
/// </summary>
public enum RepairTab
{
    /// <summary>The stale charging-session list (web <c>tab === 'charging'</c>).</summary>
    Charging,

    /// <summary>The stale drive list (web <c>tab === 'drives'</c>).</summary>
    Drives,
}

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>DataRepairPage</c> content surface — the native mirror of the
/// render branches the web page composes (web/src/features/system/pages/DataRepairPage.tsx). The web page gates the
/// whole surface on the <c>useQuery(['stale-sessions'])</c> lifecycle (loading spinner / error surface via
/// <c>PageContainer</c>) and, once resolved, renders either the empty notice (<c>records.length === 0</c>) or the
/// stale-record list. The four states are surfaced explicitly so the data-state contract (loading → empty → error →
/// success) holds; the four stat tiles and the tab bar render in both resolved states (empty + success).
/// </summary>
public enum DataRepairState
{
    /// <summary>The stale-sessions query is in flight on first paint (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>The query failed — the failure surface + retry shows (web <c>PageContainer error</c>).</summary>
    Error,

    /// <summary>The query resolved but the active tab has no stale records (web <c>records.length === 0</c>).</summary>
    Empty,

    /// <summary>The query resolved with one or more stale records in the active tab (web list branch).</summary>
    Success,
}

/// <summary>
/// One stale (open) charging session the repair tool lists — the native mirror of the web <c>ChargingSession</c>
/// interface (web/src/features/system/pages/DataRepairPage.tsx). Field names mirror the Go snake_case JSON tags; every
/// optional metric is null-tolerant so a partial server payload never throws. Numeric metrics are stored exactly as
/// the API returns them (SI on the wire — Wh, W); the inline edit form labels mirror the web labels verbatim. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The session id (web <c>id</c>).</param>
/// <param name="VehicleId">The owning vehicle id (web <c>vehicle_id</c>).</param>
/// <param name="StartTs">The ISO start timestamp (web <c>start_ts</c>), or null when absent.</param>
/// <param name="StartBatteryPct">The battery % at start (web <c>start_battery_pct</c>).</param>
/// <param name="EndBatteryPct">The battery % at end, when known (web <c>end_battery_pct</c>).</param>
/// <param name="TotalEnergyAddedWh">Energy added in Wh, when known (web <c>total_energy_added_wh</c>).</param>
/// <param name="PeakPowerW">Peak charger power in W, when known (web <c>peak_power_w</c>).</param>
/// <param name="DurationMin">Duration in minutes, when known (web <c>duration_min</c>).</param>
/// <param name="Cost">Session cost, when known (web <c>cost</c>).</param>
public sealed record StaleChargingSession(
    long Id,
    long VehicleId,
    string? StartTs,
    double? StartBatteryPct,
    double? EndBatteryPct,
    double? TotalEnergyAddedWh,
    double? PeakPowerW,
    double? DurationMin,
    double? Cost)
{
    /// <summary>Parse one stale charging session from a JSON object, tolerating missing / null fields.</summary>
    public static StaleChargingSession FromJson(JsonElement o) => new(
        Id: DataRepairJson.Long(o, "id") ?? 0,
        VehicleId: DataRepairJson.Long(o, "vehicle_id") ?? 0,
        StartTs: DataRepairJson.Str(o, "start_ts"),
        StartBatteryPct: DataRepairJson.Double(o, "start_battery_pct"),
        EndBatteryPct: DataRepairJson.Double(o, "end_battery_pct"),
        TotalEnergyAddedWh: DataRepairJson.Double(o, "total_energy_added_wh"),
        PeakPowerW: DataRepairJson.Double(o, "peak_power_w"),
        DurationMin: DataRepairJson.Double(o, "duration_min"),
        Cost: DataRepairJson.Double(o, "cost"));
}

/// <summary>
/// One stale (open) drive the repair tool lists — the native mirror of the web <c>Drive</c> interface
/// (web/src/features/system/pages/DataRepairPage.tsx). Field names mirror the Go snake_case JSON tags; every optional
/// metric is null-tolerant. Distance / duration / speed are SI on the wire (m, s, m/s) exactly as the inline edit form
/// labels them. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The drive id (web <c>id</c>).</param>
/// <param name="VehicleId">The owning vehicle id (web <c>vehicle_id</c>).</param>
/// <param name="StartTs">The ISO start timestamp (web <c>start_ts</c>), or null when absent.</param>
/// <param name="StartBatteryPct">The battery % at start, when known (web <c>start_battery_pct</c>).</param>
/// <param name="EndBatteryPct">The battery % at end, when known (web <c>end_battery_pct</c>).</param>
/// <param name="DistanceM">Distance in meters, when known (web <c>distance_m</c>).</param>
/// <param name="DurationS">Duration in seconds, when known (web <c>duration_s</c>).</param>
/// <param name="MaxSpeedMps">Max speed in m/s, when known (web <c>max_speed_mps</c>).</param>
public sealed record StaleDrive(
    long Id,
    long VehicleId,
    string? StartTs,
    double? StartBatteryPct,
    double? EndBatteryPct,
    double? DistanceM,
    double? DurationS,
    double? MaxSpeedMps)
{
    /// <summary>Parse one stale drive from a JSON object, tolerating missing / null fields.</summary>
    public static StaleDrive FromJson(JsonElement o) => new(
        Id: DataRepairJson.Long(o, "id") ?? 0,
        VehicleId: DataRepairJson.Long(o, "vehicle_id") ?? 0,
        StartTs: DataRepairJson.Str(o, "start_ts"),
        StartBatteryPct: DataRepairJson.Double(o, "start_battery_pct"),
        EndBatteryPct: DataRepairJson.Double(o, "end_battery_pct"),
        DistanceM: DataRepairJson.Double(o, "distance_m"),
        DurationS: DataRepairJson.Double(o, "duration_s"),
        MaxSpeedMps: DataRepairJson.Double(o, "max_speed_mps"));
}

/// <summary>
/// The stale-sessions inventory the page reads — the native mirror of the web <c>StaleData</c> response
/// (<c>{ stale_charging, stale_drives }</c>) from <c>GET /data-repair/stale-sessions</c>. The tolerant parser unwraps
/// either shape (bare object or the platform <c>{data:{…}}</c> envelope) so a partial payload yields empty lists
/// rather than throwing.
/// </summary>
/// <param name="StaleCharging">The open charging sessions (web <c>stale_charging</c>).</param>
/// <param name="StaleDrives">The open drives (web <c>stale_drives</c>).</param>
public sealed record StaleSessionsSnapshot(
    IReadOnlyList<StaleChargingSession> StaleCharging,
    IReadOnlyList<StaleDrive> StaleDrives)
{
    /// <summary>The empty inventory (web <c>data ?? { stale_charging: [], stale_drives: [] }</c>).</summary>
    public static StaleSessionsSnapshot Empty { get; } =
        new(Array.Empty<StaleChargingSession>(), Array.Empty<StaleDrive>());

    /// <summary>Parse the inventory from the stale-sessions JSON response, tolerating absence / null / wrong kinds.</summary>
    public static StaleSessionsSnapshot FromJson(JsonElement root)
    {
        JsonElement body = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            body = data;
        }

        if (body.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var charging = DataRepairJson.ReadObjectArray(
            body, "stale_charging", StaleChargingSession.FromJson);
        var drives = DataRepairJson.ReadObjectArray(
            body, "stale_drives", StaleDrive.FromJson);
        return new StaleSessionsSnapshot(charging, drives);
    }
}

/// <summary>
/// The inline edit-form state for a stale charging session — the native mirror of the web <c>ChargingEditForm</c>'s
/// <c>useState</c> form (six string fields, each pre-filled from the session's current value where present). Held as
/// strings (exactly as the web text inputs hold them) so the "include only non-empty fields" submit rule (web
/// <c>if (form.x)</c>) ports 1:1.
/// </summary>
public sealed record ChargingFormState(
    string EndTs,
    string TotalEnergyAddedWh,
    string EndBatteryPct,
    string PeakPowerW,
    string DurationMin,
    string Cost)
{
    /// <summary>The blank form (no session selected).</summary>
    public static ChargingFormState Empty { get; } =
        new(string.Empty, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty);

    /// <summary>Pre-fill the form from a session (web <c>useState</c> initializer: end_ts blank, metrics from the row).</summary>
    public static ChargingFormState FromSession(StaleChargingSession s)
    {
        ArgumentNullException.ThrowIfNull(s);
        return new ChargingFormState(
            EndTs: string.Empty,
            TotalEnergyAddedWh: DataRepairRegistration.NumberField(s.TotalEnergyAddedWh),
            EndBatteryPct: DataRepairRegistration.NumberField(s.EndBatteryPct),
            PeakPowerW: DataRepairRegistration.NumberField(s.PeakPowerW),
            DurationMin: DataRepairRegistration.NumberField(s.DurationMin),
            Cost: DataRepairRegistration.NumberField(s.Cost));
    }
}

/// <summary>
/// The inline edit-form state for a stale drive — the native mirror of the web <c>DriveEditForm</c>'s <c>useState</c>
/// form (five string fields pre-filled from the drive's current SI values where present).
/// </summary>
public sealed record DriveFormState(
    string EndTs,
    string DistanceM,
    string DurationS,
    string EndBatteryPct,
    string MaxSpeedMps)
{
    /// <summary>The blank form (no drive selected).</summary>
    public static DriveFormState Empty { get; } =
        new(string.Empty, string.Empty, string.Empty, string.Empty, string.Empty);

    /// <summary>Pre-fill the form from a drive (web <c>useState</c> initializer: end_ts blank, metrics from the row).</summary>
    public static DriveFormState FromDrive(StaleDrive d)
    {
        ArgumentNullException.ThrowIfNull(d);
        return new DriveFormState(
            EndTs: string.Empty,
            DistanceM: DataRepairRegistration.NumberField(d.DistanceM),
            DurationS: DataRepairRegistration.NumberField(d.DurationS),
            EndBatteryPct: DataRepairRegistration.NumberField(d.EndBatteryPct),
            MaxSpeedMps: DataRepairRegistration.NumberField(d.MaxSpeedMps));
    }
}

/// <summary>
/// Which inline mutation is in flight for the open edit form — the native mirror of the web mutations' <c>isPending</c>
/// flags (<c>updateMut</c> / <c>closeMut</c> / <c>discardMut</c>). At most one runs at a time; <see cref="None"/> is
/// the idle state.
/// </summary>
public enum RepairBusy
{
    /// <summary>No inline mutation is running.</summary>
    None,

    /// <summary>The partial-update (Save) mutation is in flight (web <c>updateMut.isPending</c>).</summary>
    Update,

    /// <summary>The close mutation is in flight (web <c>closeMut.isPending</c>).</summary>
    Close,

    /// <summary>The discard (delete) mutation is in flight (web <c>discardMut.isPending</c>).</summary>
    Discard,
}

/// <summary>
/// The complete, UI-free input to <see cref="DataRepairProjection"/> — the snapshot the view-model rebuilds on every
/// state change. Holds the resolved inventory + query lifecycle, the active tab / expanded row, the open form's field
/// values and the in-flight mutation flag, plus the clock used for the "hours open" derivation.
/// </summary>
public sealed record DataRepairModel(
    IReadOnlyList<StaleChargingSession> StaleCharging,
    IReadOnlyList<StaleDrive> StaleDrives,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    RepairTab Tab,
    long? ExpandedId,
    ChargingFormState ChargingForm,
    DriveFormState DriveForm,
    RepairBusy Busy,
    DateTimeOffset Now)
{
    /// <summary>The first-paint loading model (web first render: query in flight, charging tab, nothing expanded).</summary>
    public static DataRepairModel Initial { get; } = new(
        StaleCharging: Array.Empty<StaleChargingSession>(),
        StaleDrives: Array.Empty<StaleDrive>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        Tab: RepairTab.Charging,
        ExpandedId: null,
        ChargingForm: ChargingFormState.Empty,
        DriveForm: DriveFormState.Empty,
        Busy: RepairBusy.None,
        Now: DateTimeOffset.UnixEpoch);
}

/// <summary>
/// The partial-update payload a Save sends for a charging session — the native mirror of the web <c>updateMut</c> body
/// builder. Only non-null fields are serialized (web includes a field only when its form string is non-empty), so the
/// backend preserves every untouched column.
/// </summary>
public sealed record ChargingRepairPayload(
    string? EndTs,
    double? TotalEnergyAddedWh,
    double? EndBatteryPct,
    double? PeakPowerW,
    double? DurationMin,
    double? Cost);

/// <summary>
/// The partial-update payload a Save sends for a drive — the native mirror of the web <c>updateMut</c> body builder
/// (only non-null fields serialized).
/// </summary>
public sealed record DriveRepairPayload(
    string? EndTs,
    double? DistanceM,
    double? DurationS,
    double? EndBatteryPct,
    double? MaxSpeedMps);

/// <summary>
/// Tolerant JSON readers shared across the data-repair parsers — the native parity of the page's defensive
/// <c>?.</c> / <c>?? []</c> reads. Each accessor returns <see langword="null"/> when the field is absent or the wrong
/// kind so a partial server payload never throws. UI-free.
/// </summary>
internal static class DataRepairJson
{
    /// <summary>Read a string field, tolerating absence / null / non-string kinds.</summary>
    public static string? Str(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    /// <summary>Read a 64-bit integer field, tolerating absence / null / non-number kinds.</summary>
    public static long? Long(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n)
            ? n
            : null;

    /// <summary>Read a floating-point field, tolerating absence / null / non-number kinds.</summary>
    public static double? Double(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n)
            ? n
            : null;

    /// <summary>Read a named array of objects, mapping each element; absence / non-array yields empty.</summary>
    public static IReadOnlyList<T> ReadObjectArray<T>(JsonElement o, string name, Func<JsonElement, T> read)
    {
        ArgumentNullException.ThrowIfNull(read);

        if (o.ValueKind != JsonValueKind.Object ||
            !o.TryGetProperty(name, out var arr) ||
            arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<T>();
        }

        var rows = new List<T>();
        foreach (var element in arr.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                rows.Add(read(element));
            }
        }

        return rows;
    }
}

/// <summary>
/// Canonical metadata + UI-free formatting helpers for the <c>DataRepairPage</c> feature surface — the native mirror of
/// the web page at <c>web/src/features/system/pages/DataRepairPage.tsx</c> (route <c>/data-repair</c>, nav name
/// <c>Data Repair</c>). Holds the generated OpenAPI operation ids the client feed binds to (ADR-004), the Segoe Fluent
/// glyphs the web Lucide icons map to, and the "hours open" / timestamp / number formatters ported from the web helpers.
/// </summary>
public static class DataRepairRegistration
{
    private const string Dash = "\u2014";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DataRepairPage";

    /// <summary>The navigation route name this page registers under (matches the RouteTable entry).</summary>
    public const string RouteName = "DataRepair";

    /// <summary>The deep-link route the web page lives at (web route <c>/data-repair</c>).</summary>
    public const string WebRoute = "/data-repair";

    /// <summary>Generated op id for the stale inventory (web <c>useQuery(['stale-sessions'])</c>).</summary>
    public const string StaleSessionsOperation = "get_api_v1_data_repair_stale_sessions";

    /// <summary>Generated op id for a charging partial-update (web <c>updateMut</c> PUT /data-repair/charging/{id}).</summary>
    public const string ChargingUpdateOperation = "put_api_v1_data_repair_charging_id";

    /// <summary>Generated op id for a charging close (web <c>closeMut</c> POST /data-repair/charging/{id}/close).</summary>
    public const string ChargingCloseOperation = "post_api_v1_data_repair_charging_id_close";

    /// <summary>Generated op id for a charging discard (web <c>discardMut</c> DELETE /data-repair/charging/{id}).</summary>
    public const string ChargingDiscardOperation = "delete_api_v1_data_repair_charging_id";

    /// <summary>Generated op id for a drive partial-update (web <c>updateMut</c> PUT /data-repair/drives/{id}).</summary>
    public const string DriveUpdateOperation = "put_api_v1_data_repair_drive_id";

    /// <summary>Generated op id for a drive close (web <c>closeMut</c> POST /data-repair/drives/{id}/close).</summary>
    public const string DriveCloseOperation = "post_api_v1_data_repair_drive_id_close";

    /// <summary>Generated op id for a drive discard (web <c>discardMut</c> DELETE /data-repair/drives/{id}).</summary>
    public const string DriveDiscardOperation = "delete_api_v1_data_repair_drive_id";

    /// <summary>Glyph for the Status tile / repair affordance (web <c>Wrench</c>).</summary>
    public const string WrenchGlyph = "\uE90F";

    /// <summary>Glyph for the charging tile + tab (web <c>BatteryCharging</c>).</summary>
    public const string BatteryChargingGlyph = "\uE945";

    /// <summary>Glyph for the drives tile + tab (web <c>Route</c>).</summary>
    public const string RouteGlyph = "\uE804";

    /// <summary>Glyph for the Total-Stale tile and the open-row badge (web <c>AlertTriangle</c>).</summary>
    public const string AlertTriangleGlyph = "\uE7BA";

    /// <summary>Glyph for the all-clear empty state (web <c>CheckCircle</c>).</summary>
    public const string CheckCircleGlyph = "\uEC61";

    /// <summary>Glyph for the Save action (web <c>Save</c>).</summary>
    public const string SaveGlyph = "\uE74E";

    /// <summary>Glyph for the Close action (web <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Glyph for the Discard action (web <c>Trash2</c>).</summary>
    public const string TrashGlyph = "\uE74D";

    /// <summary>Glyph for the Cancel action (web <c>X</c>).</summary>
    public const string CancelGlyph = "\uE711";

    /// <summary>The example End-Date input hint the web form shows (web input hint <c>2026-03-30T04:00:00Z</c>).</summary>
    public const string EndDateHint = "2026-03-30T04:00:00Z";

    /// <summary>The accent rail brush key for the Total-Stale tile (web <c>color="amber"</c>).</summary>
    public const string AmberAccentKey = "TsColorWarningBrush";

    /// <summary>The accent rail brush key for the Stale-Charging tile (web <c>color="cyan"</c>).</summary>
    public const string CyanAccentKey = "TsChartSpeedBrush";

    /// <summary>The accent rail brush key for the Stale-Drives tile (web <c>color="purple"</c>).</summary>
    public const string PurpleAccentKey = "TsChartPowerBrush";

    /// <summary>The accent rail brush key for a clean Status tile (web <c>color="green"</c>).</summary>
    public const string GreenAccentKey = "TsColorSuccessBrush";

    /// <summary>The accent rail brush key for a needs-repair Status tile (web <c>color="red"</c>).</summary>
    public const string RedAccentKey = "TsColorDangerBrush";

    /// <summary>The localized page title (web <c>t('Data Repair')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Data Repair", "Data Repair");
    }

    /// <summary>Render a numeric field as the web does in a text input (<c>String(value ?? '')</c>): empty when null.</summary>
    public static string NumberField(double? value) =>
        value is { } v ? v.ToString("0.############", CultureInfo.InvariantCulture) : string.Empty;

    /// <summary>Render a battery percentage the web way (<c>`${pct}%`</c>), or an em dash when null.</summary>
    public static string Percent(double? value) =>
        value is { } v ? string.Concat(v.ToString("0.############", CultureInfo.InvariantCulture), "%") : Dash;

    /// <summary>
    /// The "hours open" badge text (web <c>hoursOpen</c>): <c>{h}h</c> under a day, else <c>{d}d {h%24}h</c>. Hours are
    /// rounded to whole numbers exactly like the web <c>fmtInt</c>; a not-yet-elapsed / unparseable start yields <c>0h</c>.
    /// </summary>
    public static string HoursOpen(string? startTs, DateTimeOffset now)
    {
        if (!TryParseInstant(startTs, out var start))
        {
            return "0h";
        }

        double hours = (now - start).TotalHours;
        if (hours < 0)
        {
            hours = 0;
        }

        if (hours < 24)
        {
            return string.Concat(RoundInt(hours), "h");
        }

        long days = (long)Math.Floor(hours / 24);
        return string.Concat(days.ToString(CultureInfo.InvariantCulture), "d ", RoundInt(hours % 24), "h");
    }

    /// <summary>Format a start timestamp for the row (web <c>formatDateTime</c>); an em dash when absent / unparseable.</summary>
    public static string FormatTimestamp(string? value)
    {
        if (!TryParseInstant(value, out var instant))
        {
            return Dash;
        }

        return instant.ToLocalTime().ToString("MMM d, yyyy h:mm tt", CultureInfo.InvariantCulture);
    }

    private static string RoundInt(double value) =>
        ((long)Math.Round(value, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture);

    private static bool TryParseInstant(string? value, out DateTimeOffset instant)
    {
        if (!string.IsNullOrWhiteSpace(value) &&
            DateTimeOffset.TryParse(
                value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out instant))
        {
            return true;
        }

        instant = default;
        return false;
    }
}
