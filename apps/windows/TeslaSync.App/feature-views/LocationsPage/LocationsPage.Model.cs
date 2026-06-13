using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// One parsed visited-location row — the native mirror of a web <c>VisitedLocation</c>
/// (web/src/features/maps/pages/LocationsPage.tsx). SI on the wire:
/// <see cref="TotalDurationS"/> is seconds; <see cref="VisitCount"/> is a count; the optional
/// <see cref="LastVisited"/> is an ISO-8601 timestamp string. Pure data — no WinUI types.
/// </summary>
public sealed record VisitedLocation(
    long Id,
    string AddressName,
    double VisitCount,
    double TotalDurationS,
    string? LastVisited)
{
    /// <summary>The average dwell-time per visit in seconds (web <c>total_duration_s / visit_count</c>).</summary>
    public double AverageDurationS => VisitCount > 0 ? TotalDurationS / VisitCount : 0;

    /// <summary>
    /// The city label the page derives from the address (web: the last comma segment, or the whole
    /// string when there is no comma). Empty / <c>Unknown</c> resolve to <see langword="null"/> so they
    /// never inflate the unique-cities count.
    /// </summary>
    public string? City()
    {
        string source = AddressName ?? string.Empty;
        string[] parts = source.Split(',');
        string city = (parts.Length > 1 ? parts[^1] : parts[0]).Trim();
        if (string.IsNullOrEmpty(city) || string.Equals(city, "Unknown", StringComparison.Ordinal))
        {
            return null;
        }

        return city;
    }
}

/// <summary>
/// The single-source snapshot the page binds to (web <c>useQuery(['visited-locations', …])</c> over
/// <c>GET /locations</c>). One page of visited locations, already ordered by visit frequency by the
/// backend. Pure data.
/// </summary>
public sealed record LocationsSnapshot(IReadOnlyList<VisitedLocation> Locations)
{
    /// <summary>The empty snapshot — no visited locations.</summary>
    public static LocationsSnapshot Empty { get; } = new(Array.Empty<VisitedLocation>());

    /// <summary>True when there is at least one visited location to render.</summary>
    public bool HasData => Locations.Count > 0;

    /// <summary>Parse a <c>GET /locations</c> JSON array into the reduced rows (tolerant of partial bodies).</summary>
    public static IReadOnlyList<VisitedLocation> ParseLocations(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VisitedLocation>();
        }

        var locations = new List<VisitedLocation>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            locations.Add(new VisitedLocation(
                Id: LocationsJson.Long(item, "id") ?? 0,
                AddressName: LocationsJson.String(item, "address_name") ?? string.Empty,
                VisitCount: LocationsJson.Double(item, "visit_count") ?? 0,
                TotalDurationS: LocationsJson.Double(item, "total_duration_s") ?? 0,
                LastVisited: LocationsJson.String(item, "last_visited")));
        }

        return locations;
    }
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface ILocationsFeed
{
    /// <summary>Fetch one page of visited locations for the active vehicle.</summary>
    /// <param name="offset">The zero-based row offset (web <c>(page - 1) * pageSize</c>).</param>
    /// <param name="limit">The page size (web <c>pageSize = 50</c>).</param>
    /// <param name="cancellationToken">Cancels a superseded load.</param>
    Task<LocationsSnapshot> FetchAsync(int offset, int limit, CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyLocationsFeed : ILocationsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyLocationsFeed Instance { get; } = new();

    private EmptyLocationsFeed()
    {
    }

    /// <inheritdoc />
    public Task<LocationsSnapshot> FetchAsync(int offset, int limit, CancellationToken cancellationToken) =>
        Task.FromResult(LocationsSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum LocationsState
{
    /// <summary>The query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no visited locations — the content layout with its friendly empty list.</summary>
    Empty,

    /// <summary>The query failed — the retriable error surface.</summary>
    Error,

    /// <summary>Visited locations resolved — every section renders (each with its own empty fallback).</summary>
    Success,
}

/// <summary>One projected summary metric card (web <c>MetricCard</c>): label, value, glyph and accent rail key.</summary>
public sealed record LocationMetricDisplay(string Label, string Value, string Glyph, string AccentBrushKey);

/// <summary>One projected bar chart (web <c>ChartContainer</c> + recharts BarChart): title, a11y, data + empty.</summary>
public sealed record LocationsChartDisplay(
    string Title,
    string AriaLabel,
    string SeriesName,
    bool HasData,
    IReadOnlyList<ChartPoint> Points,
    ChartRole Role,
    string EmptyMessage);

/// <summary>One projected location row — the rank chip, the name, the pre-formatted stats line and the visit chip.</summary>
public sealed record LocationRowDisplay(
    long Id,
    string Rank,
    string Name,
    string Stats,
    string VisitCountText,
    string RankAccentKey);

/// <summary>
/// The render-ready projection the view binds to — every web region of LocationsPage.tsx as pre-formatted,
/// WinUI-free data: the four data-state flags, the six summary metric cards, the two bar charts (visits / time),
/// and the searchable, paginated all-locations list. Each data source carries its own empty message so no region
/// ever renders blank.
/// </summary>
public sealed record LocationsDisplay(
    LocationsState State,
    string Title,
    string Subtitle,
    string NavTitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    IReadOnlyList<LocationMetricDisplay> Metrics,
    LocationsChartDisplay VisitsChart,
    LocationsChartDisplay TimeChart,
    string ListTitle,
    string SearchHint,
    string SearchQuery,
    string FilterChipLabel,
    bool ShowFilterChip,
    bool ListHasLocations,
    bool ListHasMatches,
    IReadOnlyList<LocationRowDisplay> Rows,
    string ListEmptyTitle,
    string ListEmptyMessage,
    string ListEmptyActionLabel,
    bool ListEmptyActionIsClear,
    int Page,
    int PageSize,
    int TotalItems,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page lifecycle
/// (<see cref="Loading"/> / <see cref="ErrorDetail"/>) and the two view controls the page owns: the
/// <see cref="Search"/> text (client-side address filter) and the current <see cref="Page"/> / <see cref="PageSize"/>.
/// The view-model fills this in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record LocationsModel(
    LocationsSnapshot Snapshot,
    bool Loading,
    string? ErrorDetail,
    string Search,
    int Page,
    int PageSize)
{
    /// <summary>The default page size (web <c>pageSize = 50</c>).</summary>
    public const int DefaultPageSize = 50;

    /// <summary>The initial model: the query is in flight on the first page with no data yet.</summary>
    public static LocationsModel Initial { get; } =
        new(LocationsSnapshot.Empty, true, null, string.Empty, 1, DefaultPageSize);
}

/// <summary>
/// Pure projection from <see cref="LocationsModel"/> to <see cref="LocationsDisplay"/> — the native port of the
/// web LocationsPage's <c>useMemo</c> aggregations and JSX. It mirrors the web's display conversions at the
/// boundary via the shared SI formatters (so the native output equals the canonical web truth), and resolves
/// every visible string through the injected localizer. No WinUI / HTTP / IO.
/// </summary>
public static class LocationsProjection
{
    /// <summary>Segoe Fluent — MapPin (web <c>Navigation</c> / the empty-state <c>MapPin</c>).</summary>
    public const string MapPinGlyph = "\uE81D";

    /// <summary>Segoe Fluent — World (web <c>Building2</c> — the unique-cities readout).</summary>
    public const string WorldGlyph = "\uE909";

    /// <summary>Segoe Fluent — Recent/History (web <c>Hash</c> — the total-visits readout).</summary>
    public const string HashGlyph = "\uE823";

    /// <summary>Segoe Fluent — DateTime/clock (web <c>Clock</c> — the total-time and avg-visit readouts).</summary>
    public const string ClockGlyph = "\uE121";

    /// <summary>Segoe Fluent — FavoriteStar (web <c>Trophy</c> — the most-visited readout).</summary>
    public const string TrophyGlyph = "\uE735";

    /// <summary>The maximum number of bars in the visits chart (web <c>slice(0, 15)</c>).</summary>
    public const int VisitsChartLimit = 15;

    /// <summary>The maximum number of bars in the time chart (web <c>slice(0, 10)</c>).</summary>
    public const int TimeChartLimit = 10;

    private const string Ellipsis = "\u2026";
    private const string EmDash = "\u2014";
    private const string MiddleDot = "\u00B7";
    private const string SuccessBrush = "TsColorSuccessBrush";   // web green
    private const string InfoBrush = "TsColorInfoBrush";         // web blue
    private const string AccentBrush = "TsColorAccentBrush";     // web cyan
    private const string WarningBrush = "TsColorWarningBrush";   // web amber
    private const string PowerBrush = "TsChartPowerBrush";       // web purple (#a855f7)

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed visited-locations page plus the lifecycle / search / pagination controls.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static LocationsDisplay Project(LocationsModel model, UnitPref units, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = LocationsStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var locations = snapshot.Locations;

        LocationsState state =
            model.Loading && !snapshot.HasData ? LocationsState.Loading
            : model.ErrorDetail is not null ? LocationsState.Error
            : !snapshot.HasData ? LocationsState.Empty
            : LocationsState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.Title
            : $"{s.Title}: {model.ErrorDetail}";

        // ── Summary metric cards (web GlassPanel1..6) ───────────────────────────────────────────────────────
        double totalVisits = 0;
        double totalTime = 0;
        var cities = new HashSet<string>(StringComparer.Ordinal);
        foreach (var loc in locations)
        {
            totalVisits += loc.VisitCount;
            totalTime += loc.TotalDurationS;
            if (loc.City() is { } city)
            {
                cities.Add(city);
            }
        }

        int uniquePlaces = locations.Count;
        var topLocation = locations.Count > 0 ? locations[0] : null;
        double avgDurationS = totalVisits > 0 ? totalTime / totalVisits : 0;

        var metrics = new[]
        {
            new LocationMetricDisplay(s.UniquePlaces, ScalarFormatters.FormatNumber(uniquePlaces, 0), MapPinGlyph, SuccessBrush),
            new LocationMetricDisplay(s.UniqueCities, ScalarFormatters.FormatNumber(cities.Count, 0), WorldGlyph, InfoBrush),
            new LocationMetricDisplay(s.TotalVisits, ScalarFormatters.FormatNumber(totalVisits, 0), HashGlyph, AccentBrush),
            new LocationMetricDisplay(s.TotalTime, UnitFormatters.FormatDuration(totalTime, units), ClockGlyph, PowerBrush),
            new LocationMetricDisplay(s.MostVisited, topLocation?.AddressName is { Length: > 0 } name ? name : EmDash, TrophyGlyph, WarningBrush),
            new LocationMetricDisplay(s.AvgVisit, UnitFormatters.FormatDuration(avgDurationS, units), ClockGlyph, AccentBrush),
        };

        // ── Top Locations by Visits / Time (web GlassPanel7 / GlassPanel8) ──────────────────────────────────
        var visitsChart = BuildVisitsChart(locations, s);
        var timeChart = BuildTimeChart(locations, s);

        // ── All Locations list (web GlassPanel9 + per-row GlassPanel10) ─────────────────────────────────────
        string query = (model.Search ?? string.Empty).Trim();
        var filtered = FilterBySearch(locations, query);
        var rows = BuildRows(filtered, units, s, now);

        bool listHasLocations = locations.Count > 0;
        bool listHasMatches = filtered.Count > 0;
        string listEmptyMessage = listHasLocations ? s.NoLocationsMatch : s.NoVisitedRecorded;
        string listEmptyActionLabel = listHasLocations ? s.ClearSearch : s.EmptyCta;

        int totalItems = locations.Count < model.PageSize
            ? ((model.Page - 1) * model.PageSize) + locations.Count
            : (model.Page * model.PageSize) + 1;

        return new LocationsDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            NavTitle: s.NavTitle,
            ShowLoading: state == LocationsState.Loading,
            ShowError: state == LocationsState.Error,
            ShowContent: state is LocationsState.Empty or LocationsState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            Metrics: metrics,
            VisitsChart: visitsChart,
            TimeChart: timeChart,
            ListTitle: s.AllLocations,
            SearchHint: s.SearchByAddress,
            SearchQuery: query,
            FilterChipLabel: $"{s.FilterLabelSearch}: {query}",
            ShowFilterChip: query.Length > 0,
            ListHasLocations: listHasLocations,
            ListHasMatches: listHasMatches,
            Rows: rows,
            ListEmptyTitle: s.NoLocations,
            ListEmptyMessage: listEmptyMessage,
            ListEmptyActionLabel: listEmptyActionLabel,
            ListEmptyActionIsClear: listHasLocations,
            Page: model.Page,
            PageSize: model.PageSize,
            TotalItems: Math.Max(totalItems, 0),
            AutomationName: s.Title);
    }

    private static LocationsChartDisplay BuildVisitsChart(IReadOnlyList<VisitedLocation> locations, LocationsStrings s)
    {
        int take = Math.Min(VisitsChartLimit, locations.Count);
        var points = new List<ChartPoint>(take);
        for (int i = 0; i < take; i++)
        {
            points.Add(new ChartPoint(i, locations[i].VisitCount, Truncate(locations[i].AddressName)));
        }

        // Web fill #10b981 == TsChartBatteryBrush (ChartRole.Battery).
        return new LocationsChartDisplay(s.TopByVisits, s.TopByVisits, s.Visits, points.Count > 0, points, ChartRole.Battery, s.NoVisitedLocationData);
    }

    private static LocationsChartDisplay BuildTimeChart(IReadOnlyList<VisitedLocation> locations, LocationsStrings s)
    {
        int take = Math.Min(TimeChartLimit, locations.Count);
        var points = new List<ChartPoint>(take);
        for (int i = 0; i < take; i++)
        {
            double hours = Math.Round(locations[i].TotalDurationS / 3600.0, 1, MidpointRounding.AwayFromZero);
            points.Add(new ChartPoint(i, hours, Truncate(locations[i].AddressName)));
        }

        // Web fill #a855f7 == TsChartPowerBrush (ChartRole.Power).
        return new LocationsChartDisplay(s.TopByTime, s.TopByTime, s.Hours, points.Count > 0, points, ChartRole.Power, s.NoTimeSpentData);
    }

    private static IReadOnlyList<VisitedLocation> FilterBySearch(IReadOnlyList<VisitedLocation> locations, string query)
    {
        if (query.Length == 0)
        {
            return locations;
        }

        var matches = new List<VisitedLocation>(locations.Count);
        foreach (var loc in locations)
        {
            if ((loc.AddressName ?? string.Empty).Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                matches.Add(loc);
            }
        }

        return matches;
    }

    private static List<LocationRowDisplay> BuildRows(
        IReadOnlyList<VisitedLocation> locations, UnitPref units, LocationsStrings s, DateTimeOffset now)
    {
        var rows = new List<LocationRowDisplay>(locations.Count);
        for (int i = 0; i < locations.Count; i++)
        {
            var loc = locations[i];
            string visitCountText = ScalarFormatters.FormatNumber(loc.VisitCount, 0);

            // Web stats line: "{n} visits · {dur} total · ~{avg} avg[ · Last: {date}]".
            string stats =
                $"{visitCountText} {s.VisitsLower} {MiddleDot} {UnitFormatters.FormatDuration(loc.TotalDurationS, units)} {s.Total} " +
                $"{MiddleDot} ~{UnitFormatters.FormatDuration(loc.AverageDurationS, units)} {s.Avg}";
            if (TryParseTimestamp(loc.LastVisited, out var lastVisited))
            {
                stats += $" {MiddleDot} {s.Last}: {DateTimeFormatting.Format(lastVisited, DateTimeVariant.Date, now)}";
            }

            string rankAccent = i == 0 ? WarningBrush : i < 3 ? AccentBrush : "TsColorTextMutedBrush";
            rows.Add(new LocationRowDisplay(
                Id: loc.Id,
                Rank: $"#{i + 1}",
                Name: loc.AddressName,
                Stats: stats,
                VisitCountText: visitCountText,
                RankAccentKey: rankAccent));
        }

        return rows;
    }

    // Web: name.length > 25 ? name.slice(0, 22) + '…' : name.
    private static string Truncate(string name)
    {
        string source = name ?? string.Empty;
        return source.Length > 25 ? string.Concat(source.AsSpan(0, 22), Ellipsis) : source;
    }

    private static bool TryParseTimestamp(string? value, out DateTimeOffset parsed)
    {
        if (!string.IsNullOrWhiteSpace(value) &&
            DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out parsed))
        {
            return true;
        }

        parsed = default;
        return false;
    }
}

/// <summary>
/// Canonical metadata for the <c>LocationsPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/maps/pages/LocationsPage.tsx</c> (route <c>/locations</c>, nav name <c>Locations</c>).
/// Holds the route name, the generated operation id it binds to, the diagnostics slug, the empty-surface glyph
/// and the localized title.
/// </summary>
public static class LocationsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LocationsPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "Locations";

    /// <summary>The navigation route the empty-state call-to-action links to (web <c>to: '/drives'</c>).</summary>
    public const string DrivesRoute = "drives";

    /// <summary>The generated operation id for the visited-locations read (web <c>GET /locations</c>).</summary>
    public const string ListOperation = Operations.Locations.List;

    /// <summary>The Segoe Fluent glyph for the list-level empty surface (web <c>MapPin</c>).</summary>
    public const string EmptyGlyph = LocationsProjection.MapPinGlyph;

    /// <summary>The localized page title (web <c>t('Visited Locations')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Visited Locations", "Visited Locations");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>LocationsPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an address, city, visit count or
/// timestamp — so a diagnostics line can never leak a user's location history. Thread-safe.
/// </summary>
public sealed class LocationsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LocationsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LocationsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LocationsRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case visited-locations JSON wire shape (no camelCaseKeys transform on
/// native): numbers (or numeric strings), 64-bit ids and strings. Kept internal so the page's parsers stay
/// self-contained and never throw on a partial body.
/// </summary>
internal static class LocationsJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Reads a 64-bit integer (or integer-string) property, or null when absent / non-integer.</summary>
    public static long? Long(JsonElement obj, string name)
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

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? value = v.GetString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}

/// <summary>
/// The resolved i18n strings for the Locations page — the 28 manifest keys (web key names verbatim) plus the
/// generic retry label. Resolving every key eagerly in <see cref="Resolve"/> means the full key set is exercised
/// in every data state (loading included), matching the web which mounts all translated literals.
/// </summary>
public readonly record struct LocationsStrings(
    string Title,
    string Subtitle,
    string NavTitle,
    string UniquePlaces,
    string UniqueCities,
    string TotalVisits,
    string TotalTime,
    string MostVisited,
    string AvgVisit,
    string TopByVisits,
    string TopByTime,
    string Visits,
    string Hours,
    string NoVisitedLocationData,
    string NoTimeSpentData,
    string AllLocations,
    string SearchByAddress,
    string NoLocations,
    string NoLocationsMatch,
    string NoVisitedRecorded,
    string ClearSearch,
    string EmptyCta,
    string FilterLabelSearch,
    string AiAutoNameApplied,
    string VisitsLower,
    string Total,
    string Avg,
    string Last,
    string Retry)
{
    /// <summary>Resolve every Locations label through the localizer (web key names + English defaults).</summary>
    public static LocationsStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new LocationsStrings(
            Title: localizer.GetString("Visited Locations", "Visited Locations"),
            Subtitle: localizer.GetString("Places you've been \u2014 ranked by frequency", "Places you've been \u2014 ranked by frequency"),
            NavTitle: localizer.GetString("Locations", "Locations"),
            UniquePlaces: localizer.GetString("Unique Places", "Unique Places"),
            UniqueCities: localizer.GetString("Unique Cities", "Unique Cities"),
            TotalVisits: localizer.GetString("Total Visits", "Total Visits"),
            TotalTime: localizer.GetString("Total Time", "Total Time"),
            MostVisited: localizer.GetString("Most Visited", "Most Visited"),
            AvgVisit: localizer.GetString("Avg Visit", "Avg Visit"),
            TopByVisits: localizer.GetString("Top Locations by Visits", "Top Locations by Visits"),
            TopByTime: localizer.GetString("Top Locations by Time Spent (hours)", "Top Locations by Time Spent (hours)"),
            Visits: localizer.GetString("Visits", "Visits"),
            Hours: localizer.GetString("Hours", "Hours"),
            NoVisitedLocationData: localizer.GetString("No visited location data", "No visited location data"),
            NoTimeSpentData: localizer.GetString("No time-spent data available", "No time-spent data available"),
            AllLocations: localizer.GetString("All Locations", "All Locations"),
            SearchByAddress: localizer.GetString("Search by address\u2026", "Search by address\u2026"),
            NoLocations: localizer.GetString("No locations", "No locations"),
            NoLocationsMatch: localizer.GetString("No locations match your search", "No locations match your search"),
            NoVisitedRecorded: localizer.GetString("No visited locations recorded yet", "No visited locations recorded yet"),
            ClearSearch: localizer.GetString("Clear search", "Clear search"),
            EmptyCta: localizer.GetString("locations.empty.cta", "View drives"),
            FilterLabelSearch: localizer.GetString("locations.filterLabel.search", "Search"),
            AiAutoNameApplied: localizer.GetString("locations.aiAutoName.applied", "Suggested name ready to save:"),
            VisitsLower: localizer.GetString("visits", "visits"),
            Total: localizer.GetString("total", "total"),
            Avg: localizer.GetString("avg", "avg"),
            Last: localizer.GetString("Last", "Last"),
            Retry: localizer.GetString("locations.retry", "Retry"));
    }
}
