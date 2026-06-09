using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="VampireDrainViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>VampireDrainWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/VampireDrainWidget.tsx). The widget composes two queries (the
/// phantom-drain <c>useVampireDrainStats</c> summary and the <c>useVampireDrainEvents</c> list, both
/// reading the deprecated <c>/vampire-drain</c> routes) so every branch is derived from the combined
/// freshness of both, mirroring the web's <c>statsLoading || eventsLoading</c> /
/// <c>statsError || eventsError</c> / <c>statsStale || eventsStale</c> composition. Faithful to the web
/// component — which surfaces a fetch failure through the freshness chip rather than replacing the body —
/// the body always shows the data or the friendly empty state; the error branch is the empty body plus the
/// freshness error chip and the refresh retry affordance. Every branch maps onto a visible surface; none is
/// ever hidden.
/// </summary>
public enum VampireDrainState
{
    /// <summary>Initial fetch with neither source resolved — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh data from the network (or non-stale cache) carrying stats and/or events.</summary>
    Loaded,

    /// <summary>Both sources resolved with no stats and no events — render the friendly empty state.</summary>
    Empty,

    /// <summary>A source failed and no data remains — render the empty body plus an error chip.</summary>
    Error,

    /// <summary>Cached data older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached data remains — render content plus an offline/error chip.</summary>
    Offline,
}

/// <summary>Tolerant JSON readers shared by the vampire-drain parse adapters.</summary>
internal static class VampireDrainJson
{
    /// <summary>Read a string property, or <see langword="null"/> when absent / not a string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Read a long property (number or numeric string), or <see langword="null"/> when absent.</summary>
    public static long? GetLong(JsonElement obj, string name)
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

    /// <summary>Read a finite double property (number or numeric string), or <see langword="null"/>.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && double.IsFinite(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) => n,
            _ => null,
        };
    }

    /// <summary>Read a strict boolean property, or <see langword="null"/> when absent / not a boolean.</summary>
    public static bool? GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    /// <summary>Parse an ISO-8601 timestamp as UTC, or <see langword="null"/> when absent / unparseable.</summary>
    public static DateTimeOffset? ParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The phantom-drain summary from <c>GET /vampire-drain/stats?vehicle_id=</c> (web <c>VampireDrainStats</c>
/// in web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant
/// so a partial body never throws. The widget reads <see cref="AvgDrainRate"/> (×24 → %/day),
/// <see cref="EventCount"/> and <see cref="TotalHours"/>; the remaining fields round-trip the full
/// contract.
/// </summary>
public sealed record VampireDrainStats(
    double AvgDrainRate,
    double MaxDrainRate,
    double TotalRangeLost,
    double TotalHours,
    long EventCount,
    double AvgSentryDrain,
    double AvgNosentryDrain)
{
    /// <summary>Project a stats JSON object into a <see cref="VampireDrainStats"/>, or null when not an object.</summary>
    public static VampireDrainStats? FromResponse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new VampireDrainStats(
            AvgDrainRate: VampireDrainJson.GetDouble(element, "avg_drain_rate") ?? 0,
            MaxDrainRate: VampireDrainJson.GetDouble(element, "max_drain_rate") ?? 0,
            TotalRangeLost: VampireDrainJson.GetDouble(element, "total_range_lost") ?? 0,
            TotalHours: VampireDrainJson.GetDouble(element, "total_hours") ?? 0,
            EventCount: VampireDrainJson.GetLong(element, "event_count") ?? 0,
            AvgSentryDrain: VampireDrainJson.GetDouble(element, "avg_sentry_drain") ?? 0,
            AvgNosentryDrain: VampireDrainJson.GetDouble(element, "avg_nosentry_drain") ?? 0);
    }
}

/// <summary>
/// One phantom-drain event from <c>GET /vampire-drain?vehicle_id=&amp;limit=</c> (web
/// <c>VampireDrainEvent</c> in web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant so a partial row never throws. The widget reads <see cref="StartDate"/>,
/// <see cref="BatteryLost"/>, <see cref="DurationHours"/>, <see cref="DrainRatePctPerHour"/> (×24 → %/day)
/// and <see cref="SentryMode"/>; <see cref="Id"/> / <see cref="VehicleId"/> form the stable row key.
/// </summary>
public sealed record VampireDrainEvent(
    long? Id,
    long VehicleId,
    string? StartDate,
    double? BatteryLost,
    double? DurationHours,
    double? DrainRatePctPerHour,
    bool SentryMode)
{
    /// <summary>The event-start instant (web <c>ev.start_date</c>), or null when absent / unparseable.</summary>
    public DateTimeOffset? Timestamp => VampireDrainJson.ParseTimestamp(StartDate);

    /// <summary>The stable row key (web <c>ev.id</c>, falling back to vehicle + start date).</summary>
    public string Key => Id?.ToString(CultureInfo.InvariantCulture)
        ?? string.Create(CultureInfo.InvariantCulture, $"{VehicleId}-{StartDate}");

    /// <summary>Parse a <c>GET /vampire-drain</c> JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<VampireDrainEvent> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<VampireDrainEvent>();
        }

        var list = new List<VampireDrainEvent>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single event JSON object into a <see cref="VampireDrainEvent"/>.</summary>
    public static VampireDrainEvent FromJson(JsonElement obj) => new(
        Id: VampireDrainJson.GetLong(obj, "id"),
        VehicleId: VampireDrainJson.GetLong(obj, "vehicle_id") ?? 0,
        StartDate: VampireDrainJson.GetString(obj, "start_date"),
        BatteryLost: VampireDrainJson.GetDouble(obj, "battery_lost"),
        DurationHours: VampireDrainJson.GetDouble(obj, "duration_hours"),
        DrainRatePctPerHour: VampireDrainJson.GetDouble(obj, "drain_rate_pct_per_hour"),
        SentryMode: VampireDrainJson.GetBool(obj, "sentry_mode") ?? false);
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact</c> / <c>isWide</c> logic in
/// web/src/features/dashboard/widgets/VampireDrainWidget.tsx.
/// </summary>
public readonly record struct VampireDrainSize(int Cols, int Rows)
{
    /// <summary>Maximum event rows rendered (web <c>WidgetEventFeed maxItems={5}</c>).</summary>
    public const int MaxFeedItems = 5;

    /// <summary>The registry default footprint (2×4).</summary>
    public static VampireDrainSize Default => new(2, 4);

    /// <summary>True at one or fewer columns (web <c>isCompact</c>): show the single big-number stat.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide</c>): show the daily-drain sparkline.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One projected, display-ready drain-event row consumed by the WinUI view — the native analogue of a web
/// <c>EventFeedItem</c> built in the <c>eventItems</c> <c>useMemo</c>. Holds the resolved severity (drives
/// the battery glyph tint), the localized title and subtitle, the relative-time string, and a Narrator
/// automation name. Pure data — no WinUI types.
/// </summary>
public sealed record VampireDrainEventRow(
    string Key,
    StatusKind Severity,
    string Title,
    string Subtitle,
    string RelativeTime,
    DateTimeOffset? Timestamp,
    string AutomationName);

/// <summary>
/// The projected, render-ready display model for the surface — the native analogue of the web component's
/// derived values (<c>avgDrainPctPerDay</c>, <c>eventItems</c>, <c>sparklineData</c>, <c>hasData</c>). The
/// view is a thin renderer over this; it performs no drain math.
/// </summary>
public sealed record VampireDrainDisplay(
    bool HasData,
    bool IsCompact,
    bool IsWide,
    string CompactValueText,
    string CompactPerDayLabel,
    StatusKind CompactSeverity,
    string CompactAutomationName,
    string AvgDrainLabel,
    string AvgDrainValueText,
    string? AvgDrainSublabel,
    StatusKind AvgDrainSeverity,
    string AvgDrainAutomationName,
    bool ShowSparkline,
    IReadOnlyList<double> SparklineData,
    StatusKind SparklineSeverity,
    string TrendLabel,
    IReadOnlyList<VampireDrainEventRow> Events,
    string NoEventsMessage,
    string EmptyMessage)
{
    /// <summary>True when at least one drain event row is available for the feed.</summary>
    public bool HasEvents => Events.Count > 0;
}

/// <summary>
/// Pure projection from raw stats + events to the display model — the native port of the
/// <c>avgDrainPctPerDay</c> / <c>eventItems</c> / <c>sparklineData</c> derivations in
/// web/src/features/dashboard/widgets/VampireDrainWidget.tsx plus <c>WidgetEventFeed</c>'s newest-first
/// sort and <c>maxItems</c> slice. <paramref name="now"/> is injected so the relative-time tiers are
/// unit-tested deterministically. Every label resolves through the i18n facade.
/// </summary>
public static class VampireDrainProjection
{
    private const string MiddotSeparator = " \u00B7 ";

    // Web drainColor thresholds (web/src/features/dashboard/widgets/VampireDrainWidget.tsx#drainColor):
    // < 1 %/day green, < 3 %/day amber, otherwise red — mapped onto the semantic status palette.
    private const double WarnDrainPerDay = 1d;
    private const double CriticalDrainPerDay = 3d;

    /// <summary>Project the stats + events into the render-ready <see cref="VampireDrainDisplay"/>.</summary>
    public static VampireDrainDisplay Project(
        VampireDrainStats? stats,
        IReadOnlyList<VampireDrainEvent> events,
        VampireDrainSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(localizer);

        double avgDrainPerDay = AvgDrainPerDay(stats);
        var avgSeverity = Severity(avgDrainPerDay);

        string perDayLabel = localizer.GetString("widget.vampireDrain.perDay", "/day");
        string avgDrainLabel = localizer.GetString("widget.vampireDrain.avgDrain", "Avg Drain");

        string compactValue = string.Create(CultureInfo.CurrentCulture, $"{ScalarFormatters.FormatNumber(avgDrainPerDay, 1)}%");
        string avgDrainValue = string.Create(CultureInfo.CurrentCulture, $"{ScalarFormatters.FormatNumber(avgDrainPerDay, 1)}%/day");
        string? sublabel = stats is null ? null : EventCountLabel(stats, localizer);

        // Web parity: sparklineData = events.slice().reverse().map(e => (e.drain_rate_pct_per_hour ?? 0) * 24).
        var sparkline = new List<double>(events.Count);
        for (int i = events.Count - 1; i >= 0; i--)
        {
            sparkline.Add(DrainPerDay(events[i]));
        }

        bool showSparkline = size.IsWide && sparkline.Count > 1;

        var rows = ProjectEvents(events, localizer, now);

        return new VampireDrainDisplay(
            HasData: stats is not null || events.Count > 0,
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            CompactValueText: compactValue,
            CompactPerDayLabel: perDayLabel,
            CompactSeverity: avgSeverity,
            CompactAutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}{2}", avgDrainLabel, compactValue, perDayLabel),
            AvgDrainLabel: avgDrainLabel,
            AvgDrainValueText: avgDrainValue,
            AvgDrainSublabel: sublabel,
            AvgDrainSeverity: avgSeverity,
            AvgDrainAutomationName: AutomationName(avgDrainLabel, avgDrainValue, sublabel),
            ShowSparkline: showSparkline,
            SparklineData: sparkline,
            SparklineSeverity: avgSeverity,
            TrendLabel: localizer.GetString("widget.vampireDrain.trend", "Daily drain rate (last 30)"),
            Events: rows,
            NoEventsMessage: localizer.GetString("widget.vampireDrain.noEvents", "No recent drain events"),
            EmptyMessage: localizer.GetString("widget.vampireDrain.noData", "No vampire drain data"));
    }

    /// <summary>Project + sort (newest first) + cap the events to the feed's row budget.</summary>
    public static IReadOnlyList<VampireDrainEventRow> ProjectEvents(
        IReadOnlyList<VampireDrainEvent> events,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(localizer);

        var ordered = events
            .OrderByDescending(e => e.Timestamp ?? DateTimeOffset.MinValue)
            .Take(VampireDrainSize.MaxFeedItems);

        var rows = new List<VampireDrainEventRow>(Math.Min(events.Count, VampireDrainSize.MaxFeedItems));
        foreach (var ev in ordered)
        {
            double drainDay = DrainPerDay(ev);
            string title = EventTitle(ev, localizer);
            string subtitle = EventSubtitle(drainDay, localizer);
            string relative = DateTimeFormatting.Format(ev.Timestamp, DateTimeVariant.Relative, now);

            rows.Add(new VampireDrainEventRow(
                Key: ev.Key,
                Severity: Severity(drainDay),
                Title: title,
                Subtitle: subtitle,
                RelativeTime: relative,
                Timestamp: ev.Timestamp,
                AutomationName: AutomationName(title, subtitle, relative)));
        }

        return rows;
    }

    /// <summary>Average daily phantom-drain percentage (web <c>(avg_drain_rate ?? 0) * 24</c>).</summary>
    public static double AvgDrainPerDay(VampireDrainStats? stats) => (stats?.AvgDrainRate ?? 0) * 24;

    /// <summary>A single event's daily phantom-drain percentage (web <c>(drain_rate_pct_per_hour ?? 0) * 24</c>).</summary>
    public static double DrainPerDay(VampireDrainEvent ev)
    {
        ArgumentNullException.ThrowIfNull(ev);
        return (ev.DrainRatePctPerHour ?? 0) * 24;
    }

    /// <summary>The semantic severity for a daily drain rate (web <c>drainColor</c> thresholds).</summary>
    public static StatusKind Severity(double drainPerDay) =>
        drainPerDay >= CriticalDrainPerDay ? StatusKind.Danger
        : drainPerDay >= WarnDrainPerDay ? StatusKind.Warning
        : StatusKind.Success;

    /// <summary>
    /// The event title (web <c>`${battery_lost}% · ${duration}${sentry ? ` · Sentry` : ''}`</c>), routed
    /// through the i18n facade for the duration unit and the Sentry suffix.
    /// </summary>
    public static string EventTitle(VampireDrainEvent ev, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(ev);
        ArgumentNullException.ThrowIfNull(localizer);

        string battery = string.Create(CultureInfo.CurrentCulture, $"{ScalarFormatters.FormatNumber(ev.BatteryLost ?? 0, 1)}%");
        string duration = FormatDuration(ev.DurationHours ?? 0, localizer);
        string title = string.Concat(battery, MiddotSeparator, duration);

        if (ev.SentryMode)
        {
            title = string.Concat(title, MiddotSeparator, localizer.GetString("widget.vampireDrain.sentry", "Sentry"));
        }

        return title;
    }

    /// <summary>The event subtitle (web <c>`${drainDay}%/day`</c>), localizing the "/day" suffix.</summary>
    public static string EventSubtitle(double drainDay, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity: `${fmtNumber(drainDay, 1)}%/${t('perDay').replace('/', '')}` — strip the leading
        // slash from the localized "/day" token and re-add it after the "%".
        string perDayWord = localizer.GetString("widget.vampireDrain.perDay", "/day").Replace("/", string.Empty, StringComparison.Ordinal);
        return string.Create(CultureInfo.CurrentCulture, $"{ScalarFormatters.FormatNumber(drainDay, 1)}%/{perDayWord}");
    }

    /// <summary>
    /// Duration label (web <c>formatDuration</c>): minutes below an hour (<c>Xm</c>), otherwise hours
    /// (<c>X.Xh</c>), with the unit suffix resolved through the i18n facade.
    /// </summary>
    public static string FormatDuration(double hours, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (hours < 1)
        {
            string minutes = ScalarFormatters.FormatNumber(hours * 60, 0);
            return string.Concat(minutes, localizer.GetString("widget.vampireDrain.min", "m"));
        }

        string hoursText = ScalarFormatters.FormatNumber(hours, 1);
        return string.Concat(hoursText, localizer.GetString("widget.vampireDrain.hr", "h"));
    }

    private static string EventCountLabel(VampireDrainStats stats, ILocalizer localizer)
    {
        string template = localizer.GetString("widget.vampireDrain.eventCount", "{{count}} events \u00B7 {{hours}}h total");
        string count = stats.EventCount.ToString(CultureInfo.CurrentCulture);
        string hours = ScalarFormatters.FormatNumber(stats.TotalHours, 0);

        // Accept the catalog's {{token}} form and the indexed {0}/{1} fallback so production and headless
        // tests both resolve (the established widget interpolation convention).
        return template
            .Replace("{{count}}", count, StringComparison.Ordinal)
            .Replace("{count}", count, StringComparison.Ordinal)
            .Replace("{0}", count, StringComparison.Ordinal)
            .Replace("{{hours}}", hours, StringComparison.Ordinal)
            .Replace("{hours}", hours, StringComparison.Ordinal)
            .Replace("{1}", hours, StringComparison.Ordinal);
    }

    private static string AutomationName(string label, string value, string? detail) =>
        string.IsNullOrEmpty(detail)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, detail);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> stats emissions onto parsed
/// <c>RepositoryResult&lt;VampireDrainStats&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. A non-object payload collapses to
/// the empty result (web <c>stats</c> undefined). Kept pure so the parse-and-preserve contract is
/// unit-tested without a network or cache.
/// </summary>
public static class VampireDrainStatsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<VampireDrainStats> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        VampireDrainStats? Parse() => raw.HasValue ? VampireDrainStats.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<VampireDrainStats>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<VampireDrainStats>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<VampireDrainStats>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<VampireDrainStats>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<VampireDrainStats>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<VampireDrainStats>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<VampireDrainStats>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<VampireDrainStats>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<VampireDrainStats>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<VampireDrainStats>.Empty(raw.FetchedAt),
            _ => RepositoryResult<VampireDrainStats>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> event-list emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;VampireDrainEvent&gt;&gt;</c>, preserving every freshness flag so
/// the view-model can render the full state matrix. A loaded-but-empty array collapses to
/// <see cref="LoadStatus.Empty"/>. Kept pure so the parse-and-preserve contract is unit-tested without a
/// network or cache.
/// </summary>
public static class VampireDrainEventsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<VampireDrainEvent>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<VampireDrainEvent> Parse() =>
            raw.HasValue ? VampireDrainEvent.ParseList(raw.Value) : Array.Empty<VampireDrainEvent>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<VampireDrainEvent>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<VampireDrainEvent>> ToLoadedOrEmpty(
        IReadOnlyList<VampireDrainEvent> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
