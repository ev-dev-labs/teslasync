using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the AnomalyDetectorWidget's UI-thread-free logic — the JSON parse adapter,
/// the severity-sorted projection (z-score / relative-time / impact + severity badges), the
/// cache-then-network result mapper, the registry metadata, the diagnostics, the repository source's
/// vehicle resolution, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/AnomalyDetectorWidget.tsx + api/hooks/useAnomalies.ts).
/// </summary>
public sealed class AnomalyDetectorWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static AnomalyEntry Entry(
        string severity = "info",
        string? signal = "BatteryLevel",
        double z = 2.0,
        string? detectedAt = "2026-06-06T12:00:00Z",
        string? message = "Message") =>
        new(signal, "z_score", severity, 0, 0, z, detectedAt, message);

    private static AnomalyReport Report(params AnomalyEntry[] entries) => new(entries);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_anomalies_array_with_snake_case_fields()
    {
        const string json = """
        {"signals_monitored":12,"anomalies_last_24h":1,
         "anomalies":[{"signal":"BatteryLevel","type":"z_score","severity":"critical","value":3.0,
           "baseline":1.0,"z_score":3.4,"detected_at":"2026-06-06T12:00:00Z","message":"Battery spike"}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var report = AnomalyReport.FromJson(doc.RootElement);

        var anomaly = Assert.Single(report.Anomalies);
        Assert.Equal("BatteryLevel", anomaly.Signal);
        Assert.Equal("z_score", anomaly.Type);
        Assert.Equal("critical", anomaly.Severity);
        Assert.Equal(3.0, anomaly.Value);
        Assert.Equal(1.0, anomaly.Baseline);
        Assert.Equal(3.4, anomaly.ZScore);
        Assert.Equal("Battery spike", anomaly.Message);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), anomaly.DetectedAtTime);
        Assert.True(report.HasAnomalies);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"anomalies":[{"signal":"Foo"}]}""");

        var report = AnomalyReport.FromJson(doc.RootElement);

        var anomaly = Assert.Single(report.Anomalies);
        Assert.Equal("Foo", anomaly.Signal);
        Assert.Equal("info", anomaly.Severity);   // default
        Assert.Equal(0, anomaly.ZScore);
        Assert.Null(anomaly.DetectedAt);
        Assert.Null(anomaly.DetectedAtTime);
        Assert.Null(anomaly.Message);
    }

    [Fact]
    public void FromJson_returns_empty_when_anomalies_absent()
    {
        using var doc = JsonDocument.Parse("""{"signals_monitored":5}""");
        var report = AnomalyReport.FromJson(doc.RootElement);
        Assert.False(report.HasAnomalies);
        Assert.Empty(report.Anomalies);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object_non_array()
    {
        using var doc = JsonDocument.Parse("42");
        Assert.False(AnomalyReport.FromJson(doc.RootElement).HasAnomalies);
    }

    [Fact]
    public void FromJson_tolerates_a_bare_array_body()
    {
        using var doc = JsonDocument.Parse("""[{"signal":"A","severity":"warning"}]""");
        var report = AnomalyReport.FromJson(doc.RootElement);
        Assert.Single(report.Anomalies);
    }

    [Fact]
    public void FromJson_skips_non_object_array_items()
    {
        using var doc = JsonDocument.Parse("""{"anomalies":[1,"x",{"signal":"A"}]}""");
        var report = AnomalyReport.FromJson(doc.RootElement);
        var anomaly = Assert.Single(report.Anomalies);
        Assert.Equal("A", anomaly.Signal);
    }

    // ---- Size / footprint flag (web isCompact) -------------------------------------

    [Theory]
    [InlineData(1, 2, true)]    // compact
    [InlineData(2, 4, false)]   // standard (default)
    [InlineData(4, 40, false)]  // wide
    public void Size_isCompact_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new AnomalyDetectorSize(cols, rows).IsCompact);

    // ---- Projection: sort + composition --------------------------------------------

    [Fact]
    public void Project_sorts_critical_then_warning_then_info()
    {
        var report = Report(
            Entry(severity: "info", signal: "I"),
            Entry(severity: "critical", signal: "C"),
            Entry(severity: "warning", signal: "W"));

        var display = AnomalyDetectorProjection.Project(report, new AnomalyDetectorSize(2, 4), Localizer, Now);

        Assert.Equal(3, display.Tips.Count);
        Assert.StartsWith("C ", display.Tips[0].Title, StringComparison.Ordinal);
        Assert.StartsWith("W ", display.Tips[1].Title, StringComparison.Ordinal);
        Assert.StartsWith("I ", display.Tips[2].Title, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_composes_title_signal_zscore_relative()
    {
        var report = Report(Entry(severity: "warning", signal: "BatteryLevel", z: 3.24, detectedAt: "2026-06-06T12:00:00Z"));

        var tip = Assert.Single(AnomalyDetectorProjection.Project(report, new AnomalyDetectorSize(2, 4), Localizer, Now).Tips);

        Assert.Equal("BatteryLevel \u00B7 z=3.2 \u00B7 5m ago", tip.Title);
        Assert.Equal("Message", tip.Description);
    }

    [Fact]
    public void Project_falls_back_to_em_dash_for_null_signal_and_message()
    {
        var report = Report(Entry(signal: null, message: null, detectedAt: null));

        var tip = Assert.Single(AnomalyDetectorProjection.Project(report, new AnomalyDetectorSize(2, 4), Localizer, Now).Tips);

        Assert.StartsWith("\u2014 \u00B7 z=", tip.Title, StringComparison.Ordinal);
        Assert.Equal("\u2014", tip.Description);
    }

    [Theory]
    [InlineData("2026-06-06T12:05:00Z", "Just now")]
    [InlineData("2026-06-06T12:00:00Z", "5m ago")]
    [InlineData("2026-06-06T09:05:00Z", "3h ago")]
    [InlineData("2026-06-04T12:05:00Z", "2d ago")]
    public void FormatRelativeTime_matches_web_tiers(string detectedAt, string expected)
    {
        var parsed = DateTimeOffset.Parse(detectedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        Assert.Equal(expected, AnomalyDetectorProjection.FormatRelativeTime(parsed, Now));
    }

    [Fact]
    public void FormatRelativeTime_renders_em_dash_for_null()
    {
        Assert.Equal("\u2014", AnomalyDetectorProjection.FormatRelativeTime(null, Now));
    }

    // ---- Projection: the three distinct web colour mappings -------------------------

    [Theory]
    [InlineData("critical", "TsColorDangerBrush", "\uEA39")]
    [InlineData("warning", "TsColorWarningBrush", "\uE7BA")]
    [InlineData("info", "TsColorInfoBrush", "\uE946")]
    public void Project_tip_icon_uses_severity_colour(string severity, string brushKey, string glyph)
    {
        var tip = Assert.Single(
            AnomalyDetectorProjection.Project(Report(Entry(severity: severity)), new AnomalyDetectorSize(2, 4), Localizer, Now).Tips);

        Assert.Equal(brushKey, tip.IconBrushKey);
        Assert.Equal(glyph, tip.Glyph);
    }

    [Theory]
    [InlineData("critical", StatusKind.Success)]  // web: high -> success
    [InlineData("warning", StatusKind.Warning)]   // web: medium -> warning
    [InlineData("info", StatusKind.Neutral)]      // web: low -> neutral
    public void Project_tip_badge_uses_impact_colour(string severity, StatusKind expected)
    {
        var tip = Assert.Single(
            AnomalyDetectorProjection.Project(Report(Entry(severity: severity)), new AnomalyDetectorSize(2, 4), Localizer, Now).Tips);

        Assert.Equal(expected, tip.ImpactStatus);
        Assert.Equal(severity, tip.ImpactLabel); // passthrough -> raw severity fallback
    }

    [Theory]
    [InlineData("critical", StatusKind.Danger)]   // web SEVERITY_BADGE: critical -> danger
    [InlineData("warning", StatusKind.Warning)]
    [InlineData("info", StatusKind.Neutral)]
    public void Project_count_badge_uses_max_severity(string severity, StatusKind expected)
    {
        var display = AnomalyDetectorProjection.Project(
            Report(Entry(severity: "info"), Entry(severity: severity)), new AnomalyDetectorSize(1, 2), Localizer, Now);

        Assert.Equal(expected, display.CountStatus);
    }

    [Fact]
    public void Project_count_and_active_label()
    {
        var display = AnomalyDetectorProjection.Project(
            Report(Entry(severity: "critical"), Entry(severity: "warning"), Entry(severity: "info")),
            new AnomalyDetectorSize(1, 2), Localizer, Now);

        Assert.Equal(3, display.Count);
        Assert.Equal("3", display.CountText);
        Assert.Equal("3 active", display.ActiveCountLabel);
        Assert.True(display.IsCompact);
        Assert.Equal(StatusKind.Danger, display.CountStatus); // critical is the most severe present
    }

    [Fact]
    public void Project_keeps_all_sorted_tips_and_exposes_standard_cap()
    {
        var report = Report(
            Entry(severity: "info", signal: "I1"),
            Entry(severity: "info", signal: "I2"),
            Entry(severity: "critical", signal: "C1"),
            Entry(severity: "warning", signal: "W1"),
            Entry(severity: "critical", signal: "C2"));

        var display = AnomalyDetectorProjection.Project(report, new AnomalyDetectorSize(2, 4), Localizer, Now);

        Assert.Equal(5, display.Tips.Count); // projection keeps all; the view caps at MaxStandardTips
        Assert.Equal(3, AnomalyDetectorProjection.MaxStandardTips);
        Assert.StartsWith("C1 ", display.Tips[0].Title, StringComparison.Ordinal);
        Assert.StartsWith("C2 ", display.Tips[1].Title, StringComparison.Ordinal);
        Assert.StartsWith("W1 ", display.Tips[2].Title, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_tips_have_non_empty_accessibility_names()
    {
        var display = AnomalyDetectorProjection.Project(
            Report(Entry(severity: "critical", signal: "BatteryLevel")), new AnomalyDetectorSize(2, 4), Localizer, Now);

        var tip = Assert.Single(display.Tips);
        Assert.False(string.IsNullOrWhiteSpace(tip.AutomationName));
        Assert.Contains(tip.Title, tip.AutomationName, StringComparison.Ordinal);
        Assert.Contains(tip.ImpactLabel, tip.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_automation_name_carries_count()
    {
        var display = AnomalyDetectorProjection.Project(
            Report(Entry(severity: "critical")), new AnomalyDetectorSize(1, 2), Localizer, Now);

        Assert.False(string.IsNullOrWhiteSpace(display.CountAutomationName));
        Assert.Contains("1 active", display.CountAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_empty_report_yields_zero_count_no_tips()
    {
        var display = AnomalyDetectorProjection.Project(AnomalyReport.Empty, new AnomalyDetectorSize(1, 2), Localizer, Now);

        Assert.False(display.HasAnomalies);
        Assert.Equal(0, display.Count);
        Assert.Empty(display.Tips);
        Assert.Equal(StatusKind.Neutral, display.CountStatus);
    }

    [Theory]
    [InlineData("critical", 0)]
    [InlineData("warning", 1)]
    [InlineData("info", 2)]
    [InlineData("nonsense", 2)]
    public void SeverityRank_matches_web_order(string severity, int rank) =>
        Assert.Equal(rank, AnomalyDetectorProjection.SeverityRank(severity));

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"anomalies":[{"signal":"A","severity":"critical"}]}""");

        var cached = AnomalyDetectorResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!.Anomalies);

        var offline = AnomalyDetectorResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Anomalies);
    }

    [Fact]
    public void Mapper_loaded_with_anomalies_is_loaded()
    {
        using var doc = JsonDocument.Parse("""{"anomalies":[{"signal":"A","severity":"info"}]}""");
        Assert.Equal(LoadStatus.Loaded, AnomalyDetectorResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
    }

    [Fact]
    public void Mapper_loaded_without_anomalies_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"anomalies":[]}""");
        Assert.Equal(LoadStatus.Empty, AnomalyDetectorResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
    }

    [Fact]
    public void Mapper_maps_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Empty, AnomalyDetectorResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, AnomalyDetectorResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<AnomalyReport>.Loading());
        await vm.LoadAsync();

        Assert.Equal(AnomalyDetectorState.Loading, vm.State);
        Assert.False(vm.HasAnomalies);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_tips()
    {
        using var vm = NewViewModel(Loaded(Report(Entry(severity: "critical"))));
        await vm.LoadAsync();

        Assert.Equal(AnomalyDetectorState.Loaded, vm.State);
        Assert.True(vm.HasAnomalies);
        Assert.Single(vm.Display.Tips);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_anomalies_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<AnomalyReport>.Loaded(AnomalyReport.Empty, Now));
        await vm.LoadAsync();

        Assert.Equal(AnomalyDetectorState.Empty, vm.State);
        Assert.False(vm.HasAnomalies);
        Assert.Equal("No anomalies", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<AnomalyReport>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(AnomalyDetectorState.Empty, vm.State);
        Assert.False(vm.HasAnomalies);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<AnomalyReport>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(AnomalyDetectorState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(
            RepositoryResult<AnomalyReport>.Cached(Report(Entry(severity: "warning")), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AnomalyDetectorState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasAnomalies);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<AnomalyReport>.OfflineCached(
            Report(Entry(severity: "critical")), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(AnomalyDetectorState.Offline, vm.State);
        Assert.True(vm.HasAnomalies);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<AnomalyReport>.Loading(),
            RepositoryResult<AnomalyReport>.Cached(Report(Entry(severity: "info", signal: "Cached")), Now, stale: false),
            RepositoryResult<AnomalyReport>.Loaded(
                Report(Entry(severity: "warning", signal: "Warn"), Entry(severity: "critical", signal: "Crit")), Now));
        await vm.LoadAsync();

        Assert.Equal(AnomalyDetectorState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Count);
        Assert.StartsWith("Crit ", vm.Display.Tips[0].Title, StringComparison.Ordinal); // sorted, critical first
        Assert.Equal(StatusKind.Success, vm.Display.Tips[0].ImpactStatus);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new AnomalyDetectorSize(2, 4), Loaded(Report(Entry(severity: "critical"))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new AnomalyDetectorSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(AnomalyDetectorState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<AnomalyReport>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Anomaly Detector", vm.Title);
        Assert.Equal("No anomalies", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Report(Entry(severity: "critical"))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AnomalyDetectorViewModel.State), changed);
        Assert.Contains(nameof(AnomalyDetectorViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("anomaly-detector", AnomalyDetectorRegistration.Id);
        Assert.Equal("analytics", AnomalyDetectorRegistration.Category);
        Assert.Equal("AnomalyDetectorWidget", AnomalyDetectorRegistration.Slug);
        Assert.Equal(7, AnomalyDetectorRegistration.DefaultDays);
        Assert.Equal(new AnomalyDetectorSize(2, 4), AnomalyDetectorRegistration.DefaultSize);
        Assert.Equal(new AnomalyDetectorSize(1, 2), AnomalyDetectorRegistration.MinSize);
        Assert.Equal(new AnomalyDetectorSize(4, 40), AnomalyDetectorRegistration.MaxSize);
        Assert.Equal("Anomaly Detector", AnomalyDetectorRegistration.Name(Localizer));
        Assert.Contains("outlier", AnomalyDetectorRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, AnomalyDetectorRegistration.IsWithinBounds(new AnomalyDetectorSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new AnomalyDetectorSize(1, 2), AnomalyDetectorRegistration.Clamp(new AnomalyDetectorSize(0, 0)));
        Assert.Equal(new AnomalyDetectorSize(4, 40), AnomalyDetectorRegistration.Clamp(new AnomalyDetectorSize(9, 99)));
    }

    [Fact]
    public void RegistryId_is_exposed_on_the_view_type() =>
        Assert.Equal("anomaly-detector", AnomalyDetectorRegistration.Id);

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AnomalyDetectorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AnomalyDetectorWidget", Assert.Single(lines));
    }

    // ---- Source: vehicle resolution + request shape --------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new AnomalyDetectorSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_anomalies()
    {
        using var doc = JsonDocument.Parse(
            """{"anomalies":[{"signal":"BatteryLevel","severity":"critical","z_score":3.1,"detected_at":"2026-06-06T12:00:00Z","message":"x"}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new AnomalyDetectorSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null, days: 7);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Single(terminal.Value!.Anomalies);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_anomalies", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(7, Convert.ToInt32(request.Query!["days"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_and_empty_anomalies_collapse_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"anomalies":[]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new AnomalyDetectorSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42, days: 14);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(14, Convert.ToInt32(request.Query!["days"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new FakeCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<AnomalyReport>>> Drain(IAnomalyDetectorSource source)
    {
        var list = new List<RepositoryResult<AnomalyReport>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<AnomalyReport> Loaded(AnomalyReport report) =>
        RepositoryResult<AnomalyReport>.Loaded(report, Now);

    private static AnomalyDetectorViewModel NewViewModel(params RepositoryResult<AnomalyReport>[] emissions) =>
        NewViewModel(AnomalyDetectorSize.Default, emissions);

    private static AnomalyDetectorViewModel NewViewModel(
        AnomalyDetectorSize size,
        params RepositoryResult<AnomalyReport>[] emissions) =>
        new(new FakeAnomalyDetectorSource(emissions), Localizer, size, () => Now);

    private sealed class FakeAnomalyDetectorSource(params RepositoryResult<AnomalyReport>[] emissions) : IAnomalyDetectorSource
    {
        public async IAsyncEnumerable<RepositoryResult<AnomalyReport>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
