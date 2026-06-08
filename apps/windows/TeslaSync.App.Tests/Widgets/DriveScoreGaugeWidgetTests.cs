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
/// Headless verification of the DriveScoreGaugeWidget's UI-thread-free logic — the JSON parse adapter (the
/// useDriveScore normalisation, incl. the snake_case <c>speed_discipline</c>), the score-colour threshold
/// helper, the value formatting, the projection across the compact / wide / tall footprints (the stats-row and
/// per-metric-bar gates), the cache-then-network result mapper, the per-vehicle data source (primary
/// resolution + query-scoped request), the registry metadata, the diagnostics, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web
/// spec (web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx).
/// </summary>
public sealed class DriveScoreGaugeWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (web useDriveScore normalisation) ---------------------------

    [Fact]
    public void FromResponse_reads_all_fields_including_snake_case_speed_discipline()
    {
        using var doc = JsonDocument.Parse(
            """{"overall":72,"efficiency":80,"smoothness":65,"speed_discipline":50,"grade":"B","total_drives":42,"trend":"up"}""");

        var score = DriveScore.FromResponse(doc.RootElement);

        Assert.NotNull(score);
        Assert.Equal(72, score!.Overall);
        Assert.Equal(80, score.Efficiency);
        Assert.Equal(65, score.Smoothness);
        Assert.Equal(50, score.SpeedDiscipline);
        Assert.Equal("B", score.Grade);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"overall":40}""");

        var score = DriveScore.FromResponse(doc.RootElement);

        Assert.NotNull(score);
        Assert.Equal(40, score!.Overall);
        Assert.Equal(0, score.Efficiency);
        Assert.Equal(0, score.Smoothness);
        Assert.Equal(0, score.SpeedDiscipline);
        Assert.Equal(string.Empty, score.Grade);
    }

    [Fact]
    public void FromResponse_reads_zero_score_object_as_usable()
    {
        // Web parity: the backend returns a real object (overall:0, grade:"F") even with no completed drives —
        // the widget renders the gauge at 0/F, it does NOT show the empty surface.
        using var doc = JsonDocument.Parse(
            """{"overall":0,"efficiency":0,"smoothness":0,"speed_discipline":0,"grade":"F","total_drives":0,"trend":"flat"}""");

        var score = DriveScore.FromResponse(doc.RootElement);

        Assert.NotNull(score);
        Assert.Equal(0, score!.Overall);
        Assert.Equal("F", score.Grade);
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(DriveScore.FromResponse(doc.RootElement));
    }

    // ---- Score colour thresholds (web scoreColor) ----------------------------------

    [Theory]
    [InlineData(100, StatusKind.Success)]
    [InlineData(80, StatusKind.Success)]   // web: >= 80
    [InlineData(79, StatusKind.Info)]
    [InlineData(60, StatusKind.Info)]      // web: >= 60
    [InlineData(59, StatusKind.Warning)]
    [InlineData(40, StatusKind.Warning)]   // web: >= 40
    [InlineData(39, StatusKind.Danger)]
    [InlineData(0, StatusKind.Danger)]
    public void StatusFor_classifies_by_threshold(double score, StatusKind expected) =>
        Assert.Equal(expected, DriveScoreGaugeProjection.StatusFor(score));

    [Theory]
    [InlineData(StatusKind.Success, "TsColorSuccessBrush")]
    [InlineData(StatusKind.Info, "TsColorInfoBrush")]
    [InlineData(StatusKind.Warning, "TsColorWarningBrush")]
    [InlineData(StatusKind.Danger, "TsColorDangerBrush")]
    public void Status_maps_to_themed_status_brush(StatusKind status, string brushKey) =>
        Assert.Equal(brushKey, StatusResources.AccentBrushKey(status));

    [Fact]
    public void Threshold_constants_match_web()
    {
        Assert.Equal(80, DriveScoreGaugeProjection.ExcellentThreshold);
        Assert.Equal(60, DriveScoreGaugeProjection.GoodThreshold);
        Assert.Equal(40, DriveScoreGaugeProjection.FairThreshold);
        Assert.Equal(100, DriveScoreGaugeProjection.MaxScore);
    }

    // ---- Value formatting (web RadialGauge / MetricBar fmtNumber) ------------------

    [Theory]
    [InlineData(72, "72")]        // integer -> 0 decimals
    [InlineData(100, "100")]
    [InlineData(0, "0")]
    [InlineData(72.5, "72.50")]   // non-integer -> 2 decimals (global precision)
    public void FormatValue_matches_web(double value, string expected) =>
        Assert.Equal(expected, DriveScoreGaugeProjection.FormatValue(value));

    [Theory]
    [InlineData(double.NaN, "0")]
    [InlineData(double.PositiveInfinity, "0")]
    public void FormatValue_coerces_non_finite_to_zero(double value, string expected) =>
        Assert.Equal(expected, DriveScoreGaugeProjection.FormatValue(value));

    // ---- Size / footprint flags (web isCompact / isTall / gauge diameter) ----------

    [Theory]
    [InlineData(1, 1, true, false, 70)]    // compact 1x1 -> 70px, no stats, no bars
    [InlineData(1, 2, false, true, 100)]   // default -> 100px, stats + bars
    [InlineData(2, 1, false, false, 100)]  // wide-short -> stats, no bars
    [InlineData(2, 2, false, true, 100)]
    public void Size_flags_match_web(int cols, int rows, bool compact, bool tall, double diameter)
    {
        var size = new DriveScoreGaugeSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(tall, size.IsTall);
        Assert.Equal(diameter, size.GaugeDiameter);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_standard_formats_value_grade_and_metrics()
    {
        var view = DriveScoreGaugeProjection.Project(
            new DriveScore(72, 90, 50, 30, "B"), new DriveScoreGaugeSize(1, 2), Localizer);

        Assert.Equal(72, view.Value);
        Assert.Equal(100, view.Max);
        Assert.Equal("72", view.ValueText);
        Assert.Equal("Weekly score", view.Unit);
        Assert.Equal("B", view.GradeLabel);
        Assert.Equal(StatusKind.Info, view.Status); // 72 -> good/cyan
        Assert.False(view.IsCompact);
        Assert.True(view.IsTall);
        Assert.True(view.ShowStats);
        Assert.True(view.ShowBars);
        Assert.Equal(100, view.GaugeDiameter);

        Assert.Equal(3, view.Metrics.Count);
        Assert.Equal("Efficiency", view.Metrics[0].Label);
        Assert.Equal(StatusKind.Success, view.Metrics[0].Status);  // 90
        Assert.Equal("Smoothness", view.Metrics[1].Label);
        Assert.Equal(StatusKind.Warning, view.Metrics[1].Status);  // 50
        Assert.Equal("Speed Discipline", view.Metrics[2].Label);
        Assert.Equal(StatusKind.Danger, view.Metrics[2].Status);   // 30
    }

    [Fact]
    public void Project_compact_hides_stats_and_bars_and_shrinks_gauge()
    {
        var view = DriveScoreGaugeProjection.Project(
            new DriveScore(85, 80, 80, 80, "A"), new DriveScoreGaugeSize(1, 1), Localizer);

        Assert.True(view.IsCompact);
        Assert.False(view.ShowStats);
        Assert.False(view.ShowBars);
        Assert.Equal(70, view.GaugeDiameter);
        Assert.Equal(StatusKind.Success, view.Status); // 85 -> excellent
    }

    [Fact]
    public void Project_wide_short_shows_stats_but_not_bars()
    {
        var view = DriveScoreGaugeProjection.Project(
            new DriveScore(55, 50, 60, 55, "C"), new DriveScoreGaugeSize(2, 1), Localizer);

        Assert.False(view.IsCompact);
        Assert.False(view.IsTall);
        Assert.True(view.ShowStats);
        Assert.False(view.ShowBars);
    }

    [Fact]
    public void Project_clamps_value_into_zero_hundred()
    {
        var over = DriveScoreGaugeProjection.Project(
            new DriveScore(150, 0, 0, 0, "A+"), new DriveScoreGaugeSize(1, 2), Localizer);
        Assert.Equal(100, over.Value);
        Assert.Equal("100", over.ValueText);

        var under = DriveScoreGaugeProjection.Project(
            new DriveScore(-10, 0, 0, 0, "F"), new DriveScoreGaugeSize(1, 2), Localizer);
        Assert.Equal(0, under.Value);
        Assert.Equal("0", under.ValueText);
    }

    [Fact]
    public void Project_missing_grade_falls_back_to_em_dash()
    {
        var view = DriveScoreGaugeProjection.Project(
            new DriveScore(72, 0, 0, 0, ""), new DriveScoreGaugeSize(1, 2), Localizer);

        Assert.Equal("\u2014", view.GradeLabel);
    }

    [Fact]
    public void Project_clamps_metric_values_into_zero_hundred()
    {
        var view = DriveScoreGaugeProjection.Project(
            new DriveScore(50, 150, -20, 50, "C"), new DriveScoreGaugeSize(1, 2), Localizer);

        Assert.Equal(100, view.Metrics[0].Value);
        Assert.Equal("100", view.Metrics[0].ValueText);
        Assert.Equal(0, view.Metrics[1].Value);
        Assert.Equal("0", view.Metrics[1].ValueText);
    }

    [Fact]
    public void Project_has_non_empty_accessibility_name_containing_value_and_grade()
    {
        var view = DriveScoreGaugeProjection.Project(
            new DriveScore(64, 0, 0, 0, "B"), new DriveScoreGaugeSize(1, 2), Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.GaugeAutomationName));
        Assert.Contains(view.ValueText, view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.GradeLabel, view.GaugeAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_every_metric_has_a_localized_label()
    {
        var view = DriveScoreGaugeProjection.Project(
            new DriveScore(50, 50, 50, 50, "C"), new DriveScoreGaugeSize(1, 2), Localizer);

        Assert.All(view.Metrics, m => Assert.False(string.IsNullOrWhiteSpace(m.Label)));
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"overall":62,"grade":"B","speed_discipline":55}""");

        var cached = DriveScoreGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(62, cached.Value!.Overall);
        Assert.Equal("B", cached.Value.Grade);

        var offline = DriveScoreGaugeResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(62, offline.Value!.Overall);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"overall":40,"grade":"D"}""");

        Assert.Equal(LoadStatus.Loaded, DriveScoreGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, DriveScoreGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, DriveScoreGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_non_object_loaded_body_to_empty()
    {
        // A successful response whose body is not an object makes score undefined -> the empty surface.
        using var doc = JsonDocument.Parse("[]");

        var mapped = DriveScoreGaugeResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DriveScore>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DriveScoreGaugeState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauge_display()
    {
        using var vm = NewViewModel(Loaded(new DriveScore(82, 90, 80, 76, "A")));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreGaugeState.Loaded, vm.State);
        Assert.True(vm.HasScore);
        Assert.NotNull(vm.Display);
        Assert.Equal(82, vm.Display!.Value);
        Assert.Equal(StatusKind.Success, vm.Display.Status);
        Assert.Equal("A", vm.Display.GradeLabel);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<DriveScore>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreGaugeState.Empty, vm.State);
        Assert.False(vm.HasScore);
        Assert.Null(vm.Display);
        Assert.Equal("No score yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DriveScore>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreGaugeState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<DriveScore>.Cached(new DriveScore(55, 50, 60, 55, "C"), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreGaugeState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasScore);
        Assert.Equal(StatusKind.Warning, vm.Display!.Status); // 55 is in [40,60) -> fair/amber
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<DriveScore>.OfflineCached(
            new DriveScore(35, 30, 40, 35, "D"), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreGaugeState.Offline, vm.State);
        Assert.True(vm.HasScore);
        Assert.True(vm.IsStale);
        Assert.Equal(StatusKind.Danger, vm.Display!.Status); // 35 -> red
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DriveScore>.Loading(),
            RepositoryResult<DriveScore>.Cached(new DriveScore(60, 60, 60, 60, "B"), Now, stale: false),
            RepositoryResult<DriveScore>.Loaded(new DriveScore(72, 80, 65, 50, "B"), Now));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreGaugeState.Loaded, vm.State);
        Assert.Equal("72", vm.Display!.ValueText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(DriveScoreGaugeSize.Default, Loaded(new DriveScore(72, 80, 65, 50, "B")));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display.ShowBars);

        vm.Size = new DriveScoreGaugeSize(1, 1);
        Assert.True(vm.Display!.IsCompact);
        Assert.False(vm.Display.ShowStats);
        Assert.False(vm.Display.ShowBars);
        Assert.Equal(70, vm.Display.GaugeDiameter);
        Assert.Equal(DriveScoreGaugeState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DriveScore>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Drive Score", vm.Title);
        Assert.Equal("No score yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new DriveScore(72, 80, 65, 50, "B")));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DriveScoreGaugeViewModel.State), changed);
        Assert.Contains(nameof(DriveScoreGaugeViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("drive-score-gauge", DriveScoreGaugeRegistration.Id);
        Assert.Equal("driving", DriveScoreGaugeRegistration.Category);
        Assert.Equal("DriveScoreGaugeWidget", DriveScoreGaugeRegistration.Slug);
        Assert.Equal(new DriveScoreGaugeSize(1, 2), DriveScoreGaugeRegistration.DefaultSize);
        Assert.Equal(new DriveScoreGaugeSize(1, 2), DriveScoreGaugeRegistration.MinSize);
        Assert.Equal(new DriveScoreGaugeSize(2, 40), DriveScoreGaugeRegistration.MaxSize);
        Assert.Equal("Drive Score Gauge", DriveScoreGaugeRegistration.Name(Localizer));
        Assert.Contains("smoothness", DriveScoreGaugeRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min == default
    [InlineData(2, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(3, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, DriveScoreGaugeRegistration.IsWithinBounds(new DriveScoreGaugeSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new DriveScoreGaugeSize(1, 2), DriveScoreGaugeRegistration.Clamp(new DriveScoreGaugeSize(0, 0)));
        Assert.Equal(new DriveScoreGaugeSize(2, 40), DriveScoreGaugeRegistration.Clamp(new DriveScoreGaugeSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DriveScoreGaugeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveScoreGaugeWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new DriveScoreGaugeSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_score_by_query()
    {
        using var doc = JsonDocument.Parse(
            """{"overall":72,"efficiency":80,"smoothness":65,"speed_discipline":50,"grade":"B"}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new DriveScoreGaugeSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(72, terminal.Value!.Overall);
        Assert.Equal("B", terminal.Value.Grade);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_drives_score", request.OperationId);
        Assert.Equal(7L, request.Query!["vehicle_id"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"overall":50,"grade":"C"}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new DriveScoreGaugeSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, request.Query!["vehicle_id"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new DriveScoreGaugeSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<DriveScore>>> Drain(IDriveScoreGaugeSource source)
    {
        var list = new List<RepositoryResult<DriveScore>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<DriveScore> Loaded(DriveScore score) =>
        RepositoryResult<DriveScore>.Loaded(score, Now);

    private static DriveScoreGaugeViewModel NewViewModel(params RepositoryResult<DriveScore>[] emissions) =>
        NewViewModel(DriveScoreGaugeSize.Default, emissions);

    private static DriveScoreGaugeViewModel NewViewModel(
        DriveScoreGaugeSize size,
        params RepositoryResult<DriveScore>[] emissions) =>
        new(new FakeDriveScoreGaugeSource(emissions), Localizer, size);

    private sealed class FakeDriveScoreGaugeSource(params RepositoryResult<DriveScore>[] emissions) : IDriveScoreGaugeSource
    {
        public async IAsyncEnumerable<RepositoryResult<DriveScore>> StreamAsync(
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
