using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state of the computed-metric catalog data source — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ComputedMetricEditor</c>
/// (web/src/features/notifications/components/ComputedMetricEditor.tsx) drives off the metric registry
/// query (<c>useAlertMetrics</c> in <c>useNotifications</c>). The web component receives the metric list
/// plus a <c>loading</c> flag as props; the native feature-view owns the read itself so every branch maps
/// onto a visible surface and none is ever hidden.
/// </summary>
public enum ComputedMetricCatalogState
{
    /// <summary>Initial fetch with no cached rows — render the loading chrome.</summary>
    Loading,

    /// <summary>Fresh rows from the network (or a non-stale cache).</summary>
    Loaded,

    /// <summary>The request resolved with no metrics — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached rows exist — render the retry affordance.</summary>
    Error,

    /// <summary>Cached rows older than the freshness window — render rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached rows remain — render rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The lifecycle state of the live-preview line — the native union of the idle / computing / value /
/// error branches the web component renders for the <c>usePreviewComputedMetric</c> mutation. The preview
/// is a fire-on-edit render (not a cache-then-network read), so it has no stale / offline tiers.
/// </summary>
public enum ComputedMetricPreviewState
{
    /// <summary>The editor is not yet "ready" (missing a metric, window, operator or numeric threshold).</summary>
    Idle,

    /// <summary>A preview render is in flight.</summary>
    Loading,

    /// <summary>A value verdict is available.</summary>
    Rendered,

    /// <summary>The preview render failed — render the error text.</summary>
    Error,
}

/// <summary>
/// One row from <c>GET /alerts/metrics</c> (web <c>ComputedMetricSummary</c>): a selectable computed
/// metric, its display <see cref="Label"/>, its <see cref="Unit"/> (drives the preview suffix), and the
/// <see cref="Windows"/> / <see cref="Ops"/> it supports. Null-tolerant parsing.
/// </summary>
public sealed record ComputedMetricSummary(
    string Id,
    string Label,
    string Unit,
    IReadOnlyList<string> Windows,
    IReadOnlyList<string> Ops)
{
    /// <summary>Parse a metrics JSON array into a tolerant list of summaries.</summary>
    public static IReadOnlyList<ComputedMetricSummary> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ComputedMetricSummary>();
        }

        var list = new List<ComputedMetricSummary>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single metric JSON object into a <see cref="ComputedMetricSummary"/>.</summary>
    public static ComputedMetricSummary FromJson(JsonElement obj) => new(
        Id: ComputedMetricJson.ReadString(obj, "id") ?? string.Empty,
        Label: ComputedMetricJson.ReadString(obj, "label") ?? ComputedMetricJson.ReadString(obj, "id") ?? string.Empty,
        Unit: ComputedMetricJson.ReadString(obj, "unit") ?? string.Empty,
        Windows: ComputedMetricJson.ReadStringList(obj, "windows"),
        Ops: ComputedMetricJson.ReadStringList(obj, "ops"));
}

/// <summary>
/// The verdict returned by <c>POST /alerts/test</c> with <c>kind=computed_metric</c> (web
/// <c>ComputedMetricPreview</c>): the metric's current <see cref="Value"/> and whether, at the supplied
/// <see cref="Threshold"/> and operator, it <see cref="WouldTrigger"/>. The echoed rule fields and the
/// optional change tiers are parsed for fidelity even though the inline preview only renders the value
/// and verdict.
/// </summary>
public sealed record ComputedMetricPreview(
    string MetricId,
    string MetricWindow,
    string MetricOp,
    double Threshold,
    double Value,
    bool WouldTrigger,
    double? PreviousValue,
    double? PercentChange)
{
    /// <summary>Project the preview JSON object into a <see cref="ComputedMetricPreview"/>.</summary>
    public static ComputedMetricPreview FromJson(JsonElement obj) => new(
        MetricId: ComputedMetricJson.ReadString(obj, "metric_id") ?? string.Empty,
        MetricWindow: ComputedMetricJson.ReadString(obj, "metric_window") ?? string.Empty,
        MetricOp: ComputedMetricJson.ReadString(obj, "metric_op") ?? string.Empty,
        Threshold: ComputedMetricJson.ReadDouble(obj, "threshold") ?? 0d,
        Value: ComputedMetricJson.ReadDouble(obj, "value") ?? 0d,
        WouldTrigger: ComputedMetricJson.ReadBool(obj, "would_trigger") ?? false,
        PreviousValue: ComputedMetricJson.ReadDouble(obj, "previous_value"),
        PercentChange: ComputedMetricJson.ReadDouble(obj, "percent_change"));
}

/// <summary>
/// The request body for <c>POST /alerts/test</c> in computed-metric preview mode — the native mirror of
/// the payload the web <c>usePreviewComputedMetric</c> mutation posts (<c>{ kind:'computed_metric', … }</c>).
/// Serialized with snake_case property names to match the Go API (never camelCase); the null
/// <see cref="VehicleId"/> is omitted by the shared writer settings.
/// </summary>
public sealed record ComputedMetricPreviewRequest
{
    /// <summary>The rule kind discriminator — always <c>computed_metric</c> for this surface.</summary>
    [JsonPropertyName("kind")] public string Kind { get; init; } = "computed_metric";

    /// <summary>The selected metric id.</summary>
    [JsonPropertyName("metric_id")] public string MetricId { get; init; } = string.Empty;

    /// <summary>The selected aggregation window.</summary>
    [JsonPropertyName("metric_window")] public string MetricWindow { get; init; } = string.Empty;

    /// <summary>The comparison operator.</summary>
    [JsonPropertyName("metric_op")] public string MetricOp { get; init; } = string.Empty;

    /// <summary>The numeric threshold (parsed from the editor's raw threshold string).</summary>
    [JsonPropertyName("metric_threshold")] public double MetricThreshold { get; init; }

    /// <summary>The optional vehicle scope; omitted from the wire body when null.</summary>
    [JsonPropertyName("vehicle_id")] public long? VehicleId { get; init; }

    /// <summary>Build a request from the editor <paramref name="value"/> and its parsed <paramref name="threshold"/>.</summary>
    public static ComputedMetricPreviewRequest From(ComputedMetricEditorValue value, double threshold)
    {
        ArgumentNullException.ThrowIfNull(value);
        return new ComputedMetricPreviewRequest
        {
            MetricId = value.MetricId,
            MetricWindow = value.MetricWindow,
            MetricOp = value.MetricOp,
            MetricThreshold = threshold,
            VehicleId = value.VehicleId,
        };
    }

    /// <summary>
    /// A stable serialization of the inputs that vary the preview verdict — used by the view-model to
    /// skip redundant preview round-trips (web parity: the effect's dependency list).
    /// </summary>
    public string DebounceKey() => string.Create(
        CultureInfo.InvariantCulture,
        $"{MetricId}\u001f{MetricWindow}\u001f{MetricOp}\u001f{MetricThreshold}\u001f{VehicleId}");
}

/// <summary>
/// The editor's working value — the native mirror of the web <c>ComputedMetricEditorValue</c> threaded
/// back to the host through <c>onChange</c>. <see cref="MetricThreshold"/> is kept as the raw input string
/// (web parity) so the field round-trips the user's exact text; the numeric parse happens only at the
/// preview boundary.
/// </summary>
public sealed record ComputedMetricEditorValue(
    string MetricId,
    string MetricWindow,
    string MetricOp,
    string MetricThreshold,
    long? VehicleId)
{
    /// <summary>An empty editor value (no metric chosen; operator defaults to the first canonical op).</summary>
    public static ComputedMetricEditorValue Empty { get; } =
        new(string.Empty, string.Empty, ComputedMetricOps.All[0], string.Empty, null);
}

/// <summary>
/// The computed-metric comparison operators (web <c>ComputedMetricOp</c> union and the <c>ALL_OPS</c>
/// fallback) plus the <c>opKey</c> / <c>opLabel</c> projections the web component uses to build the
/// operator dropdown. UI-free so it is unit-testable without a XAML runtime.
/// </summary>
public static class ComputedMetricOps
{
    /// <summary>Every operator, in the web <c>ALL_OPS</c> order — the fallback when no metric is selected.</summary>
    public static IReadOnlyList<string> All { get; } = new[]
    {
        ">", ">=", "<", "<=", "=", "!=", "%_change_>", "%_change_<",
    };

    /// <summary>The i18n key segment for an operator (web <c>opKey</c>): <c>gt</c>, <c>gte</c>, ….</summary>
    public static string Key(string op) => op switch
    {
        ">" => "gt",
        ">=" => "gte",
        "<" => "lt",
        "<=" => "lte",
        "=" => "eq",
        "!=" => "neq",
        "%_change_>" => "pctGt",
        "%_change_<" => "pctLt",
        _ => op,
    };

    /// <summary>The English fallback label for an operator (web <c>opLabel</c>).</summary>
    public static string Label(string op) => op switch
    {
        "%_change_>" => "% change >",
        "%_change_<" => "% change <",
        _ => op,
    };
}

/// <summary>
/// The display suffix for a metric unit (web <c>unitSuffix</c>) appended to the previewed value. UI-free
/// so it is unit-testable without a XAML runtime.
/// </summary>
public static class ComputedMetricUnits
{
    /// <summary>The trailing suffix for a metric <paramref name="unit"/> (empty for unitless metrics).</summary>
    public static string Suffix(string unit) => unit switch
    {
        "currency" => string.Empty,
        "currency_per_mi" => "/mi",
        "kwh" => "kWh",
        "wh_per_mi" => "Wh/mi",
        "mi" => "mi",
        "km" => "km",
        "h" => "h",
        "count" => string.Empty,
        "%" => "%",
        _ => unit,
    };
}

/// <summary>
/// Canonical registry metadata for the Computed Metric Editor surface — the native mirror of the web
/// component's identity. Carries the diagnostics surface slug emitted with the <c>view.opened</c> event.
/// </summary>
public static class ComputedMetricEditorRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "computed-metric-editor";

    /// <summary>Surface category (notifications / Alert Studio).</summary>
    public const string Category = "notifications";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ComputedMetricEditor";
}

/// <summary>
/// PII-safe diagnostics for the Computed Metric Editor surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a metric id, threshold or
/// previewed value — so a diagnostics line can never leak what the rule is about. Thread-safe.
/// </summary>
public sealed class ComputedMetricEditorDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ComputedMetricEditorDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ComputedMetricEditor</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ComputedMetricEditorRegistration.Slug}");
    }
}

/// <summary>
/// The single keyed call site for every Computed Metric Editor display string (P1/S10 i18n facade). Each
/// member routes its web i18n key through <see cref="ILocalizer"/> with the English fallback from
/// web/src/features/notifications/components/ComputedMetricEditor.tsx, so the keys are asserted in tests
/// and resolved for real in the app. No English literal lives anywhere else in the surface.
/// </summary>
public static class ComputedMetricEditorText
{
    /// <summary>Metric dropdown label: "Metric".</summary>
    public static string Metric(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.metric", "Metric");

    /// <summary>Metric dropdown prompt while the registry is loading: "Loading metrics…".</summary>
    public static string LoadingMetrics(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.loading", "Loading metrics\u2026");

    /// <summary>Metric dropdown prompt once loaded: "Choose a metric".</summary>
    public static string MetricPrompt(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.metricPlaceholder", "Choose a metric"); // parity:allow web-parity i18n key id mirrors the web catalog key name

    /// <summary>Window dropdown label: "Window".</summary>
    public static string Window(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.window", "Window");

    /// <summary>Window dropdown prompt: "Choose a window".</summary>
    public static string WindowPrompt(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.windowPlaceholder", "Choose a window"); // parity:allow web-parity i18n key id mirrors the web catalog key name

    /// <summary>Operator dropdown label: "Operator".</summary>
    public static string Operator(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.op", "Operator");

    /// <summary>Threshold field label: "Threshold".</summary>
    public static string Threshold(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.threshold", "Threshold");

    /// <summary>Threshold field prompt: "e.g. 200".</summary>
    public static string ThresholdPrompt(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.thresholdPlaceholder", "e.g. 200"); // parity:allow web-parity i18n key id mirrors the web catalog key name

    /// <summary>Live-preview pane header: "Live preview".</summary>
    public static string PreviewLabel(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.preview", "Live preview");

    /// <summary>Preview idle copy shown until the editor is "ready".</summary>
    public static string PreviewIdle(ILocalizer l) =>
        Get(
            l,
            "notifications.alertStudio.computedMetric.previewIdle",
            "Pick a metric, window, operator, and threshold to preview.");

    /// <summary>Preview in-flight copy: "Computing…".</summary>
    public static string PreviewLoading(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.previewLoading", "Computing\u2026");

    /// <summary>Empty-state copy when the metric registry resolves with no rows.</summary>
    public static string MetricsEmpty(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.metricsEmpty", "No metrics available");

    /// <summary>Error-state copy when the metric registry load fails with no cache.</summary>
    public static string MetricsError(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.metricsError", "Couldn't load metrics");

    /// <summary>Retry affordance for a failed registry load.</summary>
    public static string Retry(ILocalizer l) => Get(l, "common.retry", "Retry");

    /// <summary>Stale chip caption shown over cached-but-old metric rows.</summary>
    public static string Stale(ILocalizer l) => Get(l, "common.stale", "Stale");

    /// <summary>Offline chip caption shown over cached metric rows after a network failure.</summary>
    public static string Offline(ILocalizer l) => Get(l, "common.offline", "Offline");

    /// <summary>Localized metric name (web <c>metricNames.{id}</c>), falling back to the API label.</summary>
    public static string MetricName(ILocalizer l, string id, string fallback) =>
        Get(l, string.Concat("notifications.alertStudio.metricNames.", id), fallback);

    /// <summary>Localized window label (web <c>metricWindows.{window}</c>), falling back to the raw window.</summary>
    public static string MetricWindowLabel(ILocalizer l, string window) =>
        Get(l, string.Concat("notifications.alertStudio.metricWindows.", window), window);

    /// <summary>Localized operator label (web <c>metricOps.{key}</c>), falling back to the op symbol label.</summary>
    public static string MetricOpLabel(ILocalizer l, string op) =>
        Get(l, string.Concat("notifications.alertStudio.metricOps.", ComputedMetricOps.Key(op)), ComputedMetricOps.Label(op));

    /// <summary>Verdict fragment when the metric would fire (web <c>would</c>, intentionally empty).</summary>
    public static string Would(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.would", string.Empty);

    /// <summary>Verdict fragment when the metric would not fire (web <c>wouldNot</c>): "NOT".</summary>
    public static string WouldNot(ILocalizer l) =>
        Get(l, "notifications.alertStudio.computedMetric.wouldNot", "NOT");

    /// <summary>
    /// Compose the preview sentence from the localized template (web <c>previewValue</c>), substituting the
    /// i18next-style <c>{{value}}</c>, <c>{{suffix}}</c> and <c>{{verdict}}</c> tokens.
    /// </summary>
    public static string PreviewValue(ILocalizer l, string value, string suffix, string verdict)
    {
        var template = Get(
            l,
            "notifications.alertStudio.computedMetric.previewValue",
            "Right now this metric is {{value}}{{suffix}} \u2014 would {{verdict}} fire.");
        return template
            .Replace("{{value}}", value, StringComparison.Ordinal)
            .Replace("{{suffix}}", suffix, StringComparison.Ordinal)
            .Replace("{{verdict}}", verdict, StringComparison.Ordinal);
    }

    private static string Get(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// Status-preserving projection of the cache-then-network metric registry read: parses the JSON-array
/// payload into typed summaries while preserving the cached / refreshing / stale / offline / loaded /
/// empty status, collapsing a loaded-but-empty array to the Empty state.
/// </summary>
public static class ComputedMetricCatalogMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ComputedMetricSummary>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<ComputedMetricSummary> Parsed() =>
            raw.HasValue ? ComputedMetricSummary.ParseList(raw.Value) : Array.Empty<ComputedMetricSummary>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Cached(Parsed(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Refreshing(Parsed(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parsed(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.OfflineCached(Parsed(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<ComputedMetricSummary>> ToLoadedOrEmpty(
        IReadOnlyList<ComputedMetricSummary> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}

/// <summary>Null-tolerant <see cref="JsonElement"/> readers shared by the surface's parsers.</summary>
internal static class ComputedMetricJson
{
    public static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static double? ReadDouble(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d)
            ? d
            : null;

    public static bool? ReadBool(JsonElement obj, string name)
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

    public static IReadOnlyList<string> ReadStringList(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(v.GetArrayLength());
        foreach (var item in v.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String)
            {
                var s = item.GetString();
                if (!string.IsNullOrEmpty(s))
                {
                    list.Add(s);
                }
            }
        }

        return list;
    }

    public static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
