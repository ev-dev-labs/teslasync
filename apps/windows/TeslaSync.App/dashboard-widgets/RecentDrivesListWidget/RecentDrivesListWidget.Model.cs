using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="RecentDrivesListViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>RecentDrivesListWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>items.length &gt; 0 ? … :
/// &lt;EmptyState&gt;</c> gate (an empty drive list, or the disabled <c>enabled: id &gt; 0</c> query) — the
/// friendly "No recent drives recorded" empty state. Faithful to the web, a transport failure with no
/// cached drives surfaces through the freshness "Error" chip plus the refresh affordance rather than a body
/// swap (<see cref="Error"/>), so the list/empty body is never replaced by a separate error panel.
/// </summary>
public enum RecentDrivesListState
{
    /// <summary>Initial fetch with no cached drives — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one drive to list.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or an empty drive list — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the freshness error chip + refresh.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive projected from the drive list (web <c>Drive</c> in web/src/features/dashboard/types.ts). Only
/// the fields the web <c>RecentDrivesListWidget</c> reads are kept: the SI distance in meters
/// (<c>distance_m</c>), the SI duration in seconds (<c>duration_s</c>), the start/end state-of-charge
/// percentages (<c>start_soc_pct</c> / <c>end_soc_pct</c>), the optional start/end reverse-geocoded
/// addresses (<c>start_address</c> / <c>end_address</c>), and the <c>start_ts</c> instant (for the short
/// date label). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial
/// row never throws.
/// </summary>
/// <param name="Id">The drive id (web <c>d.id</c>), used for the detail deep-link.</param>
/// <param name="DistanceM">Distance travelled in meters (web <c>distance_m ?? 0</c>).</param>
/// <param name="DurationS">Drive duration in seconds (web <c>duration_s ?? 0</c>).</param>
/// <param name="StartSocPct">Start state-of-charge percent, or null (web <c>start_soc_pct</c>).</param>
/// <param name="EndSocPct">End state-of-charge percent, or null (web <c>end_soc_pct</c>).</param>
/// <param name="StartAddress">Reverse-geocoded start address, or null (web <c>start_address</c>).</param>
/// <param name="EndAddress">Reverse-geocoded end address, or null (web <c>end_address</c>).</param>
/// <param name="StartInstant">Parsed <c>start_ts</c> instant used for the short date label, or null.</param>
public sealed record RecentDrive(
    long Id,
    double DistanceM,
    double DurationS,
    double? StartSocPct,
    double? EndSocPct,
    string? StartAddress,
    string? EndAddress,
    DateTimeOffset? StartInstant)
{
    /// <summary>Parse a drive-list JSON array into a tolerant list of rows, preserving server order.</summary>
    public static IReadOnlyList<RecentDrive> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<RecentDrive>();
        }

        var list = new List<RecentDrive>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single drive JSON object into a tolerant row.</summary>
    public static RecentDrive FromJson(JsonElement obj) => new(
        GetLong(obj, "id"),
        GetDouble(obj, "distance_m") ?? 0,
        GetDouble(obj, "duration_s") ?? 0,
        GetDouble(obj, "start_soc_pct"),
        GetDouble(obj, "end_soc_pct"),
        GetString(obj, "start_address"),
        GetString(obj, "end_address"),
        GetDateTime(obj, "start_ts"));

    private static long GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isWide</c> / <c>isTall</c> / <c>driveLimit</c> logic in
/// web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx (<c>isWide = size.cols &gt;= 3</c>,
/// <c>isTall = size.rows &gt;= 2</c>, <c>driveLimit = isWide ? 10 : isTall ? 7 : 5</c>). The center
/// start/end address column is shown only when <see cref="IsWide"/>.
/// </summary>
public readonly record struct RecentDrivesListSize(int Cols, int Rows)
{
    /// <summary>Drives listed when wide (web <c>driveLimit = 10</c>).</summary>
    public const int WideDriveLimit = 10;

    /// <summary>Drives listed when tall but not wide (web <c>driveLimit = 7</c>).</summary>
    public const int TallDriveLimit = 7;

    /// <summary>Drives listed otherwise (web <c>driveLimit = 5</c>).</summary>
    public const int CompactDriveLimit = 5;

    /// <summary>The registry default footprint (2×4).</summary>
    public static RecentDrivesListSize Default => new(2, 4);

    /// <summary>True at three or more columns (web <c>isWide</c>): show the center address column.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>True at two or more rows (web <c>isTall</c>).</summary>
    public bool IsTall => Rows >= 2;

    /// <summary>How many drives to list at this footprint (web <c>driveLimit</c>).</summary>
    public int DriveLimit => IsWide ? WideDriveLimit : IsTall ? TallDriveLimit : CompactDriveLimit;
}

/// <summary>
/// One projected, display-ready drive row consumed by the WinUI view — the native analogue of a single
/// mapped <c>&lt;Link&gt;</c> in the web list. Holds the navigable detail route plus every already-formatted
/// label (distance + unit, duration, truncated start/end addresses, the SoC transition, the optional
/// battery-used percent, and the short date) and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record RecentDriveRow(
    long Id,
    string DetailRoute,
    string DistanceText,
    string DurationText,
    string StartAddress,
    string EndAddress,
    string BatteryText,
    string? BatteryUsedText,
    string DateText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the recent drives for one footprint — the native analogue of
/// everything the web component computes before returning JSX. Holds the wide-layout flag (the center
/// address column gate), the capped/ordered drive rows, the data flag (web <c>items.length &gt; 0</c>), and
/// the "View all" deep-link route. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record RecentDrivesListDisplay(
    bool IsWide,
    bool HasData,
    IReadOnlyList<RecentDriveRow> Items,
    string ViewAllRoute);

/// <summary>
/// Pure projection from the raw drive list to the display model — the native port of the per-drive mapping,
/// the unit conversion, the duration/date formatting, the address truncation, and the battery-used gate in
/// web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx. Distances are converted from SI meters to
/// the user's display unit exactly as the web <c>convertDistanceFromSI</c> does (and only here); the web
/// <c>limit=driveLimit</c> query cap is applied during projection since the generated drives endpoint scopes
/// by vehicle only and returns rows newest-first.
/// </summary>
public static class RecentDrivesListProjection
{
    /// <summary>Segoe Fluent "trending line" glyph for the header / empty state (web <c>Route</c>).</summary>
    public const string HeaderGlyph = "\uE9D2";

    /// <summary>Segoe Fluent "Recent" glyph for the per-row duration (web <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent "Battery" glyph for the per-row SoC transition (web <c>Battery</c>).</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent "MapPin" glyph for the per-row start/end addresses (web <c>MapPin</c>).</summary>
    public const string MapPinGlyph = "\uE81D";

    /// <summary>Segoe Fluent "ChevronRight" glyph trailing the "View all" action (web <c>ArrowUpRight</c>).</summary>
    public const string ViewAllGlyph = "\uE76C";

    /// <summary>The list route the "View all" action navigates to (web <c>to="/drives"</c>).</summary>
    public const string DrivesRoute = "/drives";

    /// <summary>The detail route prefix each drive row navigates to (web <c>to={`/drives/${d.id}`}</c>).</summary>
    public const string DriveDetailRoutePrefix = "/drives/";

    /// <summary>Label for a sub-one-minute drive (web <c>subMinuteLabel: '&lt;1m'</c>).</summary>
    public const string SubMinuteLabel = "<1m";

    /// <summary>Max address characters before truncation (web <c>truncateAddress(addr, 30)</c>).</summary>
    public const int AddressMaxLength = 30;

    private const string EmDash = "\u2014";
    private const string Ellipsis = "\u2026";
    private const string SocArrow = "\u2192";
    private const string UnknownSoc = "?";
    private const double SecondsPerMinute = 60.0;
    private const double MinutesPerHour = 60.0;

    /// <summary>Project <paramref name="drives"/> for <paramref name="size"/> using the user's distance unit.</summary>
    public static RecentDrivesListDisplay Project(
        IReadOnlyList<RecentDrive> drives,
        RecentDrivesListSize size,
        UnitPref units,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(drives);
        ArgumentNullException.ThrowIfNull(units);

        bool isWide = size.IsWide;
        string distanceUnit = UnitLabels.Label(units.Distance);

        // Web parity: the query caps at driveLimit rows (backend orders newest-first); the list renders
        // them in that order.
        int take = Math.Min(drives.Count, size.DriveLimit);
        var rows = new List<RecentDriveRow>(take);
        for (int i = 0; i < take; i++)
        {
            rows.Add(BuildRow(drives[i], units, distanceUnit, isWide, now));
        }

        return new RecentDrivesListDisplay(
            IsWide: isWide,
            HasData: rows.Count > 0,
            Items: rows,
            ViewAllRoute: DrivesRoute);
    }

    /// <summary>
    /// Format an SI-seconds duration as rounded minutes with hour rollover (web
    /// <c>formatDurationMinutes(seconds / 60, { subMinuteLabel: '&lt;1m' })</c>): the em-dash for
    /// negative / non-finite input, <see cref="SubMinuteLabel"/> below one minute, then "{m}m" or "{h}h {m}m".
    /// </summary>
    public static string FormatDurationMinutes(double seconds)
    {
        double minutes = seconds / SecondsPerMinute;
        if (double.IsNaN(minutes) || double.IsInfinity(minutes) || minutes < 0)
        {
            return EmDash;
        }

        if (minutes < 1)
        {
            return SubMinuteLabel;
        }

        long hours = (long)Math.Floor(minutes / MinutesPerHour);
        string mins = ScalarFormatters.FormatNumber(minutes % MinutesPerHour, 0);
        return hours > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{hours}h {mins}m")
            : mins + "m";
    }

    /// <summary>
    /// Truncate a reverse-geocoded address to <see cref="AddressMaxLength"/> characters with an ellipsis
    /// (web <c>truncateAddress</c>): an em-dash for a null / empty address, otherwise the first
    /// <see cref="AddressMaxLength"/> characters plus "…" when over-long, else the address verbatim.
    /// </summary>
    public static string TruncateAddress(string? address)
    {
        if (string.IsNullOrEmpty(address))
        {
            return EmDash;
        }

        return address.Length > AddressMaxLength ? address[..AddressMaxLength] + Ellipsis : address;
    }

    private static RecentDriveRow BuildRow(
        RecentDrive drive, UnitPref units, string distanceUnit, bool isWide, DateTimeOffset now)
    {
        double dist = UnitConverters.DistanceFromSi(drive.DistanceM, units.Distance);
        string distanceText = ScalarFormatters.FormatNumber(dist, 1) + " " + distanceUnit;
        string durationText = FormatDurationMinutes(drive.DurationS);
        string startAddress = TruncateAddress(drive.StartAddress);
        string endAddress = TruncateAddress(drive.EndAddress);
        string batteryText = FormatSoc(drive.StartSocPct) + "% " + SocArrow + " " + FormatSoc(drive.EndSocPct) + "%";

        // Web parity: batteryUsed = start - end only when both are present; shown only when dist > 0.
        double? batteryUsed = drive.StartSocPct is { } start && drive.EndSocPct is { } end ? start - end : null;
        string? batteryUsedText = batteryUsed is { } used && dist > 0
            ? ScalarFormatters.FormatNumber(used, 0) + "%"
            : null;

        string dateText = DateTimeFormatting.Format(drive.StartInstant, DateTimeVariant.Short, now);
        string detailRoute = DriveDetailRoutePrefix + drive.Id.ToString(CultureInfo.InvariantCulture);
        string automationName = BuildAutomationName(
            distanceText, durationText, isWide, startAddress, endAddress, batteryText, batteryUsedText, dateText);

        return new RecentDriveRow(
            drive.Id,
            detailRoute,
            distanceText,
            durationText,
            startAddress,
            endAddress,
            batteryText,
            batteryUsedText,
            dateText,
            automationName);
    }

    private static string FormatSoc(double? soc) =>
        soc is { } v && !double.IsNaN(v) && !double.IsInfinity(v)
            ? v.ToString(CultureInfo.InvariantCulture)
            : UnknownSoc;

    private static string BuildAutomationName(
        string distance,
        string duration,
        bool isWide,
        string startAddress,
        string endAddress,
        string battery,
        string? batteryUsed,
        string date)
    {
        var parts = new List<string>(7) { distance, duration };
        if (isWide)
        {
            parts.Add(startAddress);
            parts.Add(endAddress);
        }

        parts.Add(battery);
        if (!string.IsNullOrEmpty(batteryUsed))
        {
            parts.Add(batteryUsed);
        }

        parts.Add(date);
        return string.Join(", ", parts);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;RecentDrive&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// empty-list gate (web's <c>items.length === 0</c>) is applied by the view-model, so a populated-but-empty
/// list still flows through with its freshness intact. Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class RecentDrivesListResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<RecentDrive>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<RecentDrive> Parse() =>
            raw.HasValue ? RecentDrive.ParseList(raw.Value) : Array.Empty<RecentDrive>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<RecentDrive>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<RecentDrive>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<RecentDrive>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<RecentDrive>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<RecentDrive>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<RecentDrive>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<RecentDrive>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
