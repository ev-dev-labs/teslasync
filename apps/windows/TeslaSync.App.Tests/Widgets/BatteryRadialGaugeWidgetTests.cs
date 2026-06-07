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
/// Headless verification of the BatteryRadialGaugeWidget's UI-thread-free logic — the JSON parse adapter (the
/// useVehicleState normalisation incl. the optional charge_limit_soc), the battery-colour threshold helper, the
/// value formatting, the projection across the compact / standard / large footprints (the charge-limit ring
/// gating, the Level/Limit stats, and the charging affordance), the cache-then-network result mapper, the
/// per-vehicle data source (primary resolution + path-scoped request), the registry metadata, the diagnostics,
/// and the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx).
/// </summary>
public sealed class BatteryRadialGaugeWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_primary_state_object_with_charge_limit()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"battery_level":80,"is_charging":true,"charge_limit_soc":90},"live":true}""");

        var state = RadialGaugeVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(80, state!.BatteryLevel);
        Assert.True(state.IsCharging);
        Assert.Equal(90, state.ChargeLimitSoc);
    }

    [Fact]
    public void FromResponse_charge_limit_absent_is_null()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":7,"battery_level":80}}""");

        var state = RadialGaugeVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(80, state!.BatteryLevel);
        Assert.Null(state.ChargeLimitSoc);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1}}""");

        var state = RadialGaugeVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(0, state!.BatteryLevel);
        Assert.False(state.IsCharging);
        Assert.Null(state.ChargeLimitSoc);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_and_top_level_charging()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5},"position":{"battery_level":33},"is_charging":true}""");

        var state = RadialGaugeVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(33, state!.BatteryLevel);
        Assert.True(state.IsCharging);
        Assert.Null(state.ChargeLimitSoc); // web reconstruction carries no charge_limit_soc
    }

    [Fact]
    public void FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"battery_level":55,"is_charging":false,"charge_limit_soc":80}}""");

        var state = RadialGaugeVehicleState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(55, state!.BatteryLevel);
        Assert.False(state.IsCharging);
        Assert.Equal(80, state.ChargeLimitSoc);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(RadialGaugeVehicleState.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(RadialGaugeVehicleState.FromResponse(doc.RootElement));
    }

    // ---- Battery colour thresholds (web getBatteryColor) ---------------------------

    [Theory]
    [InlineData(100, StatusKind.Success)]
    [InlineData(51, StatusKind.Success)]
    [InlineData(50, StatusKind.Warning)]  // web: > 50, so 50 is amber
    [InlineData(21, StatusKind.Warning)]
    [InlineData(20, StatusKind.Danger)]   // web: > 20, so 20 is red
    [InlineData(0, StatusKind.Danger)]
    public void StatusFor_classifies_by_threshold(double level, StatusKind expected) =>
        Assert.Equal(expected, BatteryRadialGaugeProjection.StatusFor(level));

    [Theory]
    [InlineData(StatusKind.Success, "TsColorSuccessBrush")]
    [InlineData(StatusKind.Warning, "TsColorWarningBrush")]
    [InlineData(StatusKind.Danger, "TsColorDangerBrush")]
    public void Status_maps_to_themed_status_brush(StatusKind status, string brushKey) =>
        Assert.Equal(brushKey, StatusResources.AccentBrushKey(status));

    [Fact]
    public void Threshold_constants_match_web()
    {
        Assert.Equal(50, BatteryRadialGaugeProjection.HealthyThresholdPercent);
        Assert.Equal(20, BatteryRadialGaugeProjection.WarningThresholdPercent);
        Assert.Equal(100, BatteryRadialGaugeProjection.MaxPercent);
    }

    // ---- Value formatting (web RadialGauge fmtNumber) ------------------------------

    [Theory]
    [InlineData(80, "80")]       // integer -> 0 decimals
    [InlineData(100, "100")]
    [InlineData(0, "0")]
    [InlineData(80.5, "80.50")]  // non-integer -> 2 decimals (global precision)
    public void FormatValue_matches_web(double value, string expected) =>
        Assert.Equal(expected, BatteryRadialGaugeProjection.FormatValue(value));

    [Theory]
    [InlineData(double.NaN, "0")]
    [InlineData(double.PositiveInfinity, "0")]
    public void FormatValue_coerces_non_finite_to_zero(double value, string expected) =>
        Assert.Equal(expected, BatteryRadialGaugeProjection.FormatValue(value));

    // ---- Size / footprint flags (web isCompact / isLarge / gauge diameter) ---------

    [Theory]
    [InlineData(1, 1, true, false, 70)]    // compact 1x1 -> 70px gauge, not large
    [InlineData(1, 2, false, false, 100)]  // default -> 100px, not large (1 col)
    [InlineData(2, 1, false, false, 100)]  // 2x1 -> not compact, not large (1 row)
    [InlineData(2, 2, false, true, 100)]   // large -> stats row
    [InlineData(3, 4, false, true, 100)]
    public void Size_flags_match_web(int cols, int rows, bool compact, bool large, double diameter)
    {
        var size = new BatteryRadialGaugeSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(large, size.IsLarge);
        Assert.Equal(diameter, size.GaugeDiameter);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_standard_formats_value_and_colours_by_level()
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(80, false, null), new BatteryRadialGaugeSize(1, 2), Localizer);

        Assert.Equal(80, view.Value);
        Assert.Equal(100, view.Max);
        Assert.Equal("80", view.ValueText);
        Assert.Equal("%", view.Unit);
        Assert.Equal("Battery", view.GaugeLabel);
        Assert.Equal(StatusKind.Success, view.Status);
        Assert.False(view.IsCompact);
        Assert.Equal(100, view.GaugeDiameter);
        Assert.False(view.ShowCharging);
        Assert.False(view.ShowChargeLimitRing);
        Assert.False(view.ShowStats);              // 1x2 is not large
        Assert.Equal("Battery 80%", view.GaugeAutomationName);
    }

    [Fact]
    public void Project_compact_drops_label_and_shrinks_gauge()
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(80, false, 90), new BatteryRadialGaugeSize(1, 1), Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal(70, view.GaugeDiameter);
        Assert.Equal(string.Empty, view.GaugeLabel);   // web label = isCompact ? '' : 'Battery'
        Assert.False(view.ShowChargeLimitRing);         // ChargeLimitRing is children -> !compact only
        Assert.False(view.ShowStats);                   // compact is never large
    }

    [Fact]
    public void Project_charging_shows_indicator_even_when_compact()
    {
        // Web parity: the "⚡ Charging" line is a sibling of WidgetGaugeHero, not a child — it renders
        // whenever state.is_charging regardless of the compact footprint (unlike BatteryGaugeWidget).
        var compact = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(80, true, null), new BatteryRadialGaugeSize(1, 1), Localizer);
        Assert.True(compact.IsCharging);
        Assert.True(compact.ShowCharging);
        Assert.Equal("Charging", compact.ChargingText);

        var standard = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(80, true, null), new BatteryRadialGaugeSize(1, 2), Localizer);
        Assert.True(standard.ShowCharging);
    }

    [Fact]
    public void Project_not_charging_hides_indicator()
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(80, false, null), new BatteryRadialGaugeSize(2, 2), Localizer);
        Assert.False(view.IsCharging);
        Assert.False(view.ShowCharging);
    }

    [Fact]
    public void Project_charge_limit_present_enables_ring_and_limit_stat()
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(60, false, 90), new BatteryRadialGaugeSize(2, 2), Localizer);

        Assert.Equal(90, view.ChargeLimitSoc);
        Assert.True(view.ShowChargeLimitRing);          // !compact + limit present
        Assert.Equal(0.9, view.ChargeLimitFraction, 6); // 90 / 100

        Assert.True(view.ShowStats);                    // 2x2 is large
        Assert.Equal(2, view.Stats.Count);
        Assert.Equal("Level", view.Stats[0].Label);
        Assert.Equal("60", view.Stats[0].ValueText);
        Assert.Equal("%", view.Stats[0].Unit);
        Assert.Equal("Limit", view.Stats[1].Label);
        Assert.Equal("90", view.Stats[1].ValueText);
        Assert.Equal("%", view.Stats[1].Unit);
    }

    [Fact]
    public void Project_charge_limit_absent_drops_limit_stat()
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(60, false, null), new BatteryRadialGaugeSize(2, 2), Localizer);

        Assert.Null(view.ChargeLimitSoc);
        Assert.False(view.ShowChargeLimitRing);
        Assert.Equal(0, view.ChargeLimitFraction);
        Assert.True(view.ShowStats);
        Assert.Single(view.Stats);                      // only Level, no Limit
        Assert.Equal("Level", view.Stats[0].Label);
    }

    [Fact]
    public void Project_large_shows_stats_default_does_not()
    {
        var large = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(50, false, 70), new BatteryRadialGaugeSize(2, 2), Localizer);
        Assert.True(large.ShowStats);

        var standard = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(50, false, 70), new BatteryRadialGaugeSize(1, 2), Localizer);
        Assert.False(standard.ShowStats);               // stats passed only when isLarge
    }

    [Fact]
    public void Project_charge_limit_ring_shows_on_non_compact_non_large()
    {
        // 1x2 is not compact (so the ChargeLimitRing child renders) but not large (so no stats row).
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(50, false, 70), new BatteryRadialGaugeSize(1, 2), Localizer);
        Assert.True(view.ShowChargeLimitRing);
        Assert.False(view.ShowStats);
        Assert.Equal(0.7, view.ChargeLimitFraction, 6);
    }

    [Theory]
    [InlineData(15, StatusKind.Danger)]
    [InlineData(35, StatusKind.Warning)]
    [InlineData(90, StatusKind.Success)]
    public void Project_colours_value_by_level(double level, StatusKind expected)
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(level, false, null), new BatteryRadialGaugeSize(1, 2), Localizer);
        Assert.Equal(expected, view.Status);
    }

    [Fact]
    public void Project_clamps_value_into_zero_hundred()
    {
        var over = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(150, false, null), new BatteryRadialGaugeSize(1, 2), Localizer);
        Assert.Equal(100, over.Value);
        Assert.Equal("100", over.ValueText);

        var under = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(-10, false, null), new BatteryRadialGaugeSize(1, 2), Localizer);
        Assert.Equal(0, under.Value);
        Assert.Equal("0", under.ValueText);
    }

    [Fact]
    public void Project_clamps_charge_limit_fraction_into_zero_one()
    {
        var over = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(50, false, 150), new BatteryRadialGaugeSize(2, 2), Localizer);
        Assert.Equal(1.0, over.ChargeLimitFraction, 6);

        var under = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(50, false, -20), new BatteryRadialGaugeSize(2, 2), Localizer);
        Assert.Equal(0.0, under.ChargeLimitFraction, 6);
    }

    [Fact]
    public void Project_fractional_value_uses_two_decimals()
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(80.5, false, null), new BatteryRadialGaugeSize(1, 2), Localizer);
        Assert.Equal("80.50", view.ValueText);
        Assert.Equal("Battery 80.50%", view.GaugeAutomationName);
    }

    [Fact]
    public void Project_level_stat_matches_gauge_value()
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(64, false, 80), new BatteryRadialGaugeSize(2, 2), Localizer);
        Assert.Equal(view.ValueText, view.Stats[0].ValueText);
    }

    [Fact]
    public void Project_stats_have_accessibility_names()
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(64, false, 80), new BatteryRadialGaugeSize(2, 2), Localizer);
        Assert.Equal("Level 64%", view.Stats[0].AutomationName);
        Assert.Equal("Limit 80%", view.Stats[1].AutomationName);
    }

    [Fact]
    public void Project_has_non_empty_accessibility_name_containing_value()
    {
        var view = BatteryRadialGaugeProjection.Project(
            new RadialGaugeVehicleState(64, false, null), new BatteryRadialGaugeSize(1, 2), Localizer);
        Assert.False(string.IsNullOrWhiteSpace(view.GaugeAutomationName));
        Assert.Contains(view.ValueText, view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains("Battery", view.GaugeAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":1,"battery_level":62,"is_charging":true,"charge_limit_soc":85}}""");

        var cached = BatteryRadialGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(62, cached.Value!.BatteryLevel);
        Assert.True(cached.Value.IsCharging);
        Assert.Equal(85, cached.Value.ChargeLimitSoc);

        var offline = BatteryRadialGaugeResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(62, offline.Value!.BatteryLevel);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1,"battery_level":40}}""");

        Assert.Equal(LoadStatus.Loaded, BatteryRadialGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, BatteryRadialGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, BatteryRadialGaugeResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_stateless_loaded_body_to_empty()
    {
        // Web parity: a successful response with no `state` makes stateData?.state undefined -> the empty surface.
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = BatteryRadialGaugeResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<RadialGaugeVehicleState>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BatteryRadialGaugeState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauge_display()
    {
        using var vm = NewViewModel(Loaded(new RadialGaugeVehicleState(80, true, 90)));
        await vm.LoadAsync();

        Assert.Equal(BatteryRadialGaugeState.Loaded, vm.State);
        Assert.True(vm.HasState);
        Assert.NotNull(vm.Display);
        Assert.Equal(80, vm.Display!.Value);
        Assert.True(vm.Display.ShowCharging);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<RadialGaugeVehicleState>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryRadialGaugeState.Empty, vm.State);
        Assert.False(vm.HasState);
        Assert.Null(vm.Display);
        Assert.Equal("No battery data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<RadialGaugeVehicleState>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BatteryRadialGaugeState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<RadialGaugeVehicleState>.Cached(new RadialGaugeVehicleState(55, false, null), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BatteryRadialGaugeState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasState);
        Assert.Equal(StatusKind.Success, vm.Display!.Status);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<RadialGaugeVehicleState>.OfflineCached(
            new RadialGaugeVehicleState(18, false, null), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BatteryRadialGaugeState.Offline, vm.State);
        Assert.True(vm.HasState);
        Assert.True(vm.IsStale);
        Assert.Equal(StatusKind.Danger, vm.Display!.Status); // 18% -> red
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<RadialGaugeVehicleState>.Loading(),
            RepositoryResult<RadialGaugeVehicleState>.Cached(new RadialGaugeVehicleState(60, false, null), Now, stale: false),
            RepositoryResult<RadialGaugeVehicleState>.Loaded(new RadialGaugeVehicleState(72, false, null), Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryRadialGaugeState.Loaded, vm.State);
        Assert.Equal("72", vm.Display!.ValueText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact_keeps_charging_drops_ring()
    {
        using var vm = NewViewModel(BatteryRadialGaugeSize.Default, Loaded(new RadialGaugeVehicleState(80, true, 90)));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display.ShowCharging);
        Assert.True(vm.Display.ShowChargeLimitRing);

        vm.Size = new BatteryRadialGaugeSize(1, 1);
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal(70, vm.Display.GaugeDiameter);
        Assert.True(vm.Display.ShowCharging);        // charging is a sibling -> still shown when compact
        Assert.False(vm.Display.ShowChargeLimitRing); // ring is a child -> dropped when compact
        Assert.Equal(BatteryRadialGaugeState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_to_large_shows_stats()
    {
        using var vm = NewViewModel(BatteryRadialGaugeSize.Default, Loaded(new RadialGaugeVehicleState(80, false, 90)));
        await vm.LoadAsync();
        Assert.False(vm.Display!.ShowStats);

        vm.Size = new BatteryRadialGaugeSize(2, 2);
        Assert.True(vm.Display!.ShowStats);
        Assert.Equal(2, vm.Display.Stats.Count);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<RadialGaugeVehicleState>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Battery", vm.Title);
        Assert.Equal("No battery data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new RadialGaugeVehicleState(80, false, null)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BatteryRadialGaugeViewModel.State), changed);
        Assert.Contains(nameof(BatteryRadialGaugeViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("battery-radial-gauge", BatteryRadialGaugeRegistration.Id);
        Assert.Equal("battery", BatteryRadialGaugeRegistration.Category);
        Assert.Equal("BatteryRadialGaugeWidget", BatteryRadialGaugeRegistration.Slug);
        Assert.Equal(new BatteryRadialGaugeSize(1, 2), BatteryRadialGaugeRegistration.DefaultSize);
        Assert.Equal(new BatteryRadialGaugeSize(1, 2), BatteryRadialGaugeRegistration.MinSize);
        Assert.Equal(new BatteryRadialGaugeSize(3, 40), BatteryRadialGaugeRegistration.MaxSize);
        Assert.Equal("Battery Radial Gauge", BatteryRadialGaugeRegistration.Name(Localizer));
        Assert.Contains("color gradient", BatteryRadialGaugeRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min == default
    [InlineData(3, 40, true)]   // max
    [InlineData(3, 2, true)]    // 3 cols allowed (web maxSize cols = 3)
    [InlineData(2, 10, true)]   // inside
    [InlineData(4, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, BatteryRadialGaugeRegistration.IsWithinBounds(new BatteryRadialGaugeSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new BatteryRadialGaugeSize(1, 2), BatteryRadialGaugeRegistration.Clamp(new BatteryRadialGaugeSize(0, 0)));
        Assert.Equal(new BatteryRadialGaugeSize(3, 40), BatteryRadialGaugeRegistration.Clamp(new BatteryRadialGaugeSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryRadialGaugeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryRadialGaugeWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new BatteryRadialGaugeSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_state_by_path()
    {
        using var doc = JsonDocument.Parse(
            """{"state":{"vehicle_id":7,"battery_level":80,"is_charging":true,"charge_limit_soc":90}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryRadialGaugeSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(80, terminal.Value!.BatteryLevel);
        Assert.True(terminal.Value.IsCharging);
        Assert.Equal(90, terminal.Value.ChargeLimitSoc);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":42,"battery_level":50}}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new BatteryRadialGaugeSource(
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
        var source = new BatteryRadialGaugeSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<RadialGaugeVehicleState>>> Drain(IBatteryRadialGaugeSource source)
    {
        var list = new List<RepositoryResult<RadialGaugeVehicleState>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<RadialGaugeVehicleState> Loaded(RadialGaugeVehicleState state) =>
        RepositoryResult<RadialGaugeVehicleState>.Loaded(state, Now);

    private static BatteryRadialGaugeViewModel NewViewModel(params RepositoryResult<RadialGaugeVehicleState>[] emissions) =>
        NewViewModel(BatteryRadialGaugeSize.Default, emissions);

    private static BatteryRadialGaugeViewModel NewViewModel(
        BatteryRadialGaugeSize size,
        params RepositoryResult<RadialGaugeVehicleState>[] emissions) =>
        new(new FakeBatteryRadialGaugeSource(emissions), Localizer, size);

    private sealed class FakeBatteryRadialGaugeSource(params RepositoryResult<RadialGaugeVehicleState>[] emissions)
        : IBatteryRadialGaugeSource
    {
        public async IAsyncEnumerable<RepositoryResult<RadialGaugeVehicleState>> StreamAsync(
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
