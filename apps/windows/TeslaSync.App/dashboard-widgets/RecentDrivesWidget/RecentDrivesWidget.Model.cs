using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="RecentDrivesViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>RecentDrivesWidget</c>
/// renders through <c>WidgetShell</c> (web/src/features/dashboard/widgets/RecentDrivesWidget.tsx).
/// Every branch maps onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the
/// web <c>items.length === 0</c> gate — the friendly "No recent drives" empty state — distinct from a
/// transport failure (<see cref="Error"/>).
/// </summary>
public enum RecentDrivesState
{
    /// <summary>Initial fetch with no cached drives — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one drive to list.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no drives — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive from the drive-history list (web <c>Drive</c> in
/// web/src/features/dashboard/types.ts). Only the fields the web <c>RecentDrivesWidget</c> row reads are
/// projected: the SI distance in metres (<c>distance_m</c>), the SI duration in seconds
/// (<c>duration_s</c>), the start/end state-of-charge percent, and the start timestamp
/// (<c>start_ts</c>). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a
/// partial row never throws.
/// </summary>
/// <param name="Id">The drive id (used to build the per-drive drill-through, web <c>d.id</c>).</param>
/// <param name="DistanceM">Distance driven in metres (web <c>d.distance_m ?? 0</c>).</param>
/// <param name="DurationS">Duration in seconds (web <c>d.duration_s ?? 0</c>).</param>
/// <param name="StartSocPct">Start state-of-charge percent, or null (web <c>d.start_soc_pct ?? '?'</c>).</param>
/// <param name="EndSocPct">End state-of-charge percent, or null (web <c>d.end_soc_pct ?? '?'</c>).</param>
/// <param name="StartTs">The drive start instant, or null (web <c>d.start_ts</c>).</param>
public sealed record RecentDrivesDrive(
    long Id,
    double DistanceM,
    long DurationS,
    long? StartSocPct,
    long? EndSocPct,
    DateTimeOffset? StartTs)
{
    /// <summary>Parse a drive-history JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<RecentDrivesDrive> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<RecentDrivesDrive>();
        }

        var list = new List<RecentDrivesDrive>(element.GetArrayLength());
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
    public static RecentDrivesDrive FromJson(JsonElement obj) => new(
        Id: GetLong(obj, "id") ?? 0,
        DistanceM: GetDouble(obj, "distance_m") ?? 0,
        DurationS: GetLong(obj, "duration_s") ?? 0,

        // Web parity reads `start_soc_pct` / `end_soc_pct` (the web Drive type's field names). The live Go
        // API + OpenAPI contract carry the same value under `start_battery_pct` / `end_battery_pct`, so we
        // accept either: the web key first (literal-spec parity), then the wire key (correctness against
        // the real backend). Absent on both → null → rendered as the web's '?'.
        StartSocPct: GetPercent(obj, "start_soc_pct", "start_battery_pct"),
        EndSocPct: GetPercent(obj, "end_soc_pct", "end_battery_pct"),
        StartTs: GetTimestamp(obj, "start_ts"));

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
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

    /// <summary>Read the first present, finite integer percentage among <paramref name="names"/>, rounding a fractional value.</summary>
    private static long? GetPercent(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
        {
            if (!obj.TryGetProperty(name, out var v))
            {
                continue;
            }

            if (v.ValueKind == JsonValueKind.Number)
            {
                if (v.TryGetInt64(out var n))
                {
                    return n;
                }

                if (v.TryGetDouble(out var d) && !double.IsNaN(d) && !double.IsInfinity(d))
                {
                    return (long)Math.Round(d, MidpointRounding.AwayFromZero);
                }
            }
            else if (v.ValueKind == JsonValueKind.String &&
                long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s))
            {
                return s;
            }
        }

        return null;
    }

    private static DateTimeOffset? GetTimestamp(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. Unlike most
/// surfaces, web/src/features/dashboard/widgets/RecentDrivesWidget.tsx does NOT branch on the footprint —
/// it always lists the most-recent drives — so this struct carries no compact/wide flag and exists only
/// for the registry's min/max bounds and the dashboard grid's footprint API.
/// </summary>
public readonly record struct RecentDrivesSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static RecentDrivesSize Default => new(2, 4);
}

/// <summary>
/// One projected, display-ready drive row consumed by the WinUI view — the native analogue of a single
/// web row's <c>&lt;Link&gt;</c>. Holds the formatted display-unit distance (<see cref="DistanceText"/>),
/// the duration + start→end SoC detail line (<see cref="DetailText"/>), the short start date
/// (<see cref="DateText"/>), the per-drive drill-through route (<see cref="Target"/>), and a Narrator
/// automation name. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record RecentDrivesRow(
    long DriveId,
    string DistanceText,
    string DetailText,
    string DateText,
    string Target,
    string AutomationName);

/// <summary>
/// Pure projection from the raw drive list to display rows — the native port of the row mapping in
/// web/src/features/dashboard/widgets/RecentDrivesWidget.tsx. Takes the five most-recent drives (the web
/// query's <c>limit=5</c>; the backend orders <c>started_at DESC</c>, so the first five rows are the
/// newest), converts distance from SI metres to the user's display unit exactly as the web
/// <c>convertDistanceFromSI(distance_m, unit)</c> does, restates duration to whole minutes, and renders
/// the start→end state-of-charge line (a null percent becomes the web's '?'). Every label resolves through
/// the i18n facade / unit-label map; every drive row carries a drill-through route and a Narrator name.
/// </summary>
public static class RecentDrivesProjection
{
    /// <summary>Segoe Fluent "Car" glyph for the surface header / empty state (web registry icon <c>Car</c>).</summary>
    public const string HeaderGlyph = "\uE804";

    /// <summary>The most-recent drives retained for the list (web query <c>limit=5</c>).</summary>
    public const int WindowLimit = 5;

    /// <summary>Seconds per minute — restates the wire <c>duration_s</c> to whole minutes (web <c>/ 60</c>).</summary>
    public const double SecondsPerMinute = 60.0;

    /// <summary>The web's literal '?' fallback for an absent state-of-charge percent.</summary>
    public const string UnknownPercent = "?";

    /// <summary>The drive-list route the "View all" action navigates to (web <c>/drives</c>, no leading slash).</summary>
    public const string ListRoute = "drives";

    /// <summary>The per-drive drill-through route for <paramref name="driveId"/> (web <c>/drives/{id}</c>).</summary>
    public static string DriveRoute(long driveId) =>
        string.Create(CultureInfo.InvariantCulture, $"{ListRoute}/{driveId}");

    /// <summary>Project the five most-recent <paramref name="drives"/> using the user's units and the localizer for every label.</summary>
    /// <param name="drives">The drive list, newest-first (the backend orders <c>started_at DESC</c>).</param>
    /// <param name="units">The user's unit preference (the distance display unit).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static IReadOnlyList<RecentDrivesRow> Project(
        IReadOnlyList<RecentDrivesDrive> drives,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(drives);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);

        // Web parity: duration is always shown in whole minutes (a fixed `/ 60` + the "min" abbreviation),
        // independent of the user's duration unit preference.
        string minutesLabel = UnitLabels.Label(DurationUnit.Minutes);

        int take = Math.Min(drives.Count, WindowLimit);
        var rows = new List<RecentDrivesRow>(take);
        for (int i = 0; i < take; i++)
        {
            var drive = drives[i];

            double displayDistance = UnitConverters.DistanceFromSi(drive.DistanceM, distanceUnit);
            string distanceText = string.Format(
                CultureInfo.CurrentCulture, "{0} {1}", Fmt(displayDistance, 1), distanceUnitLabel);

            string minutes = Fmt(drive.DurationS / SecondsPerMinute, 0);
            string startSoc = drive.StartSocPct?.ToString(CultureInfo.CurrentCulture) ?? UnknownPercent;
            string endSoc = drive.EndSocPct?.ToString(CultureInfo.CurrentCulture) ?? UnknownPercent;

            // Web parity: "{minutes} min · {start}% → {end}%" (U+00B7 middle dot, U+2192 rightwards arrow).
            string detailText = string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1} \u00B7 {2}% \u2192 {3}%",
                minutes,
                minutesLabel,
                startSoc,
                endSoc);

            // Web parity: formatDateShort(start_ts) → an absolute "MMM d" (the Short variant ignores `now`).
            string dateText = DateTimeFormatting.Format(
                drive.StartTs, DateTimeVariant.Short, drive.StartTs ?? DateTimeOffset.UnixEpoch);

            rows.Add(new RecentDrivesRow(
                DriveId: drive.Id,
                DistanceText: distanceText,
                DetailText: detailText,
                DateText: dateText,
                Target: DriveRoute(drive.Id),
                AutomationName: AutomationName(distanceText, detailText, dateText)));
        }

        return rows;
    }

    private static string AutomationName(string distanceText, string detailText, string dateText) =>
        string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", distanceText, detailText, dateText);

    /// <summary>
    /// Format a number exactly as the web <c>fmtNumber</c> / <c>fmtInt</c> does: coerce null / NaN / ±∞ to
    /// 0 (web <c>safeNumber</c>) then render with fixed <paramref name="decimals"/> fraction digits and
    /// en-US grouping.
    /// </summary>
    private static string Fmt(double value, int decimals)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;RecentDrivesDrive&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. A freshly
/// loaded empty array collapses to <see cref="RepositoryResult{T}.Empty"/> (the web <c>items.length === 0</c>
/// empty state), while a cached empty list keeps its freshness so the view-model still applies the gate.
/// Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class RecentDrivesResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<RecentDrivesDrive>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<RecentDrivesDrive> Parse() =>
            raw.HasValue ? RecentDrivesDrive.ParseList(raw.Value) : Array.Empty<RecentDrivesDrive>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<RecentDrivesDrive>> ToLoadedOrEmpty(
        IReadOnlyList<RecentDrivesDrive> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<RecentDrivesDrive>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
