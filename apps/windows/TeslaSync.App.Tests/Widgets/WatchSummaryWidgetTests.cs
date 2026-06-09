using System.Globalization;
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
/// Headless verification of the WatchSummaryWidget's UI-thread-free logic — the JSON parse adapters (the
/// useWatchSummary / useWatchComplication slices), the battery-colour threshold helper, the vehicle-state dot
/// palette, the unit-aware projection across the compact watch face and the standard hero + detail grid, the
/// two-source result combiner, the always-on per-vehicle data source, the registry metadata, the diagnostics,
/// and the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline). Mirrors the web spec (web/src/features/dashboard/widgets/WatchSummaryWidget.tsx).
/// </summary>
public sealed class WatchSummaryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string FullSummaryJson =
        """{"battery_level":72,"range_km":320,"state":"online","is_locked":true,"inside_temp_c":21,"last_updated":"2026-06-06T12:00:00Z"}""";

    // ---- Summary parse adapter (web useWatchSummary slice) --------------------------

    [Fact]
    public void SummaryFromResponse_reads_every_field()
    {
        using var doc = JsonDocument.Parse(FullSummaryJson);

        var data = WatchSummaryData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(72, data!.BatteryLevel);
        Assert.Equal(320, data.RangeKm);
        Assert.Equal("online", data.State);
        Assert.True(data.IsLocked);
        Assert.Equal(21, data.InsideTempC);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), data.LastUpdated);
    }

    [Fact]
    public void SummaryFromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"battery_level":40}""");

        var data = WatchSummaryData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(40, data!.BatteryLevel);
        Assert.Null(data.RangeKm);
        Assert.Null(data.State);
        Assert.Null(data.IsLocked);
        Assert.Null(data.InsideTempC);
        Assert.Null(data.LastUpdated);
    }

    [Theory]
    [InlineData("{}")]   // empty object → no usable summary (web summary undefined)
    [InlineData("[]")]   // non-object
    [InlineData("null")] // null body
    public void SummaryFromResponse_returns_null_for_no_data(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(WatchSummaryData.FromResponse(doc.RootElement));
    }

    // ---- Complication parse adapter (web useWatchComplication slice) ----------------

    [Fact]
    public void ComplicationFromResponse_reads_charging()
    {
        using var doc = JsonDocument.Parse("""{"battery":"72%","range":"320 km","state":"online","charging":true}""");
        Assert.True(WatchComplicationData.FromResponse(doc.RootElement).Charging);
    }

    [Theory]
    [InlineData("""{"charging":false}""")]
    [InlineData("{}")]
    [InlineData("[]")]
    public void ComplicationFromResponse_defaults_charging_to_false(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.False(WatchComplicationData.FromResponse(doc.RootElement).Charging);
    }

    // ---- Battery tint thresholds (web getBatteryColor) -----------------------------

    [Theory]
    [InlineData(100, WatchBatteryTint.Healthy)]
    [InlineData(51, WatchBatteryTint.Healthy)]
    [InlineData(50, WatchBatteryTint.Warning)]   // web: > 50, so 50 is amber
    [InlineData(21, WatchBatteryTint.Warning)]
    [InlineData(20, WatchBatteryTint.Critical)]  // web: > 20, so 20 is red
    [InlineData(0, WatchBatteryTint.Critical)]
    public void TintFor_classifies_by_threshold(double level, WatchBatteryTint expected) =>
        Assert.Equal(expected, WatchSummaryProjection.TintFor(level));

    [Fact]
    public void TintFor_null_is_unknown() =>
        Assert.Equal(WatchBatteryTint.Unknown, WatchSummaryProjection.TintFor(null));

    [Theory]
    [InlineData(WatchBatteryTint.Healthy, StatusKind.Success)]
    [InlineData(WatchBatteryTint.Warning, StatusKind.Warning)]
    [InlineData(WatchBatteryTint.Critical, StatusKind.Danger)]
    [InlineData(WatchBatteryTint.Unknown, StatusKind.Neutral)]
    public void StatusFor_maps_tint_to_status(WatchBatteryTint tint, StatusKind expected) =>
        Assert.Equal(expected, WatchSummaryProjection.StatusFor(tint));

    // ---- Vehicle-state palette (web getStateDefinition / badge variant) ------------

    [Theory]
    [InlineData("online", "TsColorSuccessBrush")]
    [InlineData("driving", "TsColorInfoBrush")]
    [InlineData("charging", "TsColorWarningBrush")]
    [InlineData("asleep", "TsChart07Brush")]
    [InlineData("offline", "TsColorDangerBrush")]
    [InlineData("weird", "TsColorTextSecondaryBrush")]
    [InlineData(null, "TsColorTextSecondaryBrush")]
    public void DotBrushKey_matches_vehicle_state(string? state, string expected) =>
        Assert.Equal(expected, WatchStatePalette.DotBrushKey(state));

    [Theory]
    [InlineData("online", StatusKind.Success)]
    [InlineData("asleep", StatusKind.Neutral)]
    [InlineData("offline", StatusKind.Warning)] // web: anything but online/asleep is warning
    [InlineData("driving", StatusKind.Warning)]
    public void BadgeStatus_matches_web_inline_map(string state, StatusKind expected) =>
        Assert.Equal(expected, WatchStatePalette.BadgeStatus(state));

    // ---- Size flags (web isCompact = size.cols <= 1) -------------------------------

    [Theory]
    [InlineData(1, 2, true)]   // default → compact watch face
    [InlineData(1, 40, true)]
    [InlineData(2, 2, false)]  // standard hero + grid
    [InlineData(2, 40, false)]
    public void Size_compact_flag_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new WatchSummarySize(cols, rows).IsCompact);

    // ---- Projection (compact + standard, units) ------------------------------------

    [Fact]
    public void Project_compact_metric_exposes_gauge_state_range_and_charging()
    {
        var view = WatchSummaryProjection.Project(
            MakeReading(charging: true), new WatchSummarySize(1, 2), UnitPref.Metric, Localizer, Now);

        Assert.True(view.IsCompact);
        Assert.Equal(72, view.BatteryLevel);
        Assert.Equal(72, view.GaugeValue);
        Assert.Equal("72", view.BatteryValueText);
        Assert.Equal(WatchBatteryTint.Healthy, view.BatteryTint);
        Assert.True(view.HasState);
        Assert.Equal("online", view.State);
        Assert.Equal("TsColorSuccessBrush", view.StateDotBrushKey);
        Assert.Equal(320, view.RangeDisplay);
        Assert.Equal("320", view.RangeValueText);
        Assert.Equal("km", view.DistanceUnitLabel);
        Assert.True(view.Charging);
        Assert.Equal("Charging", view.ChargingText);
    }

    [Fact]
    public void Project_standard_metric_exposes_hero_and_detail_tiles()
    {
        var view = WatchSummaryProjection.Project(
            MakeReading(), new WatchSummarySize(2, 2), UnitPref.Metric, Localizer, Now);

        Assert.False(view.IsCompact);
        Assert.Equal("72", view.BatteryValueText);
        Assert.Equal("Battery", view.BatteryLabel);
        Assert.True(view.ShowStateBadge);
        Assert.Equal(StatusKind.Success, view.StateBadgeStatus);

        Assert.Equal("Range", view.RangeTile.Label);
        Assert.Equal("320 km", view.RangeTile.ValueText);
        Assert.Equal("Lock", view.LockTile.Label);
        Assert.Equal("Locked", view.LockTile.ValueText);
        Assert.Equal("Cabin", view.CabinTile.Label);
        Assert.Equal("21\u00B0C", view.CabinTile.ValueText);
        Assert.Equal("Last Seen", view.LastSeenTile.Label);

        Assert.True(view.HasLock);
        Assert.True(view.LockGlyphIsLocked);
        Assert.Equal("Locked", view.LockLabel);
        Assert.Equal(StatusKind.Success, view.LockStatus);
    }

    [Fact]
    public void Project_imperial_converts_range_and_temperature()
    {
        var view = WatchSummaryProjection.Project(
            MakeReading(), new WatchSummarySize(2, 2), UnitPref.Imperial, Localizer, Now);

        // 320 km = 320000 m → 198.84 mi → 199 (0 decimals); 21°C → 69.8°F → 70.
        Assert.Equal("mi", view.DistanceUnitLabel);
        Assert.Equal("199", view.RangeValueText);
        Assert.Equal("199 mi", view.RangeTile.ValueText);
        Assert.Equal("\u00B0F", view.TemperatureUnitLabel);
        Assert.Equal("70", view.TempValueText);
        Assert.Equal("70\u00B0F", view.CabinTile.ValueText);
    }

    [Fact]
    public void Project_unlocked_uses_warning_status_and_label()
    {
        var reading = MakeReading(isLocked: false);
        var view = WatchSummaryProjection.Project(reading, new WatchSummarySize(2, 2), UnitPref.Metric, Localizer, Now);

        Assert.False(view.LockGlyphIsLocked);
        Assert.Equal("Unlocked", view.LockLabel);
        Assert.Equal(StatusKind.Warning, view.LockStatus);
    }

    [Fact]
    public void Project_null_fields_render_em_dash_and_unknown_tint()
    {
        var reading = new WatchSummaryReading(
            new WatchSummaryData(null, null, null, null, null, null), Charging: false);
        var view = WatchSummaryProjection.Project(reading, new WatchSummarySize(2, 2), UnitPref.Metric, Localizer, Now);

        Assert.Equal("\u2014", view.BatteryValueText);
        Assert.Equal(WatchBatteryTint.Unknown, view.BatteryTint);
        Assert.False(view.HasState);
        Assert.False(view.ShowStateBadge);
        Assert.Null(view.RangeDisplay);
        Assert.Equal("\u2014", view.RangeTile.ValueText);
        Assert.Null(view.TempDisplay);
        Assert.Equal("\u2014", view.CabinTile.ValueText);
        Assert.False(view.HasLock);
        Assert.Equal("\u2014", view.LockTile.ValueText);
    }

    [Fact]
    public void Project_gauge_value_is_clamped_into_zero_hundred()
    {
        var over = WatchSummaryProjection.Project(
            MakeReading(battery: 150), new WatchSummarySize(1, 2), UnitPref.Metric, Localizer, Now);
        Assert.Equal(100, over.GaugeValue);

        var under = WatchSummaryProjection.Project(
            MakeReading(battery: -10), new WatchSummarySize(1, 2), UnitPref.Metric, Localizer, Now);
        Assert.Equal(0, under.GaugeValue);
    }

    // ---- Accessibility names (every interactive surface announces its value) --------

    [Fact]
    public void Project_exposes_non_empty_accessibility_names()
    {
        var view = WatchSummaryProjection.Project(
            MakeReading(), new WatchSummarySize(2, 2), UnitPref.Metric, Localizer, Now);

        Assert.False(string.IsNullOrWhiteSpace(view.GaugeAutomationName));
        Assert.Contains("Battery", view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains("72", view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains("Range", view.RangeTile.AutomationName, StringComparison.Ordinal);
        Assert.Contains("320 km", view.RangeTile.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Lock", view.LockTile.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Cabin", view.CabinTile.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Last Seen", view.LastSeenTile.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result combiner (two-source merge, web hook composition) -------------------

    [Fact]
    public void Combine_loaded_summary_with_charging_complication()
    {
        using var summaryDoc = JsonDocument.Parse(FullSummaryJson);
        using var compDoc = JsonDocument.Parse("""{"charging":true}""");

        var result = WatchSummaryResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(summaryDoc.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(compDoc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Equal(72, result.Value!.Summary.BatteryLevel);
        Assert.True(result.Value.Charging);
    }

    [Fact]
    public void Combine_summary_only_defaults_charging_false()
    {
        using var summaryDoc = JsonDocument.Parse(FullSummaryJson);

        var withNull = WatchSummaryResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(summaryDoc.RootElement, Now), complication: null);
        Assert.Equal(LoadStatus.Loaded, withNull.Status);
        Assert.False(withNull.Value!.Charging);

        var withError = WatchSummaryResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(summaryDoc.RootElement, Now),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Loaded, withError.Status);
        Assert.False(withError.Value!.Charging);
    }

    [Fact]
    public void Combine_collapses_no_data_summary_to_empty()
    {
        using var empty = JsonDocument.Parse("{}");

        var result = WatchSummaryResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now), complication: null);

        Assert.Equal(LoadStatus.Empty, result.Status);
        Assert.Null(result.Value);
    }

    [Fact]
    public void Combine_summary_failure_is_error()
    {
        var result = WatchSummaryResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            complication: null);

        Assert.Equal(LoadStatus.Error, result.Status);
    }

    [Fact]
    public void Combine_preserves_stale_and_offline_freshness()
    {
        using var summaryDoc = JsonDocument.Parse(FullSummaryJson);

        var stale = WatchSummaryResultMapper.Combine(
            RepositoryResult<JsonElement>.Cached(summaryDoc.RootElement, Now, stale: true), complication: null);
        Assert.Equal(LoadStatus.Cached, stale.Status);
        Assert.True(stale.IsStale);

        var offline = WatchSummaryResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(summaryDoc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            complication: null);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(72, offline.Value!.Summary.BatteryLevel);
    }

    [Fact]
    public void Combine_uses_latest_fetched_at_across_sources()
    {
        using var summaryDoc = JsonDocument.Parse(FullSummaryJson);
        using var compDoc = JsonDocument.Parse("""{"charging":true}""");
        var later = Now.AddMinutes(1);

        var result = WatchSummaryResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(summaryDoc.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(compDoc.RootElement, later));

        Assert.Equal(later, result.FetchedAt);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<WatchSummaryReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(WatchSummaryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(MakeReading(charging: true)));
        await vm.LoadAsync();

        Assert.Equal(WatchSummaryState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal(72, vm.Display!.BatteryLevel);
        Assert.True(vm.Display.Charging);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<WatchSummaryReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(WatchSummaryState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No watch data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<WatchSummaryReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(WatchSummaryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Null(vm.Display);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<WatchSummaryReading>.Cached(MakeReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(WatchSummaryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<WatchSummaryReading>.OfflineCached(
            MakeReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(WatchSummaryState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.NotNull(vm.Display);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<WatchSummaryReading>.Loading(),
            RepositoryResult<WatchSummaryReading>.Cached(MakeReading(battery: 60), Now, stale: false),
            RepositoryResult<WatchSummaryReading>.Loaded(MakeReading(battery: 72), Now));
        await vm.LoadAsync();

        Assert.Equal(WatchSummaryState.Loaded, vm.State);
        Assert.Equal(72, vm.Display!.BatteryLevel);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_to_standard()
    {
        using var vm = NewViewModel(WatchSummarySize.Default, Loaded(MakeReading()));
        await vm.LoadAsync();
        Assert.True(vm.Display!.IsCompact);

        vm.Size = new WatchSummarySize(2, 2);
        Assert.False(vm.Display!.IsCompact);
        Assert.Equal(WatchSummaryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_range_and_temp()
    {
        using var vm = NewViewModel(WatchSummarySize.Default, Loaded(MakeReading()));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display!.DistanceUnitLabel);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display!.DistanceUnitLabel);
        Assert.Equal("199", vm.Display.RangeValueText);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<WatchSummaryReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Watch Summary", vm.Title);
        Assert.Equal("No watch data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(MakeReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(WatchSummaryViewModel.State), changed);
        Assert.Contains(nameof(WatchSummaryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("watch-summary", WatchSummaryRegistration.Id);
        Assert.Equal("vehicle", WatchSummaryRegistration.Category);
        Assert.Equal("WatchSummaryWidget", WatchSummaryRegistration.Slug);
        Assert.Equal(new WatchSummarySize(1, 2), WatchSummaryRegistration.DefaultSize);
        Assert.Equal(new WatchSummarySize(1, 2), WatchSummaryRegistration.MinSize);
        Assert.Equal(new WatchSummarySize(2, 40), WatchSummaryRegistration.MaxSize);
        Assert.Equal("Watch Summary", WatchSummaryRegistration.Name(Localizer));
        Assert.Contains("battery", WatchSummaryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]   // min == default
    [InlineData(2, 40, true)]  // max
    [InlineData(2, 10, true)]  // inside
    [InlineData(3, 2, false)]  // above max cols
    [InlineData(1, 1, false)]  // below min rows
    [InlineData(1, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, WatchSummaryRegistration.IsWithinBounds(new WatchSummarySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new WatchSummarySize(1, 2), WatchSummaryRegistration.Clamp(new WatchSummarySize(0, 0)));
        Assert.Equal(new WatchSummarySize(2, 40), WatchSummaryRegistration.Clamp(new WatchSummarySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WatchSummaryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WatchSummaryWidget", Assert.Single(lines));
    }

    // ---- Source (always-on two-endpoint adapter) -----------------------------------

    [Fact]
    public async Task Source_without_vehicle_still_requests_both_endpoints()
    {
        using var summaryDoc = JsonDocument.Parse(FullSummaryJson);
        using var compDoc = JsonDocument.Parse("""{"charging":true}""");
        var api = new FakeApiClient().ReturnsValue(summaryDoc.RootElement).ReturnsValue(compDoc.RootElement);
        var source = new WatchSummarySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(2, api.Requests.Count);
        Assert.Contains(api.Requests, r => r.OperationId == "get_api_v1_watch_summary");
        Assert.Contains(api.Requests, r => r.OperationId == "get_api_v1_watch_complication");
        Assert.All(api.Requests, r => Assert.Null(r.Query)); // no vehicle → no vehicle_id query
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_forwards_vehicle_id()
    {
        using var summaryDoc = JsonDocument.Parse(FullSummaryJson);
        using var compDoc = JsonDocument.Parse("""{"charging":true}""");
        var api = new FakeApiClient().ReturnsValue(summaryDoc.RootElement).ReturnsValue(compDoc.RootElement);
        var source = new WatchSummarySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(2, api.Requests.Count);
        Assert.All(api.Requests, r => Assert.Equal(7L, Convert.ToInt64(r.Query!["vehicle_id"], CultureInfo.InvariantCulture)));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins()
    {
        using var summaryDoc = JsonDocument.Parse(FullSummaryJson);
        using var compDoc = JsonDocument.Parse("""{"charging":true}""");
        var api = new FakeApiClient().ReturnsValue(summaryDoc.RootElement).ReturnsValue(compDoc.RootElement);
        var source = new WatchSummarySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.All(api.Requests, r => Assert.Equal(42L, Convert.ToInt64(r.Query!["vehicle_id"], CultureInfo.InvariantCulture)));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static WatchSummaryReading MakeReading(
        double? battery = 72,
        double? rangeKm = 320,
        string? state = "online",
        bool? isLocked = true,
        double? insideTempC = 21,
        bool charging = false) =>
        new(
            new WatchSummaryData(battery, rangeKm, state, isLocked, insideTempC, Now.AddMinutes(-2)),
            charging);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<WatchSummaryReading>>> Drain(IWatchSummarySource source)
    {
        var list = new List<RepositoryResult<WatchSummaryReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<WatchSummaryReading> Loaded(WatchSummaryReading reading) =>
        RepositoryResult<WatchSummaryReading>.Loaded(reading, Now);

    private static WatchSummaryViewModel NewViewModel(params RepositoryResult<WatchSummaryReading>[] emissions) =>
        NewViewModel(WatchSummarySize.Default, emissions);

    private static WatchSummaryViewModel NewViewModel(
        WatchSummarySize size,
        params RepositoryResult<WatchSummaryReading>[] emissions) =>
        new(new FakeWatchSummarySource(emissions), Localizer, size, UnitPref.Metric, () => Now);

    private sealed class FakeWatchSummarySource(params RepositoryResult<WatchSummaryReading>[] emissions)
        : IWatchSummarySource
    {
        public async IAsyncEnumerable<RepositoryResult<WatchSummaryReading>> StreamAsync(
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
