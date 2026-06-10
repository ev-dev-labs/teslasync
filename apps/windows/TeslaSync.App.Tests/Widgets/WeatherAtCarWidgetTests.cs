using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the WeatherAtCarWidget's UI-thread-free logic — the JSON parse adapter (the
/// useVehicleState normalisation, shared with RangeBar/Geofence), the SI-Celsius → display-unit temperature
/// formatting, the condition-glyph selection from the SI Celsius value, the optional coordinate line, the web
/// <c>hasData = outsideTemp != null</c> gate, the cache-then-network result mapper, the per-vehicle data source
/// (primary resolution + path-scoped request + contract id), the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline +
/// size/units reprojection). Mirrors the web spec
/// (web/src/features/dashboard/widgets/WeatherAtCarWidget.tsx).
/// </summary>
public sealed class WeatherAtCarWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string Degree = "\u00B0";

    private static WeatherAtCarDisplay Project(WeatherAtCarReading reading, int cols, int rows, UnitPref? units = null) =>
        WeatherAtCarProjection.Project(reading, new WeatherAtCarSize(cols, rows), units ?? UnitPref.Metric, Localizer);

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_primary_state_object()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"outside_temp":15,"latitude":37.5,"longitude":-122.3},"live":true}""");

        var reading = WeatherAtCarReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(15, reading!.OutsideTempC);
        Assert.Equal(37.5, reading.Latitude);
        Assert.Equal(-122.3, reading.Longitude);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_outside_temp()
    {
        // Web parity: a state object present but with no outside_temp -> reading exists, OutsideTempC null
        // (the empty gate is then applied by the view-model, like hasData = outsideTemp != null).
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"latitude":1.0,"longitude":2.0}}""");

        var reading = WeatherAtCarReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.OutsideTempC);
        Assert.Equal(1.0, reading.Latitude);
        Assert.Equal(2.0, reading.Longitude);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_snapshot()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5},"position":{"outside_temp":3,"latitude":40.1,"longitude":-74.0}}""");

        var reading = WeatherAtCarReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(3, reading!.OutsideTempC);
        Assert.Equal(40.1, reading.Latitude);
        Assert.Equal(-74.0, reading.Longitude);
    }

    [Fact]
    public void FromResponse_position_fallback_defaults_missing_fields_to_zero()
    {
        // Web parity: outside_temp/latitude/longitude default to 0 in the synthesised fallback state.
        using var doc = JsonDocument.Parse("""{"vehicle":{"id":5},"position":{}}""");

        var reading = WeatherAtCarReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(0, reading!.OutsideTempC);
        Assert.Equal(0, reading.Latitude);
        Assert.Equal(0, reading.Longitude);
    }

    [Fact]
    public void FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"outside_temp":8,"latitude":51.5,"longitude":-0.1}}""");

        var reading = WeatherAtCarReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(8, reading!.OutsideTempC);
        Assert.Equal(51.5, reading.Latitude);
    }

    [Fact]
    public void FromResponse_parses_numeric_string_temp()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"outside_temp":"12.5"}}""");

        Assert.Equal(12.5, WeatherAtCarReading.FromResponse(doc.RootElement)!.OutsideTempC);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(WeatherAtCarReading.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(WeatherAtCarReading.FromResponse(doc.RootElement));
    }

    // ---- Size / footprint flags (web isCompact) ------------------------------------

    [Theory]
    [InlineData(1, 1, true)]   // compact 1x1
    [InlineData(1, 2, false)]  // min size / default
    [InlineData(2, 2, false)]
    [InlineData(3, 40, false)] // max
    public void Size_compact_flag_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new WeatherAtCarSize(cols, rows).IsCompact);

    // ---- Projection (web convertTempFromSI + WeatherIcon) --------------------------

    [Fact]
    public void Project_standard_metric_formats_temperature()
    {
        var view = Project(new WeatherAtCarReading(15, 37.5, -122.3), 1, 2);

        Assert.True(view.HasData);
        Assert.False(view.IsCompact);
        Assert.Equal("15" + Degree + "C", view.TemperatureText);
        Assert.Equal("Outside Temperature", view.OutsideLabel);
    }

    [Fact]
    public void Project_imperial_converts_to_fahrenheit()
    {
        var view = Project(new WeatherAtCarReading(15, 37.5, -122.3), 1, 2, UnitPref.Imperial);

        // 15 C -> (15 * 9/5) + 32 = 59 F
        Assert.Equal("59" + Degree + "F", view.TemperatureText);
    }

    [Theory]
    [InlineData(-5.0)]
    [InlineData(0.0)]
    public void Project_cold_uses_snow_icon(double celsius) =>
        Assert.Equal(WeatherAtCarProjection.SnowGlyph, Project(new WeatherAtCarReading(celsius, null, null), 1, 2).ConditionGlyph);

    [Theory]
    [InlineData(0.1)]
    [InlineData(10.0)]
    [InlineData(24.9)]
    public void Project_mild_uses_cloud_sun_icon(double celsius) =>
        Assert.Equal(WeatherAtCarProjection.CloudSunGlyph, Project(new WeatherAtCarReading(celsius, null, null), 1, 2).ConditionGlyph);

    [Theory]
    [InlineData(25.0)]
    [InlineData(33.0)]
    public void Project_warm_uses_sun_icon(double celsius) =>
        Assert.Equal(WeatherAtCarProjection.SunGlyph, Project(new WeatherAtCarReading(celsius, null, null), 1, 2).ConditionGlyph);

    [Fact]
    public void Project_shows_coordinates_in_standard_with_fix()
    {
        var view = Project(new WeatherAtCarReading(15, 37.5, -122.3), 1, 2);

        Assert.True(view.ShowCoordinates);
        Assert.Equal("37.50" + Degree + ", -122.30" + Degree, view.CoordinatesText);
    }

    [Fact]
    public void Project_hides_coordinates_in_compact()
    {
        // Web parity: the compact JSX never renders the coordinate line.
        var view = Project(new WeatherAtCarReading(15, 37.5, -122.3), 1, 1);

        Assert.True(view.IsCompact);
        Assert.False(view.ShowCoordinates);
        Assert.Equal(string.Empty, view.CoordinatesText);
    }

    [Fact]
    public void Project_hides_coordinates_when_fix_missing()
    {
        // Web parity: state?.latitude != null && state?.longitude != null.
        Assert.False(Project(new WeatherAtCarReading(15, null, -122.3), 1, 2).ShowCoordinates);
        Assert.False(Project(new WeatherAtCarReading(15, 37.5, null), 1, 2).ShowCoordinates);
    }

    [Fact]
    public void Project_zero_coordinates_are_shown()
    {
        // Web parity: the position fallback yields 0/0 fixes which are non-null and therefore rendered.
        var view = Project(new WeatherAtCarReading(3, 0, 0), 1, 2);

        Assert.True(view.ShowCoordinates);
        Assert.Equal("0.00" + Degree + ", 0.00" + Degree, view.CoordinatesText);
    }

    [Fact]
    public void Project_no_temperature_is_empty()
    {
        var view = Project(new WeatherAtCarReading(null, 37.5, -122.3), 1, 2);

        Assert.False(view.HasData);
        Assert.False(view.ShowCoordinates);
    }

    [Fact]
    public void Project_zero_celsius_is_data_with_snow_icon()
    {
        // Web parity: hasData = outsideTemp != null, so 0 C is real data, and tempC <= 0 picks the snow icon.
        var view = Project(new WeatherAtCarReading(0, null, null), 1, 2);

        Assert.True(view.HasData);
        Assert.Equal("0" + Degree + "C", view.TemperatureText);
        Assert.Equal(WeatherAtCarProjection.SnowGlyph, view.ConditionGlyph);
    }

    [Fact]
    public void Project_non_finite_temperature_is_empty()
    {
        Assert.False(Project(new WeatherAtCarReading(double.NaN, null, null), 1, 2).HasData);
        Assert.False(Project(new WeatherAtCarReading(double.PositiveInfinity, null, null), 1, 2).HasData);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_standard_accessibility_name_includes_temperature_and_coordinates()
    {
        var view = Project(new WeatherAtCarReading(15, 37.5, -122.3), 1, 2);

        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
        Assert.Contains(view.TemperatureText, view.AutomationName, StringComparison.Ordinal);
        Assert.Contains(view.OutsideLabel, view.AutomationName, StringComparison.Ordinal);
        Assert.Contains(view.CoordinatesText, view.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_accessibility_name_includes_temperature()
    {
        var view = Project(new WeatherAtCarReading(15, null, null), 1, 1);

        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
        Assert.Contains(view.TemperatureText, view.AutomationName, StringComparison.Ordinal);
    }

    // ---- Formatter helpers ---------------------------------------------------------

    [Fact]
    public void FormatTemperature_metric_and_imperial_and_null()
    {
        Assert.Equal("21" + Degree + "C", WeatherAtCarProjection.FormatTemperature(21, UnitPref.Metric));
        Assert.Equal("70" + Degree + "F", WeatherAtCarProjection.FormatTemperature(21.11, UnitPref.Imperial));
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, WeatherAtCarProjection.FormatTemperature(null, UnitPref.Metric));
        Assert.Equal(UnitFormatters.DefaultEmptyDisplay, WeatherAtCarProjection.FormatTemperature(double.NaN, UnitPref.Metric));
    }

    [Theory]
    [InlineData(-0.01, WeatherAtCarProjection.SnowGlyph)]
    [InlineData(0.0, WeatherAtCarProjection.SnowGlyph)]
    [InlineData(12.0, WeatherAtCarProjection.CloudSunGlyph)]
    [InlineData(24.999, WeatherAtCarProjection.CloudSunGlyph)]
    [InlineData(25.0, WeatherAtCarProjection.SunGlyph)]
    public void ConditionGlyphFor_matches_web(double celsius, string glyph) =>
        Assert.Equal(glyph, WeatherAtCarProjection.ConditionGlyphFor(celsius));

    [Fact]
    public void FormatCoordinates_matches_web_toFixed2()
    {
        Assert.Equal("37.50" + Degree + ", -122.30" + Degree, WeatherAtCarProjection.FormatCoordinates(37.5, -122.3));
        Assert.Equal("0.00" + Degree + ", 0.00" + Degree, WeatherAtCarProjection.FormatCoordinates(0, 0));
        Assert.Equal("51.51" + Degree + ", -0.13" + Degree, WeatherAtCarProjection.FormatCoordinates(51.5074, -0.1278));
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":1,"outside_temp":15,"latitude":1,"longitude":2}}""");

        var cached = WeatherAtCarResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(15, cached.Value!.OutsideTempC);

        var offline = WeatherAtCarResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(1, offline.Value!.Latitude);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"outside_temp":9}}""");

        Assert.Equal(LoadStatus.Loaded, WeatherAtCarResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, WeatherAtCarResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, WeatherAtCarResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_stateless_loaded_body_to_empty()
    {
        // Web parity: a successful response with no `state` makes stateData?.state undefined -> empty surface.
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = WeatherAtCarResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<WeatherAtCarReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(WeatherAtCarState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(new WeatherAtCarReading(15, 37.5, -122.3)));
        await vm.LoadAsync();

        Assert.Equal(WeatherAtCarState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("15" + Degree + "C", vm.Display!.TemperatureText);
        Assert.True(vm.Display.ShowCoordinates);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<WeatherAtCarReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(WeatherAtCarState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No weather data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_no_temperature_state_gates_to_empty()
    {
        // Web parity: state present but outside_temp null -> hasData false -> empty surface.
        using var vm = NewViewModel(Loaded(new WeatherAtCarReading(null, 37.5, -122.3)));
        await vm.LoadAsync();

        Assert.Equal(WeatherAtCarState.Empty, vm.State);
        Assert.Null(vm.Display);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<WeatherAtCarReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(WeatherAtCarState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<WeatherAtCarReading>.Cached(new WeatherAtCarReading(15, 37.5, -122.3), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(WeatherAtCarState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal("15" + Degree + "C", vm.Display!.TemperatureText);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<WeatherAtCarReading>.OfflineCached(
            new WeatherAtCarReading(15, 37.5, -122.3), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(WeatherAtCarState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<WeatherAtCarReading>.Loading(),
            RepositoryResult<WeatherAtCarReading>.Cached(new WeatherAtCarReading(10, 1, 2), Now, stale: false),
            RepositoryResult<WeatherAtCarReading>.Loaded(new WeatherAtCarReading(15, 37.5, -122.3), Now));
        await vm.LoadAsync();

        Assert.Equal(WeatherAtCarState.Loaded, vm.State);
        Assert.Equal("15" + Degree + "C", vm.Display!.TemperatureText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(WeatherAtCarSize.Default, null, Loaded(new WeatherAtCarReading(15, 37.5, -122.3)));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display.ShowCoordinates);

        vm.Size = new WeatherAtCarSize(1, 1);
        Assert.True(vm.Display!.IsCompact);
        Assert.False(vm.Display.ShowCoordinates);
        Assert.Equal(WeatherAtCarState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_display()
    {
        using var vm = NewViewModel(WeatherAtCarSize.Default, UnitPref.Metric, Loaded(new WeatherAtCarReading(15, 37.5, -122.3)));
        await vm.LoadAsync();
        Assert.Equal("15" + Degree + "C", vm.Display!.TemperatureText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("59" + Degree + "F", vm.Display!.TemperatureText);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<WeatherAtCarReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Weather at Car", vm.Title);
        Assert.Equal("No weather data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new WeatherAtCarReading(15, 37.5, -122.3)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(WeatherAtCarViewModel.State), changed);
        Assert.Contains(nameof(WeatherAtCarViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("weather-at-car", WeatherAtCarRegistration.Id);
        Assert.Equal("climate", WeatherAtCarRegistration.Category);
        Assert.Equal("WeatherAtCarWidget", WeatherAtCarRegistration.Slug);
        Assert.Equal(new WeatherAtCarSize(1, 2), WeatherAtCarRegistration.DefaultSize);
        Assert.Equal(new WeatherAtCarSize(1, 2), WeatherAtCarRegistration.MinSize);
        Assert.Equal(new WeatherAtCarSize(3, 40), WeatherAtCarRegistration.MaxSize);
        Assert.Equal("Weather at Car", WeatherAtCarRegistration.Name(Localizer));
        Assert.Contains("weather", WeatherAtCarRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min / default
    [InlineData(2, 4, true)]
    [InlineData(3, 40, true)]   // max
    [InlineData(4, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, WeatherAtCarRegistration.IsWithinBounds(new WeatherAtCarSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new WeatherAtCarSize(1, 2), WeatherAtCarRegistration.Clamp(new WeatherAtCarSize(0, 0)));
        Assert.Equal(new WeatherAtCarSize(3, 40), WeatherAtCarRegistration.Clamp(new WeatherAtCarSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WeatherAtCarDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WeatherAtCarWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new WeatherAtCarSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_state_by_path()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"outside_temp":15,"latitude":37.5,"longitude":-122.3}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new WeatherAtCarSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(15, terminal.Value!.OutsideTempC);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":42,"outside_temp":9}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new WeatherAtCarSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_stateless_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"live":false}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new WeatherAtCarSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_state_without_temperature_is_not_collapsed_by_the_source()
    {
        // The source preserves a state with no outside_temp (the empty gate is the view-model's job).
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":3,"latitude":1,"longitude":2}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new WeatherAtCarSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Null(terminal.Value!.OutsideTempC);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<WeatherAtCarReading>>> Drain(IWeatherAtCarSource source)
    {
        var list = new List<RepositoryResult<WeatherAtCarReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<WeatherAtCarReading> Loaded(WeatherAtCarReading reading) =>
        RepositoryResult<WeatherAtCarReading>.Loaded(reading, Now);

    private static WeatherAtCarViewModel NewViewModel(params RepositoryResult<WeatherAtCarReading>[] emissions) =>
        NewViewModel(WeatherAtCarSize.Default, null, emissions);

    private static WeatherAtCarViewModel NewViewModel(
        WeatherAtCarSize size,
        UnitPref? units,
        params RepositoryResult<WeatherAtCarReading>[] emissions) =>
        new(new FakeWeatherAtCarSource(emissions), Localizer, size, units);

    private sealed class FakeWeatherAtCarSource(params RepositoryResult<WeatherAtCarReading>[] emissions) : IWeatherAtCarSource
    {
        public async IAsyncEnumerable<RepositoryResult<WeatherAtCarReading>> StreamAsync(
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
