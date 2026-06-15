using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Diagnostics;

/// <summary>
/// One detected anomaly from <c>GET /analytics/anomalies</c> (web <c>AnomalyEntry</c> in
/// web/src/api/hooks/useAnomalies.ts, hook <c>useAnomalies</c>). The numeric <see cref="Value"/> /
/// <see cref="Baseline"/> / <see cref="ZScore"/> are kept exactly as the API delivers them — these are
/// per-signal scalar readings with no fixed physical unit, so no SI conversion applies; the display
/// boundary only rounds them. Parsing is null-tolerant so a partial or schema-drifted row never throws
/// (web parity: the page tolerates undefined fields). Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record AnomalyEntryModel(
    string Signal,
    string Type,
    string Severity,
    double Value,
    double Baseline,
    double ZScore,
    string DetectedAt,
    string Message)
{
    /// <summary>Project a single anomaly JSON object into a tolerant entry (accepts snake_case + camelCase aliases).</summary>
    public static AnomalyEntryModel FromJson(JsonElement element)
    {
        return new AnomalyEntryModel(
            Signal: AnomalyJson.String(element, "signal") ?? string.Empty,
            Type: AnomalyJson.String(element, "type") ?? string.Empty,
            Severity: AnomalyJson.String(element, "severity") ?? string.Empty,
            Value: AnomalyJson.Double(element, "value") ?? 0,
            Baseline: AnomalyJson.Double(element, "baseline") ?? 0,
            ZScore: AnomalyJson.Double(element, "z_score") ?? AnomalyJson.Double(element, "zScore") ?? 0,
            DetectedAt: AnomalyJson.String(element, "detected_at") ?? AnomalyJson.String(element, "detectedAt") ?? string.Empty,
            Message: AnomalyJson.String(element, "message") ?? string.Empty);
    }
}

/// <summary>One system-health category/status pair from the <c>health_summary</c> map (web <c>healthEntries</c>).</summary>
public sealed record AnomalyHealthEntry(string Category, string Status);

/// <summary>
/// The parsed result of one <c>GET /analytics/anomalies</c> read — the native analogue of the web
/// <c>AnomalyData</c> the page hands to its render body. <see cref="HasData"/> mirrors the web's
/// "any telemetry yet" gate: it drives the success/empty branch when the whole payload is empty.
/// </summary>
public sealed record AnomalySnapshot(
    IReadOnlyList<AnomalyEntryModel> Anomalies,
    IReadOnlyList<AnomalyHealthEntry> Health,
    int SignalsMonitored,
    int AnomaliesLast7d,
    int AnomaliesLast24h)
{
    /// <summary>The empty snapshot (no telemetry) — the page-level empty surface.</summary>
    public static AnomalySnapshot Empty { get; } =
        new(Array.Empty<AnomalyEntryModel>(), Array.Empty<AnomalyHealthEntry>(), 0, 0, 0);

    /// <summary>True when the payload carries any signal coverage, anomaly, health row or non-zero count.</summary>
    public bool HasData =>
        SignalsMonitored > 0
        || Anomalies.Count > 0
        || Health.Count > 0
        || AnomaliesLast7d > 0
        || AnomaliesLast24h > 0;

    /// <summary>Project a <c>GET /analytics/anomalies</c> JSON object into a tolerant snapshot.</summary>
    public static AnomalySnapshot FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new AnomalySnapshot(
            Anomalies: ParseAnomalies(root),
            Health: ParseHealth(root),
            SignalsMonitored: (int)(AnomalyJson.Long(root, "signals_monitored") ?? AnomalyJson.Long(root, "signalsMonitored") ?? 0),
            AnomaliesLast7d: (int)(AnomalyJson.Long(root, "anomalies_last_7d") ?? AnomalyJson.Long(root, "anomaliesLast7d") ?? 0),
            AnomaliesLast24h: (int)(AnomalyJson.Long(root, "anomalies_last_24h") ?? AnomalyJson.Long(root, "anomaliesLast24h") ?? 0));
    }

    /// <summary>Parse the <c>anomalies</c> array (absent / non-array → empty).</summary>
    public static IReadOnlyList<AnomalyEntryModel> ParseAnomalies(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("anomalies", out var array)
            || array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AnomalyEntryModel>();
        }

        var entries = new List<AnomalyEntryModel>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                entries.Add(AnomalyEntryModel.FromJson(item));
            }
        }

        return entries;
    }

    /// <summary>Parse the <c>health_summary</c> object map into an ordered category/status list.</summary>
    public static IReadOnlyList<AnomalyHealthEntry> ParseHealth(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || (!root.TryGetProperty("health_summary", out var map) && !root.TryGetProperty("healthSummary", out map))
            || map.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<AnomalyHealthEntry>();
        }

        var entries = new List<AnomalyHealthEntry>();
        foreach (var property in map.EnumerateObject())
        {
            string status = property.Value.ValueKind == JsonValueKind.String
                ? property.Value.GetString() ?? string.Empty
                : property.Value.ToString();
            entries.Add(new AnomalyHealthEntry(property.Name, status));
        }

        return entries;
    }
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IAnomaliesFeed
{
    /// <summary>Fetch the anomaly rollup for the active vehicle + lookback window.</summary>
    Task<AnomalySnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyAnomaliesFeed : IAnomaliesFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAnomaliesFeed Instance { get; } = new();

    private EmptyAnomaliesFeed()
    {
    }

    /// <inheritdoc />
    public Task<AnomalySnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(AnomalySnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum AnomalyDashboardState
{
    /// <summary>The anomaly query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no telemetry at all — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The anomaly query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The rollup resolved — the full page content (stat cards + health + timeline + frequency).</summary>
    Success,
}

/// <summary>One headline summary tile (web <c>StatCard</c>). The value is pre-formatted at the display boundary.</summary>
public sealed record AnomalyStatDisplay(string Label, double Value, string ValueText, string Glyph, string AutomationName);

/// <summary>One system-health category card (web Health Summary grid cell). Status is pre-mapped to a semantic kind.</summary>
public sealed record AnomalyHealthCardDisplay(string Category, string Status, StatusKind StatusKind, string Glyph, string AutomationName);

/// <summary>One anomaly-timeline row (web Anomaly Timeline list item). Every value is pre-formatted.</summary>
public sealed record AnomalyTimelineRowDisplay(
    string Signal,
    string TypeLabel,
    string Severity,
    StatusKind SeverityStatus,
    bool ShowZScore,
    string ZScoreText,
    string Message,
    string ValueText,
    string BaselineText,
    DateTimeOffset? DetectedAt,
    string DetectedAtText,
    string AutomationName);

/// <summary>A computed frequency datum (web client-side <c>signalFrequency</c> map output).</summary>
public sealed record AnomalyFrequencyRow(string Signal, int Count);

/// <summary>The anomaly-frequency bar-chart projection (web <c>GlassPanel</c> + recharts <c>BarChart</c>).</summary>
public sealed record AnomalyFrequencyDisplay(
    bool HasData,
    string Title,
    string SeriesName,
    string AriaLabel,
    string EmptyMessage,
    IReadOnlyList<AnomalyFrequencyRow> Rows,
    IReadOnlyList<ChartSeries> Series);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>AnomalyDashboardPage</c> computes, resolved once so the view is a thin renderer. Pure data — no
/// WinUI types — so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record AnomalyDashboardDisplay(
    AnomalyDashboardState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    IReadOnlyList<AnomalyStatDisplay> SummaryStats,
    string HealthTitle,
    IReadOnlyList<AnomalyHealthCardDisplay> HealthCards,
    string HealthEmptyMessage,
    string TimelineTitle,
    IReadOnlyList<AnomalyTimelineRowDisplay> TimelineRows,
    string TimelineEmptyMessage,
    string FrequencyTitle,
    AnomalyFrequencyDisplay Frequency,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page lifecycle
/// (the query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model fills this in; tests
/// construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record AnomalyDashboardModel(AnomalySnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the query is in flight with no data yet.</summary>
    public static AnomalyDashboardModel Initial { get; } = new(AnomalySnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>AnomalyDashboardPage</c>
/// feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test asserts all of them in one pass.
/// </summary>
public sealed record AnomalyStrings
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string Monitored { get; init; }
    public required string Last7d { get; init; }
    public required string Last24h { get; init; }
    public required string Categories { get; init; }
    public required string HealthSummary { get; init; }
    public required string Timeline { get; init; }
    public required string Frequency { get; init; }
    public required string Count { get; init; }
    public required string Value { get; init; }
    public required string Baseline { get; init; }
    public required string NoHealth { get; init; }
    public required string NoAnomalies { get; init; }
    public required string NoFrequency { get; init; }
    public required string ErrorTitle { get; init; }
    public required string Retry { get; init; }
    public required string NoData { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static AnomalyStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new AnomalyStrings
        {
            Title = localizer.GetString("anomaly.title", "Anomaly Detection"),
            Subtitle = localizer.GetString("anomaly.subtitle", "Automatic health monitoring and signal anomaly detection"),
            Monitored = localizer.GetString("anomaly.monitored", "Signals Monitored"),
            Last7d = localizer.GetString("anomaly.last7d", "Anomalies (7d)"),
            Last24h = localizer.GetString("anomaly.last24h", "Anomalies (24h)"),
            Categories = localizer.GetString("anomaly.categories", "Health Categories"),
            HealthSummary = localizer.GetString("anomaly.healthSummary", "System Health"),
            Timeline = localizer.GetString("anomaly.timeline", "Anomaly Timeline"),
            Frequency = localizer.GetString("anomaly.frequency", "Most Frequent Anomalies"),
            Count = localizer.GetString("anomaly.count", "Anomalies"),
            Value = localizer.GetString("anomaly.value", "Value"),
            Baseline = localizer.GetString("anomaly.baseline", "Baseline"),
            NoHealth = localizer.GetString("anomaly.noHealth", "Health data will appear once telemetry is available."),
            NoAnomalies = localizer.GetString("anomaly.noAnomalies", "No anomalies detected — all systems normal."),
            NoFrequency = localizer.GetString("anomaly.noFrequency", "Anomaly frequency data will appear after detection runs."),
            ErrorTitle = localizer.GetString("common.error", "Unable to load data"),
            Retry = localizer.GetString("common.retry", "Retry"),
            NoData = localizer.GetString("common.noData", "No data available"),
        };
    }
}

/// <summary>
/// Pure projection from an <see cref="AnomalyDashboardModel"/> to its <see cref="AnomalyDashboardDisplay"/> —
/// the native port of the render logic in web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx and its
/// <c>severityVariant</c> / <c>typeLabel</c> / <c>signalFrequency</c> helpers. The branch precedence mirrors the
/// web data lifecycle (loading → error → empty → success); the rollup feeds the four summary stat tiles, the
/// system-health cards, the anomaly timeline and the most-frequent-anomalies bar chart. Every label resolves
/// through the i18n facade using the same keys the web page uses.
/// </summary>
public static class AnomalyDashboardProjection
{
    /// <summary>The number of frequency bars the chart keeps (web <c>.slice(0, 10)</c>).</summary>
    public const int FrequencyLimit = 10;

    private const int ValuePrecision = 2;
    private const int ZScorePrecision = 1;
    private const string SigmaSuffix = "\u03C3"; // σ

    // Fluent (Segoe MDL2 Assets) glyphs that stand in for the web lucide icons.
    private const string ActivityGlyph = "\uE9D2";    // Activity (signals monitored / charging)
    private const string AlertGlyph = "\uE7BA";       // AlertTriangle (anomalies 7d / timeline header)
    private const string ShieldGlyph = "\uEA18";      // Shield (anomalies 24h / unknown category)
    private const string TemperatureGlyph = "\uE9CA"; // Thermometer (categories / hvac)
    private const string BatteryGlyph = "\uE83E";     // Battery
    private const string CarGlyph = "\uE804";         // Car (tires)
    private const string MotorGlyph = "\uE945";       // Zap (motors)

    // Web typeLabel(...) maps the detector type to these exact English labels (web hardcodes them, not via t()).
    private const string TypeStatistical = "Statistical";
    private const string TypeRange = "Range";
    private const string TypeTrend = "Trend";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed anomaly rollup plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (only its locale affects number grouping here).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static AnomalyDashboardDisplay Project(AnomalyDashboardModel model, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = AnomalyStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        string? locale = units.Locale;

        AnomalyDashboardState state =
            model.Loading && !snapshot.HasData ? AnomalyDashboardState.Loading
            : model.ErrorDetail is not null ? AnomalyDashboardState.Error
            : !snapshot.HasData ? AnomalyDashboardState.Empty
            : AnomalyDashboardState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        bool success = state == AnomalyDashboardState.Success;

        return new AnomalyDashboardDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == AnomalyDashboardState.Loading,
            ShowError: state == AnomalyDashboardState.Error,
            ShowEmpty: state == AnomalyDashboardState.Empty,
            ShowContent: success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyMessage: s.NoData,
            SummaryStats: success ? BuildSummary(snapshot, s, locale) : Array.Empty<AnomalyStatDisplay>(),
            HealthTitle: s.HealthSummary,
            HealthCards: success ? BuildHealthCards(snapshot.Health) : Array.Empty<AnomalyHealthCardDisplay>(),
            HealthEmptyMessage: s.NoHealth,
            TimelineTitle: s.Timeline,
            TimelineRows: success ? BuildTimeline(snapshot.Anomalies, s, locale) : Array.Empty<AnomalyTimelineRowDisplay>(),
            TimelineEmptyMessage: s.NoAnomalies,
            FrequencyTitle: s.Frequency,
            Frequency: BuildFrequency(snapshot.Anomalies, s),
            AutomationName: s.Title);
    }

    /// <summary>Map an anomaly/health severity to a semantic status (web <c>severityVariant</c>).</summary>
    public static StatusKind SeverityStatus(string severity) => severity switch
    {
        "critical" => StatusKind.Danger,
        "warning" => StatusKind.Warning,
        _ => StatusKind.Success,
    };

    /// <summary>Map a detector type to its display label (web <c>typeLabel</c>).</summary>
    public static string TypeLabel(string type) => type switch
    {
        "z_score" => TypeStatistical,
        "range" => TypeRange,
        "trend" => TypeTrend,
        _ => type,
    };

    /// <summary>Aggregate anomalies into the top-N most-frequent signals (web <c>signalFrequency</c>).</summary>
    public static IReadOnlyList<AnomalyFrequencyRow> Frequency(IReadOnlyList<AnomalyEntryModel> anomalies)
    {
        ArgumentNullException.ThrowIfNull(anomalies);
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var anomaly in anomalies)
        {
            if (!counts.TryGetValue(anomaly.Signal, out int current))
            {
                order.Add(anomaly.Signal);
            }

            counts[anomaly.Signal] = current + 1;
        }

        return order
            .Select(signal => new AnomalyFrequencyRow(signal, counts[signal]))
            .OrderByDescending(row => row.Count)
            .Take(FrequencyLimit)
            .ToArray();
    }

    private static AnomalyStatDisplay[] BuildSummary(AnomalySnapshot snapshot, AnomalyStrings s, string? locale)
    {
        return new[]
        {
            Stat(s.Monitored, snapshot.SignalsMonitored, ActivityGlyph, locale),
            Stat(s.Last7d, snapshot.AnomaliesLast7d, AlertGlyph, locale),
            Stat(s.Last24h, snapshot.AnomaliesLast24h, ShieldGlyph, locale),
            Stat(s.Categories, snapshot.Health.Count, TemperatureGlyph, locale),
        };
    }

    private static AnomalyStatDisplay Stat(string label, int value, string glyph, string? locale)
    {
        string text = NumberFormatting.Format(value, locale, 0);
        return new AnomalyStatDisplay(label, value, text, glyph, $"{label}: {text}");
    }

    private static AnomalyHealthCardDisplay[] BuildHealthCards(IReadOnlyList<AnomalyHealthEntry> health)
    {
        var cards = new List<AnomalyHealthCardDisplay>(health.Count);
        foreach (var entry in health)
        {
            var status = SeverityStatus(entry.Status);
            cards.Add(new AnomalyHealthCardDisplay(
                Category: entry.Category,
                Status: entry.Status,
                StatusKind: status,
                Glyph: HealthGlyph(entry.Category),
                AutomationName: $"{entry.Category}: {entry.Status}"));
        }

        return cards.ToArray();
    }

    private static AnomalyTimelineRowDisplay[] BuildTimeline(
        IReadOnlyList<AnomalyEntryModel> anomalies,
        AnomalyStrings s,
        string? locale)
    {
        var rows = new List<AnomalyTimelineRowDisplay>(anomalies.Count);
        foreach (var anomaly in anomalies)
        {
            string valueText = $"{s.Value}: {NumberFormatting.Format(anomaly.Value, locale, ValuePrecision)}";
            string baselineText = $"{s.Baseline}: {NumberFormatting.Format(anomaly.Baseline, locale, ValuePrecision)}";
            bool showZ = anomaly.ZScore > 0;
            string zText = showZ ? NumberFormatting.Format(anomaly.ZScore, locale, ZScorePrecision) + SigmaSuffix : string.Empty;
            DateTimeOffset? detectedAt = ParseTimestamp(anomaly.DetectedAt);

            rows.Add(new AnomalyTimelineRowDisplay(
                Signal: anomaly.Signal,
                TypeLabel: TypeLabel(anomaly.Type),
                Severity: anomaly.Severity,
                SeverityStatus: SeverityStatus(anomaly.Severity),
                ShowZScore: showZ,
                ZScoreText: zText,
                Message: anomaly.Message,
                ValueText: valueText,
                BaselineText: baselineText,
                DetectedAt: detectedAt,
                DetectedAtText: anomaly.DetectedAt,
                AutomationName: $"{anomaly.Severity} {anomaly.Signal}: {anomaly.Message}"));
        }

        return rows.ToArray();
    }

    private static AnomalyFrequencyDisplay BuildFrequency(IReadOnlyList<AnomalyEntryModel> anomalies, AnomalyStrings s)
    {
        var rows = Frequency(anomalies);
        var points = new List<ChartPoint>(rows.Count);
        for (int i = 0; i < rows.Count; i++)
        {
            points.Add(new ChartPoint(i, rows[i].Count, rows[i].Signal));
        }

        var series = rows.Count > 0
            ? new[] { new ChartSeries(s.Count, points) { Kind = ChartSeriesKind.Bar, ColorIndex = 3 } }
            : Array.Empty<ChartSeries>();

        return new AnomalyFrequencyDisplay(
            HasData: rows.Count > 0,
            Title: s.Frequency,
            SeriesName: s.Count,
            AriaLabel: s.Frequency,
            EmptyMessage: s.NoFrequency,
            Rows: rows,
            Series: series);
    }

    private static string HealthGlyph(string category) => category switch
    {
        "battery" => BatteryGlyph,
        "tires" => CarGlyph,
        "motors" => MotorGlyph,
        "hvac" => TemperatureGlyph,
        "charging" => ActivityGlyph,
        _ => ShieldGlyph,
    };

    private static DateTimeOffset? ParseTimestamp(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>Tolerant <see cref="JsonElement"/> field readers shared by the anomaly parsers (snake_case + numeric-string safe).</summary>
internal static class AnomalyJson
{
    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Anomaly-Dashboard page — the native mirror of the web
/// page at web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx (route <c>/analytics/anomalies</c>, nav
/// name <c>AnomalyDashboard</c>). The page reads the same anomaly rollup the web <c>useAnomalies</c> hook reads
/// (generated operation <c>get_api_v1_analytics_anomalies</c>).
/// </summary>
public static class AnomalyDashboardRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "AnomalyDashboard";

    /// <summary>The deep-link route slug (web route <c>/analytics/anomalies</c>).</summary>
    public const string Route = "analytics/anomalies";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AnomalyDashboardPage";

    /// <summary>The generated operation id for the anomaly read (web <c>useAnomalies</c>).</summary>
    public const string AnomaliesOperation = Operations.Analytics.Anomalies;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>Shield</c>).</summary>
    public const string EmptyGlyph = "\uEA18";

    /// <summary>The localized page title (web <c>t('anomaly.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("anomaly.title", "Anomaly Detection");
    }

    /// <summary>The localized page subtitle (web <c>t('anomaly.subtitle')</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("anomaly.subtitle", "Automatic health monitoring and signal anomaly detection");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Anomaly-Dashboard surface — records only the <c>view.opened</c> event with
/// the surface slug, never any signal, vehicle or anomaly data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class AnomalyDashboardDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public AnomalyDashboardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AnomalyDashboardRegistration.Slug}");
    }
}
