using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Motor-Torque history surface's UI-thread-free logic — the motor-history JSON
/// parse adapter (the ts read + the torque_nm_front ?? torque_nm_rear fallback), the projection (the
/// formatTime label, the raw SI torque kept un-converted, the per-point text + Narrator name, and the web
/// <c>data.length &gt; 1 &amp;&amp; data.some(d =&gt; d.torque !== null)</c> render gate), the cache-then-network
/// result mapper, the per-vehicle data source (primary resolution + query-scoped request incl. the limit
/// window + disabled-when-no-vehicle short-circuit), the registry metadata, the PII-safe diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx +
/// pages/DrivetrainHealthPage.tsx).
/// </summary>
public sealed class TorqueHistoryChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_ts_and_front_torque()
    {
        using var doc = JsonDocument.Parse(
            """{"ts":"2026-04-04T10:00:00Z","torque_nm_front":300,"torque_nm_rear":120}""");

        var sample = MotorTorqueSample.FromJson(doc.RootElement);

        Assert.Equal("2026-04-04T10:00:00Z", sample.Ts);
        Assert.Equal(300, sample.TorqueNm); // front wins over rear
    }

    [Fact]
    public void FromJson_torque_falls_back_to_rear_when_front_absent_or_null()
    {
        using var front = JsonDocument.Parse("""{"ts":"2026-04-04T10:00:00Z","torque_nm_rear":150}""");
        Assert.Equal(150, MotorTorqueSample.FromJson(front.RootElement).TorqueNm);

        using var nullFront = JsonDocument.Parse("""{"torque_nm_front":null,"torque_nm_rear":75}""");
        Assert.Equal(75, MotorTorqueSample.FromJson(nullFront.RootElement).TorqueNm);
    }

    [Fact]
    public void FromJson_defaults_missing_fields_to_null()
    {
        using var doc = JsonDocument.Parse("""{"id":7}""");

        var sample = MotorTorqueSample.FromJson(doc.RootElement);

        Assert.Null(sample.Ts);
        Assert.Null(sample.TorqueNm);
    }

    [Fact]
    public void FromJson_parses_numeric_string_torque()
    {
        using var doc = JsonDocument.Parse("""{"torque_nm_front":"275.5"}""");

        Assert.Equal(275.5, MotorTorqueSample.FromJson(doc.RootElement).TorqueNm);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse(
            """[{"torque_nm_front":100}, 7, {"torque_nm_front":200}]""");

        var list = MotorTorqueSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(100, list[0].TorqueNm);
        Assert.Equal(200, list[1].TorqueNm);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"torque_nm_front":100}""");
        Assert.Empty(MotorTorqueSample.ParseList(doc.RootElement));
    }

    // ---- Projection (time / torque / gate) -----------------------------------------

    [Fact]
    public void Project_preserves_order_and_count_of_samples()
    {
        var display = Project(
            Sample("2026-04-04T10:00:00Z", 100),
            Sample("2026-04-04T10:00:05Z", 200),
            Sample("2026-04-04T10:00:10Z", 300));

        Assert.Equal(3, display.Points.Count);
        Assert.Equal(new double?[] { 100, 200, 300 }, display.Points.Select(p => p.TorqueNm).ToArray());
    }

    [Fact]
    public void Project_keeps_torque_as_raw_si_newton_metres_without_conversion()
    {
        var display = Project(Sample("2026-04-04T10:00:00Z", 412), Sample("2026-04-04T10:00:05Z", 88));

        Assert.Equal(412, display.Points[0].TorqueNm);
        Assert.Equal("412", display.Points[0].TorqueText);
        Assert.Equal("88", display.Points[1].TorqueText);
    }

    [Fact]
    public void Project_formats_time_label_for_valid_ts_and_empties_missing_ts()
    {
        var display = Project(Sample("2026-04-04T10:00:00Z", 100), Sample(null, 200));

        Assert.False(string.IsNullOrEmpty(display.Points[0].TimeLabel)); // some locale-aware clock label
        Assert.Equal(string.Empty, display.Points[1].TimeLabel);
    }

    [Fact]
    public void Project_null_torque_renders_em_dash_text_and_stays_a_gap()
    {
        var display = Project(Sample("2026-04-04T10:00:00Z", 100), Sample("2026-04-04T10:00:05Z", null));

        Assert.Null(display.Points[1].TorqueNm);
        Assert.Equal("\u2014", display.Points[1].TorqueText);
    }

    [Fact]
    public void Project_gate_false_for_one_or_fewer_samples()
    {
        // web: data.length <= 1 → return null
        Assert.False(Project(Sample("2026-04-04T10:00:00Z", 300)).HasData);
        Assert.False(SimpleProject().HasData);
    }

    [Fact]
    public void Project_gate_false_when_no_sample_has_torque()
    {
        // web: !data.some(d => d.torque !== null) → return null
        var display = Project(Sample("2026-04-04T10:00:00Z", null), Sample("2026-04-04T10:00:05Z", null));

        Assert.False(display.HasData);
    }

    [Fact]
    public void Project_gate_true_with_two_samples_and_one_torque_reading()
    {
        var display = Project(Sample("2026-04-04T10:00:00Z", null), Sample("2026-04-04T10:00:05Z", 300));

        Assert.True(display.HasData);
    }

    [Fact]
    public void Project_exposes_localized_chrome_series_and_column_labels()
    {
        var display = Project(Sample("2026-04-04T10:00:00Z", 100), Sample("2026-04-04T10:00:05Z", 200));

        Assert.Equal("Motor Torque", display.Title);
        Assert.Equal("Drive inverter torque output over time", display.Subtitle);
        Assert.Equal("Motor inverter torque output history area chart", display.ChartAriaLabel);
        Assert.Equal("Torque (Nm)", display.SeriesLabel);
        Assert.Equal("Torque (Nm)", display.AxisLabel);
        Assert.Equal("Time", display.TimeColumnLabel);
        Assert.Equal("Torque (Nm)", display.TorqueColumnLabel);
    }

    [Fact]
    public void Project_row_automation_name_carries_time_torque_and_unit()
    {
        // A missing ts gives a deterministic em-dash time label (tz-independent assertion).
        var withTorque = Project(Sample(null, 300), Sample(null, 120)).Points[0];
        Assert.Equal("\u2014: 300 Nm", withTorque.AutomationName);

        var withoutTorque = Project(Sample(null, null), Sample(null, 50)).Points[0];
        Assert.Equal("\u2014: \u2014", withoutTorque.AutomationName);
    }

    [Fact]
    public void Project_series_color_index_mirrors_web_cyan_stroke()
    {
        Assert.Equal(0, TorqueHistoryChartProjection.SeriesColorIndex);
        Assert.Equal(0d, TorqueHistoryChartProjection.ReferenceLineValue);
        Assert.Equal("Nm", TorqueHistoryChartProjection.TorqueUnit);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"ts":"2026-04-04T10:00:00Z","torque_nm_front":300}]""");
        var cached = RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true);

        var mapped = TorqueHistoryChartResultMapper.Map(cached);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Equal(300, Assert.Single(mapped.Value!).TorqueNm);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loaded, TorqueHistoryChartResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(EmptyArray(), Now)).Status);

        Assert.Equal(LoadStatus.Empty, TorqueHistoryChartResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        var failure = TorqueHistoryChartResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.Equal(RepositoryErrorKind.Server, failure.Error!.Kind);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new TorqueHistoryChartViewModel(new FakeSource(), Localizer);
        Assert.Equal(TorqueHistoryChartState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_chart_points()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loaded(
            Samples(Sample("2026-04-04T10:00:00Z", 100), Sample("2026-04-04T10:00:05Z", 300)), Now));

        await vm.LoadAsync();

        Assert.Equal(TorqueHistoryChartState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(2, vm.Display.Points.Count);
    }

    [Fact]
    public async Task ViewModel_loaded_but_below_gate_renders_empty()
    {
        // Two samples but neither carries a torque reading → web returns null → native empty.
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loaded(
            Samples(Sample("2026-04-04T10:00:00Z", null), Sample("2026-04-04T10:00:05Z", null)), Now));

        await vm.LoadAsync();

        Assert.Equal(TorqueHistoryChartState.Empty, vm.State);
        Assert.False(vm.Display.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_single_sample_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loaded(
            Samples(Sample("2026-04-04T10:00:00Z", 300)), Now));

        await vm.LoadAsync();

        Assert.Equal(TorqueHistoryChartState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_explicit_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(TorqueHistoryChartState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(TorqueHistoryChartState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Cached(
            Samples(Sample("2026-04-04T10:00:00Z", 100), Sample("2026-04-04T10:00:05Z", 300)), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(TorqueHistoryChartState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.OfflineCached(
            Samples(Sample("2026-04-04T10:00:00Z", 100), Sample("2026-04-04T10:00:05Z", 300)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(TorqueHistoryChartState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        var samples = Samples(Sample("2026-04-04T10:00:00Z", 100), Sample("2026-04-04T10:00:05Z", 300));
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loading(),
            RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Cached(samples, Now, stale: false),
            RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loaded(samples, Now));

        await vm.LoadAsync();

        Assert.Equal(TorqueHistoryChartState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Points.Count);
    }

    [Fact]
    public async Task ViewModel_retry_increments_attempts()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loaded(
            Samples(Sample("2026-04-04T10:00:00Z", 100), Sample("2026-04-04T10:00:05Z", 300)), Now));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(TorqueHistoryChartState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Loaded(
            Samples(Sample("2026-04-04T10:00:00Z", 100), Sample("2026-04-04T10:00:05Z", 300)), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TorqueHistoryChartViewModel.State), changed);
        Assert.Contains(nameof(TorqueHistoryChartViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MotorTorqueSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Motor Torque", vm.Title);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.LoadingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RetryLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.RefreshLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.StaleChip));
        Assert.False(string.IsNullOrWhiteSpace(vm.OfflineChip));
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_scopes_request_with_limit()
    {
        using var doc = JsonDocument.Parse(
            """[{"ts":"2026-04-04T10:00:00Z","torque_nm_front":300}]""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, vehicleId: null, primary: new WidgetVehicleSnapshot { VehicleId = 7 });

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Single(emissions[^1].Value!);
        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_motor", request.OperationId);
        Assert.Equal(7L, (long)request.Query!["vehicle_id"]!);
        Assert.Equal(TorqueHistoryChartSource.DefaultLimit, (int)request.Query!["limit"]!);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"ts":"2026-04-04T10:00:00Z","torque_nm_front":120}]""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client, vehicleId: 42, primary: null);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(42L, (long)client.Requests[^1].Query!["vehicle_id"]!);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_treats_an_empty_array_as_empty()
    {
        var client = new FakeApiClient().ReturnsValue(EmptyArray());
        var source = NewSource(client, vehicleId: 7);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_without_a_vehicle_short_circuits_to_empty_without_calling_the_api()
    {
        var client = new FakeApiClient();
        var source = NewSource(client, vehicleId: null, primary: null);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, Assert.Single(emissions).Status);
        Assert.Empty(client.Requests);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_title()
    {
        Assert.Equal("torque-history-chart", TorqueHistoryChartRegistration.Id);
        Assert.Equal("TorqueHistoryChart", TorqueHistoryChartRegistration.Slug);
        Assert.Equal("Motor Torque", TorqueHistoryChartRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TorqueHistoryChartDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TorqueHistoryChart", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static MotorTorqueSample Sample(string? ts, double? torqueNm) => new(ts, torqueNm);

    private static IReadOnlyList<MotorTorqueSample> Samples(params MotorTorqueSample[] samples) => samples;

    private static TorqueHistoryChartDisplay Project(params MotorTorqueSample[] samples) =>
        TorqueHistoryChartProjection.Project(samples, Localizer);

    private static TorqueHistoryChartDisplay SimpleProject() =>
        TorqueHistoryChartProjection.Project(Array.Empty<MotorTorqueSample>(), Localizer);

    private static JsonElement EmptyArray()
    {
        using var doc = JsonDocument.Parse("[]");
        return doc.RootElement.Clone();
    }

    private static TorqueHistoryChartViewModel NewViewModel(
        params RepositoryResult<IReadOnlyList<MotorTorqueSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer);

    private static TorqueHistoryChartSource NewSource(
        IApiClient client, long? vehicleId, WidgetVehicleSnapshot? primary = null)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new TorqueHistoryChartSource(new FakeWidgetVehicleSource(primary), client, engine, options, vehicleId);
    }

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<MotorTorqueSample>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<MotorTorqueSample>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<MotorTorqueSample>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<MotorTorqueSample>>[] emissions)
        : ITorqueHistoryChartSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MotorTorqueSample>>> StreamAsync(
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
