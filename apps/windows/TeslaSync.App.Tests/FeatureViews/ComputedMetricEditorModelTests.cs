using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ComputedMetricEditor's UI-thread-free model logic — the JSON parse
/// adapters, the operator key/label and unit-suffix projections, the snake_case preview request, the
/// cache-then-network catalog mapper, the registration metadata, the diagnostics and the i18n facade.
/// Mirrors the web spec (web/src/features/notifications/components/ComputedMetricEditor.tsx).
/// </summary>
public sealed class ComputedMetricEditorModelTests
{
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement;

    // ---- Summary parsing (port of ComputedMetricSummary) ----------------------------

    [Fact]
    public void Summary_FromJson_parses_all_fields()
    {
        var summary = ComputedMetricSummary.FromJson(Json(
            """{ "id": "charge_cost", "label": "Charge cost", "unit": "currency", "windows": ["7d","30d"], "ops": [">","<"] }"""));

        Assert.Equal("charge_cost", summary.Id);
        Assert.Equal("Charge cost", summary.Label);
        Assert.Equal("currency", summary.Unit);
        Assert.Equal(new[] { "7d", "30d" }, summary.Windows);
        Assert.Equal(new[] { ">", "<" }, summary.Ops);
    }

    [Fact]
    public void Summary_FromJson_falls_back_label_to_id_and_tolerates_missing()
    {
        var summary = ComputedMetricSummary.FromJson(Json("""{ "id": "x" }"""));

        Assert.Equal("x", summary.Id);
        Assert.Equal("x", summary.Label);
        Assert.Equal(string.Empty, summary.Unit);
        Assert.Empty(summary.Windows);
        Assert.Empty(summary.Ops);
    }

    [Fact]
    public void Summary_ParseList_skips_non_objects_and_non_arrays()
    {
        Assert.Empty(ComputedMetricSummary.ParseList(Json("""{ "not": "an array" }""")));

        var list = ComputedMetricSummary.ParseList(Json("""[ { "id": "a" }, 7, "skip", { "id": "b" } ]"""));
        Assert.Equal(new[] { "a", "b" }, list.Select(m => m.Id));
    }

    // ---- Preview parsing (port of ComputedMetricPreview) -----------------------------

    [Fact]
    public void Preview_FromJson_parses_value_verdict_and_optional_tiers()
    {
        var preview = ComputedMetricPreview.FromJson(Json(
            """{ "metric_id":"m", "metric_window":"7d", "metric_op":">", "threshold":200, "value":234.5, "would_trigger":true, "previous_value":210, "percent_change":11.6 }"""));

        Assert.Equal("m", preview.MetricId);
        Assert.Equal("7d", preview.MetricWindow);
        Assert.Equal(">", preview.MetricOp);
        Assert.Equal(200d, preview.Threshold);
        Assert.Equal(234.5d, preview.Value);
        Assert.True(preview.WouldTrigger);
        Assert.Equal(210d, preview.PreviousValue);
        Assert.Equal(11.6d, preview.PercentChange);
    }

    [Fact]
    public void Preview_FromJson_defaults_missing_value_and_verdict()
    {
        var preview = ComputedMetricPreview.FromJson(Json("""{ "metric_id":"m" }"""));

        Assert.Equal(0d, preview.Value);
        Assert.False(preview.WouldTrigger);
        Assert.Null(preview.PreviousValue);
        Assert.Null(preview.PercentChange);
    }

    // ---- Operator key/label projections (port of opKey / opLabel) --------------------

    [Fact]
    public void Ops_All_matches_web_ALL_OPS_order()
    {
        Assert.Equal(
            new[] { ">", ">=", "<", "<=", "=", "!=", "%_change_>", "%_change_<" },
            ComputedMetricOps.All);
    }

    [Theory]
    [InlineData(">", "gt")]
    [InlineData(">=", "gte")]
    [InlineData("<", "lt")]
    [InlineData("<=", "lte")]
    [InlineData("=", "eq")]
    [InlineData("!=", "neq")]
    [InlineData("%_change_>", "pctGt")]
    [InlineData("%_change_<", "pctLt")]
    public void Ops_Key_maps_each_operator(string op, string key) =>
        Assert.Equal(key, ComputedMetricOps.Key(op));

    [Theory]
    [InlineData("%_change_>", "% change >")]
    [InlineData("%_change_<", "% change <")]
    [InlineData(">", ">")]
    [InlineData("!=", "!=")]
    public void Ops_Label_specializes_percent_change(string op, string label) =>
        Assert.Equal(label, ComputedMetricOps.Label(op));

    // ---- Unit suffix projection (port of unitSuffix) --------------------------------

    [Theory]
    [InlineData("currency", "")]
    [InlineData("currency_per_mi", "/mi")]
    [InlineData("kwh", "kWh")]
    [InlineData("wh_per_mi", "Wh/mi")]
    [InlineData("mi", "mi")]
    [InlineData("km", "km")]
    [InlineData("h", "h")]
    [InlineData("count", "")]
    [InlineData("%", "%")]
    [InlineData("unknown_unit", "unknown_unit")]
    public void Units_Suffix_table(string unit, string suffix) =>
        Assert.Equal(suffix, ComputedMetricUnits.Suffix(unit));

    // ---- Preview request shape (snake_case, kind discriminator) ----------------------

    [Fact]
    public void PreviewRequest_From_sets_kind_and_fields()
    {
        var value = new ComputedMetricEditorValue("charge_cost", "30d", ">=", "200", 7);
        var request = ComputedMetricPreviewRequest.From(value, 200d);

        Assert.Equal("computed_metric", request.Kind);
        Assert.Equal("charge_cost", request.MetricId);
        Assert.Equal("30d", request.MetricWindow);
        Assert.Equal(">=", request.MetricOp);
        Assert.Equal(200d, request.MetricThreshold);
        Assert.Equal(7L, request.VehicleId);
    }

    [Fact]
    public void PreviewRequest_serializes_snake_case_and_omits_null_vehicle()
    {
        var json = JsonSerializer.Serialize(
            ComputedMetricPreviewRequest.From(new ComputedMetricEditorValue("m", "7d", ">", "1", null), 1d),
            ApiClientOptions.CreateJsonOptions());
        var root = Json(json);

        Assert.Equal("computed_metric", root.GetProperty("kind").GetString());
        Assert.Equal("m", root.GetProperty("metric_id").GetString());
        Assert.Equal("7d", root.GetProperty("metric_window").GetString());
        Assert.Equal(">", root.GetProperty("metric_op").GetString());
        Assert.Equal(1d, root.GetProperty("metric_threshold").GetDouble());
        Assert.False(root.TryGetProperty("vehicle_id", out _));
    }

    [Fact]
    public void PreviewRequest_serializes_vehicle_when_present()
    {
        var json = JsonSerializer.Serialize(
            ComputedMetricPreviewRequest.From(new ComputedMetricEditorValue("m", "7d", ">", "1", 42), 1d),
            ApiClientOptions.CreateJsonOptions());
        var root = Json(json);

        Assert.Equal(42L, root.GetProperty("vehicle_id").GetInt64());
    }

    [Fact]
    public void PreviewRequest_DebounceKey_changes_with_inputs()
    {
        var a = ComputedMetricPreviewRequest.From(new ComputedMetricEditorValue("m", "7d", ">", "1", null), 1d);
        var b = ComputedMetricPreviewRequest.From(new ComputedMetricEditorValue("m", "7d", ">", "2", null), 2d);
        var c = ComputedMetricPreviewRequest.From(new ComputedMetricEditorValue("m", "7d", ">", "1", null), 1d);

        Assert.NotEqual(a.DebounceKey(), b.DebounceKey());
        Assert.Equal(a.DebounceKey(), c.DebounceKey());
    }

    [Fact]
    public void EditorValue_Empty_defaults_operator_to_first_op()
    {
        Assert.Equal(string.Empty, ComputedMetricEditorValue.Empty.MetricId);
        Assert.Equal(string.Empty, ComputedMetricEditorValue.Empty.MetricWindow);
        Assert.Equal(ComputedMetricOps.All[0], ComputedMetricEditorValue.Empty.MetricOp);
        Assert.Null(ComputedMetricEditorValue.Empty.VehicleId);
    }

    // ---- i18n facade (every web key resolves through the localizer) ------------------

    [Fact]
    public void Text_resolves_expected_i18n_keys()
    {
        var recorder = new RecordingLocalizer();

        ComputedMetricEditorText.Metric(recorder);
        ComputedMetricEditorText.LoadingMetrics(recorder);
        ComputedMetricEditorText.MetricPrompt(recorder);
        ComputedMetricEditorText.Window(recorder);
        ComputedMetricEditorText.WindowPrompt(recorder);
        ComputedMetricEditorText.Operator(recorder);
        ComputedMetricEditorText.Threshold(recorder);
        ComputedMetricEditorText.ThresholdPrompt(recorder);
        ComputedMetricEditorText.PreviewLabel(recorder);
        ComputedMetricEditorText.PreviewIdle(recorder);
        ComputedMetricEditorText.PreviewLoading(recorder);
        ComputedMetricEditorText.Would(recorder);
        ComputedMetricEditorText.WouldNot(recorder);
        ComputedMetricEditorText.MetricName(recorder, "charge_cost", "Charge cost");
        ComputedMetricEditorText.MetricWindowLabel(recorder, "7d");
        ComputedMetricEditorText.MetricOpLabel(recorder, "%_change_>");

        Assert.Contains("notifications.alertStudio.computedMetric.metric", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.loading", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.metricPlaceholder", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.window", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.windowPlaceholder", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.op", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.threshold", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.thresholdPlaceholder", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.preview", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.previewIdle", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.previewLoading", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.would", recorder.Keys);
        Assert.Contains("notifications.alertStudio.computedMetric.wouldNot", recorder.Keys);
        Assert.Contains("notifications.alertStudio.metricNames.charge_cost", recorder.Keys);
        Assert.Contains("notifications.alertStudio.metricWindows.7d", recorder.Keys);
        Assert.Contains("notifications.alertStudio.metricOps.pctGt", recorder.Keys);
    }

    [Fact]
    public void Text_PreviewValue_interpolates_placeholders()
    {
        var rendered = ComputedMetricEditorText.PreviewValue(Localizer, "234.50", " mi", "NOT");

        Assert.Equal("Right now this metric is 234.50 mi \u2014 would NOT fire.", rendered);
    }

    // ---- Diagnostics (P1/S11): view.opened slug=ComputedMetricEditor, PII-safe -------

    [Fact]
    public void Diagnostics_RecordViewOpened_emits_slug_and_counts()
    {
        var captured = new List<string>();
        var diagnostics = new ComputedMetricEditorDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=ComputedMetricEditor", Assert.Single(captured));
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ---- Catalog mapper (status-preserving projection) -------------------------------

    [Fact]
    public void CatalogMapper_preserves_each_status()
    {
        var array = Json("""[ { "id": "a" } ]""");

        Assert.Equal(LoadStatus.Loading, ComputedMetricCatalogMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Cached, ComputedMetricCatalogMapper.Map(RepositoryResult<JsonElement>.Cached(array, Now, false)).Status);
        Assert.Equal(LoadStatus.Refreshing, ComputedMetricCatalogMapper.Map(RepositoryResult<JsonElement>.Refreshing(array, Now, true)).Status);
        Assert.Equal(LoadStatus.Empty, ComputedMetricCatalogMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Offline, ComputedMetricCatalogMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(array, Now, new RepositoryError(RepositoryErrorKind.Network, "x"))).Status);
        Assert.Equal(LoadStatus.Error, ComputedMetricCatalogMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "x"))).Status);

        var loaded = ComputedMetricCatalogMapper.Map(RepositoryResult<JsonElement>.Loaded(array, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal("a", Assert.Single(loaded.Value!).Id);
    }

    [Fact]
    public void CatalogMapper_collapses_loaded_empty_array_to_empty()
    {
        var mapped = ComputedMetricCatalogMapper.Map(RepositoryResult<JsonElement>.Loaded(Json("[]"), Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    // ---- Registration metadata -------------------------------------------------------

    [Fact]
    public void Registration_exposes_canonical_identity()
    {
        Assert.Equal("computed-metric-editor", ComputedMetricEditorRegistration.Id);
        Assert.Equal("notifications", ComputedMetricEditorRegistration.Category);
        Assert.Equal("ComputedMetricEditor", ComputedMetricEditorRegistration.Slug);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
