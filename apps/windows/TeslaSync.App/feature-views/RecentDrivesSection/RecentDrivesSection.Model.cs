using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="RecentDrivesSectionViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches a P2 feature surface must render for the web
/// Recent-Drives section (web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx). The
/// web component is a pure child of the Vehicle-Detail page that receives an already-resolved
/// <c>drives</c> array; the native feature-view owns its own cache-then-network drive-list read, so it
/// renders the full state matrix. Every branch maps onto a visible surface; none is hidden.
/// <see cref="Empty"/> mirrors the web <c>drives &amp;&amp; drives.length &gt; 0 ? … : &lt;EmptyState/&gt;</c>
/// gate (no drives recorded), distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum RecentDrivesSectionState
{
    /// <summary>Initial fetch with no cached drive list — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) drive list with at least one drive — render the table.</summary>
    Loaded,

    /// <summary>No drives resolved — render the friendly empty surface (web <c>EmptyState</c>).</summary>
    Empty,

    /// <summary>The request failed and no cached drive list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached drive list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached drive list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive reduced to the fields the Recent-Drives table reads — the SI <c>start_ts</c> (the Date column),
/// <c>distance_m</c> in metres (the Distance column + its sort key), <c>duration_s</c> in seconds (the
/// Duration column) and the start / end state-of-charge percentages (the Battery column). Mirrors the web
/// <c>Drive</c> SI fields (<c>start_ts</c> / <c>distance_m</c> / <c>duration_s</c> / <c>start_soc_pct</c> /
/// <c>end_soc_pct</c> in <c>@/api/types</c>). Parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Id">Drive identity (web <c>id</c>); the table keys rows on this.</param>
/// <param name="StartTs">Drive start instant, or null (web <c>start_ts</c>).</param>
/// <param name="DistanceM">Distance travelled in SI metres, or null (web <c>distance_m</c>).</param>
/// <param name="DurationS">Drive duration in SI seconds, or null (web <c>duration_s</c>).</param>
/// <param name="StartSocPct">State of charge at the start, or null (web <c>start_soc_pct</c>).</param>
/// <param name="EndSocPct">State of charge at the end, or null (web <c>end_soc_pct</c>).</param>
public sealed record RecentDriveSample(
    long Id,
    DateTimeOffset? StartTs,
    double? DistanceM,
    double? DurationS,
    double? StartSocPct,
    double? EndSocPct)
{
    /// <summary>Parse a drive-list JSON array into a tolerant list of samples, preserving order.</summary>
    public static IReadOnlyList<RecentDriveSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<RecentDriveSample>();
        }

        var list = new List<RecentDriveSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single drive-list JSON object into a tolerant sample.</summary>
    public static RecentDriveSample FromJson(JsonElement obj) => new(
        GetInt64(obj, "id"),
        GetDateTime(obj, "start_ts"),
        GetDouble(obj, "distance_m"),
        GetDouble(obj, "duration_s"),
        GetDouble(obj, "start_soc_pct"),
        GetDouble(obj, "end_soc_pct"));

    private static long GetInt64(JsonElement obj, string name)
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

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var ts)
            ? ts
            : null;
    }
}

/// <summary>
/// One projected, display-ready drive row — the four resolved cell strings the web column <c>render</c>
/// callbacks produce, plus the raw SI distance (the numeric sort key behind the web <c>sortable</c> Distance
/// column) and the Narrator name for the whole row. Pure data so the projection is asserted headlessly.
/// </summary>
/// <param name="Id">The row identity (web <c>keyExtractor={(d) =&gt; d.id}</c>).</param>
/// <param name="StartTs">The start instant the view renders through its locale-aware time control.</param>
/// <param name="DistanceMeters">The SI distance behind the numeric Distance sort (web <c>sortable</c>).</param>
/// <param name="DateText">The Date cell text (web <c>formatDateTime(start_ts)</c>).</param>
/// <param name="DistanceText">The Distance cell text (web <c>fmtNumber(convertDistanceFromSI(distance_m ?? 0)) + unit</c>).</param>
/// <param name="DurationText">The Duration cell text (web <c>durationStr((duration_s ?? 0) / 60)</c>).</param>
/// <param name="BatteryText">The Battery cell text (web <c>start% → end%</c> or the em-dash).</param>
/// <param name="AutomationName">The composed Narrator name for the whole row.</param>
public sealed record RecentDriveRow(
    long Id,
    DateTimeOffset? StartTs,
    double DistanceMeters,
    string DateText,
    string DistanceText,
    string DurationText,
    string BatteryText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Recent-Drives section for one drive list + sort + page —
/// the native analogue of what the web <c>RecentDrivesSection</c> renders. Holds the always-present chrome
/// (title, "View all" label, empty message, the four column headers), the active Distance-sort direction, the
/// current page's <see cref="Rows"/>, and the pagination metadata. Pure data so every branch is asserted
/// without a UI host.
/// </summary>
public sealed record RecentDrivesSectionDisplay(
    bool HasData,
    int DriveCount,
    string Title,
    string ViewAllLabel,
    string EmptyMessage,
    string DateHeader,
    string DistanceHeader,
    string DurationHeader,
    string BatteryHeader,
    IReadOnlyList<RecentDriveRow> Rows,
    SortDirection DistanceSortDirection,
    bool ShowPagination,
    int Page,
    int PageCount,
    int PageSize,
    int TotalCount,
    int RangeStart,
    int RangeEnd,
    string FirstLabel,
    string PreviousLabel,
    string NextLabel,
    string LastLabel);

/// <summary>
/// Pure projection from the raw drive list (+ sort + page) to the display model — the native port of the web
/// <c>useDriveColumns</c> column renderers and the <c>&lt;DataTable compact pagination /&gt;</c> the web
/// <c>RecentDrivesSection</c> composes (web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx).
/// The four columns reproduce the web renderers verbatim — Date (<c>formatDateTime</c>), Distance
/// (<c>fmtNumber(convertDistanceFromSI(distance_m ?? 0)) + unit</c>, the sole sortable column), Duration
/// (<c>durationStr((duration_s ?? 0) / 60)</c>) and Battery (<c>start% → end%</c> else em-dash) — converting
/// SI to the user's units only here (web <c>useUnits</c>). Every chrome string resolves through the i18n
/// facade using the same keys the web feeds <c>t()</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class RecentDrivesSectionProjection
{
    /// <summary>Distance column key (web <c>key: 'distance'</c>); the only sortable column.</summary>
    public const string DistanceColumnKey = "distance";

    /// <summary>Default rows per page for the compact table (web <c>DataTable</c> compact default).</summary>
    public const int DefaultPageSize = 10;

    private const string EmDash = "\u2014";
    private const string Arrow = "\u2192";

    /// <summary>Project one drive sample into its four display cells (web column renderers) for <paramref name="units"/>.</summary>
    /// <param name="sample">The drive to project.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    public static RecentDriveRow ProjectRow(RecentDriveSample sample, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(sample);
        ArgumentNullException.ThrowIfNull(units);

        // web: render: (d) => formatDateTime(d.start_ts) — null renders the em-dash.
        string dateText = DateTimeFormatting.Format(sample.StartTs, DateTimeVariant.Full, DateTimeOffset.Now);

        // web: `${fmtNumber(convertDistanceFromSI(d.distance_m ?? 0, distanceUnit))} ${distanceUnit}` — the
        // `?? 0` means a missing distance renders "0 <unit>", never the em-dash; the unit module owns the
        // SI→display conversion + label at the render boundary.
        double meters = sample.DistanceM ?? 0;
        string distanceText = UnitFormatters.FormatDistance(meters, units);

        // web: durationStr((d.duration_s ?? 0) / 60).
        string durationText = DurationString((sample.DurationS ?? 0) / 60.0);

        // web: start_soc_pct != null && end_soc_pct != null ? `${start}% → ${end}%` : '—'.
        string batteryText = sample.StartSocPct is { } start && sample.EndSocPct is { } end
            ? string.Concat(FormatSoc(start), "% ", Arrow, " ", FormatSoc(end), "%")
            : EmDash;

        string automationName = string.Join(", ", dateText, distanceText, durationText, batteryText);

        return new RecentDriveRow(
            Id: sample.Id,
            StartTs: sample.StartTs,
            DistanceMeters: meters,
            DateText: dateText,
            DistanceText: distanceText,
            DurationText: durationText,
            BatteryText: batteryText,
            AutomationName: automationName);
    }

    /// <summary>Project <paramref name="samples"/> for <paramref name="units"/> with the given sort + page.</summary>
    /// <param name="samples">The full drive list (newest first, as the API returns it).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="sort">The Distance-column sort state (web <c>DataTable</c> sortable header).</param>
    /// <param name="page">The 1-based current page (web pagination).</param>
    /// <param name="pageSize">The current page size.</param>
    public static RecentDrivesSectionDisplay Project(
        IReadOnlyList<RecentDriveSample> samples,
        UnitPref units,
        ILocalizer localizer,
        TableSortState sort,
        int page,
        int pageSize)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(sort);

        var rows = new List<RecentDriveRow>(samples.Count);
        foreach (var sample in samples)
        {
            rows.Add(ProjectRow(sample, units));
        }

        // web: only the Distance column is sortable; the table otherwise preserves the source (recency) order.
        IReadOnlyList<RecentDriveRow> sorted = sort.Apply(rows, static r => r.DistanceMeters);

        var pagination = new PaginationState { PageSize = pageSize };
        pagination.Total = sorted.Count;
        pagination.Page = page;
        var paged = pagination.Slice(sorted);

        return new RecentDrivesSectionDisplay(
            HasData: rows.Count > 0,
            DriveCount: rows.Count,
            Title: localizer.GetString("common.recentDrives", "Recent Drives"),
            ViewAllLabel: localizer.GetString("common.viewAll", "View all"),
            EmptyMessage: localizer.GetString("common.noDrives", "No drives recorded yet"),
            DateHeader: localizer.GetString("common.date", "Date"),
            DistanceHeader: localizer.GetString("common.distance", "Distance"),
            DurationHeader: localizer.GetString("common.duration", "Duration"),
            BatteryHeader: localizer.GetString("common.battery", "Battery"),
            Rows: paged,
            DistanceSortDirection: sort.DirectionFor(DistanceColumnKey),
            ShowPagination: rows.Count > pageSize,
            Page: pagination.Page,
            PageCount: pagination.PageCount,
            PageSize: pagination.PageSize,
            TotalCount: pagination.Total,
            RangeStart: pagination.RangeStart,
            RangeEnd: pagination.RangeEnd,
            FirstLabel: localizer.GetString("pagination.first", "First page"),
            PreviousLabel: localizer.GetString("pagination.previous", "Previous page"),
            NextLabel: localizer.GetString("pagination.next", "Next page"),
            LastLabel: localizer.GetString("pagination.last", "Last page"));
    }

    /// <summary>Project the empty (no drives) display for the given units and localizer.</summary>
    public static RecentDrivesSectionDisplay Empty(UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        return Project(Array.Empty<RecentDriveSample>(), units, localizer, new TableSortState(), 1, DefaultPageSize);
    }

    // web durationStr(minutes): h = floor(minutes / 60); m = fmtInt(minutes % 60); h > 0 ? `${h}h ${m}m` : `${m}m`.
    // fmtInt rounds half-away-from-zero with en-US grouping (NumberFormatting.Format at 0 digits); the hour count
    // is printed verbatim (the web `${h}` template literal applies no grouping).
    private static string DurationString(double minutes)
    {
        long hours = (long)Math.Floor(minutes / 60.0);
        string mins = NumberFormatting.Format(minutes % 60.0, null, 0);
        return hours > 0
            ? string.Concat(hours.ToString(CultureInfo.InvariantCulture), "h ", mins, "m")
            : string.Concat(mins, "m");
    }

    // web `${d.start_soc_pct}` / `${d.end_soc_pct}` — a JS number template, so an integral percentage renders
    // with no decimals and a fractional one keeps its natural representation; never grouped.
    private static string FormatSoc(double value) =>
        value == Math.Floor(value)
            ? ((long)value).ToString(CultureInfo.InvariantCulture)
            : value.ToString(CultureInfo.InvariantCulture);
}

/// <summary>
/// Canonical registry metadata for the Recent-Drives surface — the native mirror of the web vehicle-detail
/// component (web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx). Hosting binds this
/// surface with the stable <see cref="Id"/>; diagnostics tag it with <see cref="Slug"/>.
/// </summary>
public static class RecentDrivesSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "recent-drives-section";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RecentDrivesSection";

    /// <summary>Localized surface title (web "Recent Drives").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("common.recentDrives", "Recent Drives");
    }
}

/// <summary>
/// PII-safe diagnostics for the Recent-Drives surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a drive id, distance, duration, SOC,
/// timestamp, VIN or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class RecentDrivesSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RecentDrivesSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RecentDrivesSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RecentDrivesSectionRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw drive-list <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;RecentDriveSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested.
/// </summary>
public static class RecentDrivesSectionResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s drive-list payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<RecentDriveSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<RecentDriveSample> Parse() =>
            raw.HasValue ? RecentDriveSample.ParseList(raw.Value) : Array.Empty<RecentDriveSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<RecentDriveSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<RecentDriveSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<RecentDriveSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<RecentDriveSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<RecentDriveSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<RecentDriveSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
