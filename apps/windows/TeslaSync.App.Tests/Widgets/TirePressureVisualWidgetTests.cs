using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the TirePressureVisualWidget's UI-thread-free logic — the JSON parse adapter (the
/// useLatestTirePressure read), the colour-band classifier (getPressureStatus), the per-corner pressure
/// formatter, the relative reading-time formatter, the projection (four corners + status badge + footer), the
/// Narrator name, the result mapper, the single-endpoint per-vehicle data source (primary resolution + the
/// query-scoped tire read), the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/TirePressureVisualWidget.tsx).
/// </summary>
public sealed class TirePressureVisualWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private static readonly UnitPref BarPref = UnitPref.Metric with { Pressure = PressureUnit.Bar };

    private const string TireJson =
        """
        {"id":1,"vehicle_id":7,"front_left":2.4,"front_right":2.5,"rear_left":2.3,"rear_right":2.6,
         "last_seen_time_fl":"2026-06-06T12:00:00Z","last_seen_time_fr":"2026-06-06T12:00:00Z",
         "last_seen_time_rl":"2026-06-06T11:55:00Z","last_seen_time_rr":"2026-06-06T12:00:00Z",
         "created_at":"2026-06-06T12:00:00Z"}
        """;

    private const string WarningJson =
        """{"vehicle_id":7,"front_left":2.1,"front_right":2.5,"rear_left":2.3,"rear_right":2.6}""";

    // ---- Parse adapter (web useLatestTirePressure read) -----------------------------

    [Fact]
    public void FromResponse_reads_all_corner_fields()
    {
        using var doc = JsonDocument.Parse(TireJson);

        var reading = TirePressureReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(2.4, reading!.FrontLeft);
        Assert.Equal(2.5, reading.FrontRight);
        Assert.Equal(2.3, reading.RearLeft);
        Assert.Equal(2.6, reading.RearRight);
        Assert.Equal("2026-06-06T12:00:00Z", reading.LastSeenFrontLeft);
        Assert.Equal("2026-06-06T11:55:00Z", reading.LastSeenRearLeft);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_corners()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":7}""");

        var reading = TirePressureReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.FrontLeft);
        Assert.Null(reading.RearRight);
        Assert.Null(reading.LastSeenFrontLeft);
    }

    [Fact]
    public void FromResponse_treats_explicit_null_corners_as_null()
    {
        using var doc = JsonDocument.Parse("""{"front_left":null,"front_right":null,"rear_left":null,"rear_right":null}""");

        var reading = TirePressureReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.FrontLeft);
        Assert.Null(reading.FrontRight);
        Assert.Null(reading.RearLeft);
        Assert.Null(reading.RearRight);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(TirePressureReading.FromResponse(doc.RootElement));
    }

    // ---- Colour band (web getPressureStatus, bar thresholds) ------------------------

    [Theory]
    [InlineData(2.4, TirePressureLevel.Green)]   // mid band
    [InlineData(2.275, TirePressureLevel.Green)] // warnLow boundary (inclusive)
    [InlineData(2.896, TirePressureLevel.Green)] // warnHigh boundary (inclusive)
    [InlineData(2.2, TirePressureLevel.Amber)]   // below warnLow
    [InlineData(2.068, TirePressureLevel.Amber)] // dangerLow boundary -> amber
    [InlineData(3.0, TirePressureLevel.Amber)]   // above warnHigh
    [InlineData(3.103, TirePressureLevel.Amber)] // dangerHigh boundary -> amber
    [InlineData(2.0, TirePressureLevel.Red)]     // below dangerLow
    [InlineData(3.2, TirePressureLevel.Red)]     // above dangerHigh
    public void Level_matches_web_thresholds(double bar, TirePressureLevel expected) =>
        Assert.Equal(expected, TirePressureVisualProjection.Level(bar));

    [Fact]
    public void Level_null_is_red()
    {
        // Web parity: if (bar == null) return 'red'.
        Assert.Equal(TirePressureLevel.Red, TirePressureVisualProjection.Level(null));
    }

    [Theory]
    [InlineData(TirePressureLevel.Green, StatusKind.Success)]
    [InlineData(TirePressureLevel.Amber, StatusKind.Warning)]
    [InlineData(TirePressureLevel.Red, StatusKind.Danger)]
    public void LevelToStatus_maps_each_band(TirePressureLevel level, StatusKind expected) =>
        Assert.Equal(expected, TirePressureVisualProjection.LevelToStatus(level));

    // ---- Per-corner formatter (web fmtNumber(convertPressureFromSI(value, pref), 1)) -

    [Fact]
    public void FormatPressure_metric_reads_si_kilopascals_verbatim()
    {
        Assert.Equal("2.4", TirePressureVisualProjection.FormatPressure(2.4, UnitPref.Metric));
        Assert.Equal("240.0", TirePressureVisualProjection.FormatPressure(240, UnitPref.Metric));
    }

    [Fact]
    public void FormatPressure_bar_divides_by_one_hundred()
    {
        // Web parity: convertPressureFromSI(value, 'bar') = kPa / 100.
        Assert.Equal("2.4", TirePressureVisualProjection.FormatPressure(240, BarPref));
    }

    [Fact]
    public void FormatPressure_psi_converts_from_kilopascals()
    {
        // 240 kPa / 6.894757 = 34.8 psi.
        Assert.Equal("34.8", TirePressureVisualProjection.FormatPressure(240, UnitPref.Imperial));
    }

    [Theory]
    [InlineData(2.44, "2.4")]
    [InlineData(2.46, "2.5")]
    public void FormatPressure_rounds_to_one_digit(double raw, string expected) =>
        Assert.Equal(expected, TirePressureVisualProjection.FormatPressure(raw, UnitPref.Metric));

    [Fact]
    public void FormatPressure_null_is_em_dash() =>
        Assert.Equal("\u2014", TirePressureVisualProjection.FormatPressure(null, UnitPref.Metric));

    // ---- Relative reading time (web formatTimestamp) --------------------------------

    [Fact]
    public void FormatReadingTime_null_is_no_reading() =>
        Assert.Equal("No reading", TirePressureVisualProjection.FormatReadingTime(null, Now, Localizer));

    [Fact]
    public void FormatReadingTime_same_instant_is_just_now() =>
        Assert.Equal("Just now", TirePressureVisualProjection.FormatReadingTime("2026-06-06T12:05:00Z", Now, Localizer));

    [Fact]
    public void FormatReadingTime_future_is_just_now() =>
        Assert.Equal("Just now", TirePressureVisualProjection.FormatReadingTime("2026-06-06T12:10:00Z", Now, Localizer));

    [Theory]
    [InlineData("2026-06-06T12:00:00Z", "5m ago")]
    [InlineData("2026-06-06T11:05:00Z", "1h ago")]
    [InlineData("2026-06-06T10:05:00Z", "2h ago")]
    [InlineData("2026-06-04T12:05:00Z", "2d ago")]
    public void FormatReadingTime_rolls_up_by_window(string iso, string expected) =>
        Assert.Equal(expected, TirePressureVisualProjection.FormatReadingTime(iso, Now, Localizer));

    [Fact]
    public void FormatReadingTime_unparseable_is_em_dash() =>
        Assert.Equal("\u2014", TirePressureVisualProjection.FormatReadingTime("not-a-date", Now, Localizer));

    // ---- Most-recent timestamp (web filter(Boolean).sort().pop()) -------------------

    [Fact]
    public void LatestReadingTime_returns_the_chronological_max()
    {
        var reading = new TirePressureReading(
            null, null, null, null,
            "2026-06-06T11:00:00Z", "2026-06-06T12:00:00Z", "2026-06-06T10:00:00Z", null);

        Assert.Equal("2026-06-06T12:00:00Z", TirePressureVisualProjection.LatestReadingTime(reading));
    }

    [Fact]
    public void LatestReadingTime_null_when_no_corner_has_a_timestamp()
    {
        var reading = new TirePressureReading(2.4, 2.4, 2.4, 2.4, null, null, "", null);
        Assert.Null(TirePressureVisualProjection.LatestReadingTime(reading));
    }

    // ---- Projection (corners + badge + footer) -------------------------------------

    [Fact]
    public void Project_renders_four_green_corners_and_all_normal_badge()
    {
        var display = TirePressureVisualProjection.Project(Reading(), UnitPref.Metric, Localizer, Now);

        Assert.Equal("FL", display.FrontLeft.Label);
        Assert.Equal("2.4", display.FrontLeft.ValueText);
        Assert.Equal(TirePressureLevel.Green, display.FrontLeft.Level);
        Assert.Equal(StatusKind.Success, display.FrontLeft.Status);
        Assert.Equal("2.6", display.RearRight.ValueText);
        Assert.Equal(4, display.Corners.Count);

        Assert.True(display.AllNormal);
        Assert.Equal(StatusKind.Success, display.BadgeStatus);
        Assert.Equal("All Normal", display.BadgeText);
        Assert.Equal("kPa", display.UnitLabel);
        Assert.Equal("5m ago", display.ReadingText);
        Assert.Equal("kPa \u00B7 5m ago", display.FooterText);
    }

    [Fact]
    public void Project_flags_warning_when_a_corner_is_off_band()
    {
        using var doc = JsonDocument.Parse(WarningJson);
        var reading = TirePressureReading.FromResponse(doc.RootElement)!;

        var display = TirePressureVisualProjection.Project(reading, UnitPref.Metric, Localizer, Now);

        Assert.Equal(TirePressureLevel.Amber, display.FrontLeft.Level);
        Assert.Equal(StatusKind.Warning, display.FrontLeft.Status);
        Assert.False(display.AllNormal);
        Assert.Equal(StatusKind.Warning, display.BadgeStatus);
        Assert.Equal("Check Pressure", display.BadgeText);
    }

    [Fact]
    public void Project_em_dashes_and_reds_a_missing_corner()
    {
        var reading = new TirePressureReading(null, 2.4, 2.4, 2.4, null, null, null, null);

        var display = TirePressureVisualProjection.Project(reading, UnitPref.Metric, Localizer, Now);

        Assert.Equal("\u2014", display.FrontLeft.ValueText);
        Assert.Equal(TirePressureLevel.Red, display.FrontLeft.Level);
        Assert.Equal(StatusKind.Danger, display.FrontLeft.Status);
        Assert.False(display.AllNormal);
        Assert.Equal("Check Pressure", display.BadgeText);
        Assert.Equal("No reading", display.ReadingText);
    }

    [Fact]
    public void Project_honours_the_pressure_unit_preference()
    {
        var display = TirePressureVisualProjection.Project(Reading(), BarPref, Localizer, Now);

        Assert.Equal("bar", display.UnitLabel);
        Assert.Equal("bar \u00B7 5m ago", display.FooterText);
        // Web parity: the bar converter divides the SI kPa input by 100 (the same quirk the web reproduces).
        Assert.Equal("0.0", display.FrontLeft.ValueText);
    }

    // ---- Accessibility (Narrator name) ---------------------------------------------

    [Fact]
    public void Project_automation_name_summarises_corners_unit_and_badge()
    {
        var display = TirePressureVisualProjection.Project(Reading(), UnitPref.Metric, Localizer, Now);

        Assert.Equal("FL 2.4 kPa, FR 2.5 kPa, RL 2.3 kPa, RR 2.6 kPa, All Normal", display.AutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_reading()
    {
        using var doc = JsonDocument.Parse(TireJson);

        var cached = TirePressureVisualResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2.4, cached.Value!.FrontLeft);

        var offline = TirePressureVisualResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2.6, offline.Value!.RearRight);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(TireJson);

        Assert.Equal(LoadStatus.Loaded, TirePressureVisualResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, TirePressureVisualResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, TirePressureVisualResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_null_body_to_empty()
    {
        // Web parity: a successful response with no tire object (tireData == null) -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = TirePressureVisualResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TirePressureVisualState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_tire_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(TirePressureVisualState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.NotNull(vm.Display);
        Assert.Equal("2.4", vm.Display!.FrontLeft.ValueText);
        Assert.True(vm.Display.AllNormal);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TirePressureVisualState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("No tire pressure data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<TirePressureReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TirePressureVisualState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<TirePressureReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TirePressureVisualState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TirePressureVisualState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        var warning = new TirePressureReading(2.1, 2.5, 2.3, 2.6, null, null, null, null);
        using var vm = NewViewModel(
            RepositoryResult<TirePressureReading>.Loading(),
            RepositoryResult<TirePressureReading>.Cached(warning, Now, stale: false),
            RepositoryResult<TirePressureReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();

        Assert.Equal(TirePressureVisualState.Loaded, vm.State);
        Assert.True(vm.Display!.AllNormal);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_corner_values()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();
        Assert.Equal("2.4", vm.Display!.FrontLeft.ValueText);
        Assert.Equal("kPa", vm.Display.UnitLabel);

        vm.Units = BarPref; // 2.4 kPa / 100 = 0.0 bar (the web's same conversion quirk)
        Assert.Equal("0.0", vm.Display!.FrontLeft.ValueText);
        Assert.Equal("bar", vm.Display.UnitLabel);
        Assert.Equal(TirePressureVisualState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<TirePressureReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Tire Pressure", vm.Title);
        Assert.Equal("No tire pressure data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TirePressureVisualViewModel.State), changed);
        Assert.Contains(nameof(TirePressureVisualViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("tire-pressure-visual", TirePressureVisualRegistration.Id);
        Assert.Equal("tires", TirePressureVisualRegistration.Category);
        Assert.Equal("TirePressureVisualWidget", TirePressureVisualRegistration.Slug);
        Assert.Equal(new TirePressureVisualSize(2, 4), TirePressureVisualRegistration.DefaultSize);
        Assert.Equal(new TirePressureVisualSize(2, 4), TirePressureVisualRegistration.MinSize);
        Assert.Equal(new TirePressureVisualSize(4, 40), TirePressureVisualRegistration.MaxSize);
        Assert.Equal("Tire Pressure Visual", TirePressureVisualRegistration.Name(Localizer));
        Assert.Equal(
            "Four-tire diagram with pressure per tire, color-coded (green/amber/red)",
            TirePressureVisualRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 4, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 10, true)]   // inside
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(2, 3, false)]   // below min rows
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, TirePressureVisualRegistration.IsWithinBounds(new TirePressureVisualSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new TirePressureVisualSize(2, 4), TirePressureVisualRegistration.Clamp(new TirePressureVisualSize(0, 0)));
        Assert.Equal(new TirePressureVisualSize(4, 40), TirePressureVisualRegistration.Clamp(new TirePressureVisualSize(9, 99)));
    }

    [Theory]
    [InlineData(1, true)]   // cols <= 1 -> compact (web isCompact)
    [InlineData(0, true)]
    [InlineData(2, false)]
    public void Size_is_compact_below_two_columns(int cols, bool compact) =>
        Assert.Equal(compact, new TirePressureVisualSize(cols, 4).IsCompact);

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TirePressureVisualDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TirePressureVisualWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new TirePressureVisualSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_tire_pressure()
    {
        using var tire = JsonDocument.Parse(TireJson);
        var api = new FakeApiClient().ReturnsValue(tire.RootElement);
        var source = new TirePressureVisualSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2.4, terminal.Value!.FrontLeft);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_tire_pressure_latest", request.OperationId);
        Assert.Equal(7L, Assert.IsType<long>(request.Query!["vehicle_id"]));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var tire = JsonDocument.Parse(TireJson);
        var api = new FakeApiClient().ReturnsValue(tire.RootElement);
        var source = new TirePressureVisualSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(api.Requests[^1].Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(nullBody.RootElement);
        var source = new TirePressureVisualSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static TirePressureReading Reading() => new(
        2.4, 2.5, 2.3, 2.6,
        "2026-06-06T12:00:00Z", "2026-06-06T12:00:00Z", "2026-06-06T11:55:00Z", "2026-06-06T12:00:00Z");

    private static async Task<List<RepositoryResult<TirePressureReading>>> Drain(ITirePressureVisualSource source)
    {
        var list = new List<RepositoryResult<TirePressureReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<TirePressureReading> Loaded(TirePressureReading reading) =>
        RepositoryResult<TirePressureReading>.Loaded(reading, Now);

    private static TirePressureVisualViewModel NewViewModel(params RepositoryResult<TirePressureReading>[] emissions) =>
        new(new FakeTirePressureVisualSource(emissions), Localizer, TirePressureVisualSize.Default, units: null, clock: () => Now);

    private sealed class FakeTirePressureVisualSource(params RepositoryResult<TirePressureReading>[] emissions) : ITirePressureVisualSource
    {
        public async IAsyncEnumerable<RepositoryResult<TirePressureReading>> StreamAsync(
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
