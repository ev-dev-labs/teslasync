using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the OdometerCounterWidget's UI-thread-free logic — the vehicle-state parse
/// adapter (the three web <c>useVehicleState</c> branches), the SI→display projection (odometer big number +
/// the wide "Total Driven" / "Unit" breakdown tiles), the cache-then-network result mapper (state combined
/// with the supplementary lifetime distance, odometer-less responses collapsing to empty), the footprint
/// flags (compact / wide), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/OdometerCounterWidget.tsx).
/// </summary>
public sealed class OdometerCounterWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 5, 0, TimeSpan.Zero);

    private static OdometerSnapshot Make(double odometer = 100000, double? totalDistanceKm = 50000) =>
        new(odometer, totalDistanceKm);

    // ---- Parse adapter (web useVehicleState branches) ------------------------------

    [Fact]
    public void FromResponse_reads_odometer_from_state_object()
    {
        // Branch 1 (web primary): res.state with a vehicle_id.
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":7,"odometer":123456.7}}""");

        var reading = OdometerReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(123456.7, reading!.Odometer);
    }

    [Fact]
    public void FromResponse_state_without_odometer_is_null()
    {
        // Web parity: stateData.state.odometer ?? null — an odometer-less state surfaces the empty state.
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":7}}""");

        Assert.Null(OdometerReading.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_builds_from_position_when_no_state_vehicle_id()
    {
        // Branch 2 (web fallback): build from the position snapshot.
        using var doc = JsonDocument.Parse("""{"vehicle":{"id":7},"position":{"odometer":5000}}""");

        var reading = OdometerReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(5000, reading!.Odometer);
    }

    [Fact]
    public void FromResponse_position_without_odometer_defaults_to_zero()
    {
        // Web parity (branch 2): odometer: p?.odometer ?? 0.
        using var doc = JsonDocument.Parse("""{"vehicle":{"id":7},"position":{"latitude":1.0}}""");

        var reading = OdometerReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(0, reading!.Odometer);
    }

    [Fact]
    public void FromResponse_plain_state_branch_reads_odometer()
    {
        // Branch 3 (web): `if (!v && !p) return { state: res.state }` — a plain state object's odometer.
        using var doc = JsonDocument.Parse("""{"state":{"odometer":42}}""");

        var reading = OdometerReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(42, reading!.Odometer);
    }

    [Fact]
    public void FromResponse_parses_numeric_string_odometer()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":7,"odometer":"98765"}}""");

        var reading = OdometerReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(98765, reading!.Odometer);
    }

    [Fact]
    public void FromResponse_empty_object_is_null()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Null(OdometerReading.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_non_object_is_null()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(OdometerReading.FromResponse(doc.RootElement));
    }

    // ---- Size / footprint flags (web isCompact / isWide) ---------------------------

    [Theory]
    [InlineData(1, 1, true, false)]   // compact
    [InlineData(1, 2, false, false)]  // default expanded, not wide
    [InlineData(2, 2, false, true)]   // wide
    [InlineData(2, 40, false, true)]  // wide max
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new OdometerCounterSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    // ---- Projection (SI metres, no km→m scaling) -----------------------------------

    [Fact]
    public void Project_metric_converts_odometer_as_si_metres_without_scaling()
    {
        // Web parity: odometer (and totalDistanceKm) pass DIRECTLY to convertDistanceFromSI as SI metres —
        // NO ×1000 scaling. 100,000 m → 100 km (not 100,000), 50,000 m → 50 km.
        var view = OdometerCounterProjection.Project(
            Make(odometer: 100000, totalDistanceKm: 50000), new OdometerCounterSize(2, 2), UnitPref.Metric, Localizer);

        Assert.False(view.IsCompact);
        Assert.True(view.IsWide);
        Assert.Equal(100d, view.OdometerValue, 3);
        Assert.Equal("100", view.OdometerValueText);
        Assert.Equal("km", view.UnitLabel);
        Assert.Equal(" km", view.ExpandedSuffix);
        Assert.Equal("Total Odometer", view.TotalOdometerLabel);
        Assert.Equal("Total Driven", view.TotalDrivenLabel);
        Assert.Equal("50 km", view.TotalDrivenValue);
        Assert.Equal("Unit", view.UnitTileLabel);
        Assert.Equal("km", view.UnitTileValue);
    }

    [Fact]
    public void Project_imperial_converts_distance_and_units()
    {
        var view = OdometerCounterProjection.Project(
            Make(odometer: 100000, totalDistanceKm: 50000), new OdometerCounterSize(2, 2), UnitPref.Imperial, Localizer);

        // 100,000 m / 1609.344 = 62.1 mi; 50,000 m / 1609.344 = 31.1 mi.
        Assert.Equal("62", view.OdometerValueText);
        Assert.Equal("mi", view.UnitLabel);
        Assert.Equal("31 mi", view.TotalDrivenValue);
        Assert.Equal("mi", view.UnitTileValue);
    }

    [Fact]
    public void Project_total_driven_is_em_dash_when_stats_missing()
    {
        // Web parity: stats?.totalDistanceKm ?? null → "—".
        var view = OdometerCounterProjection.Project(
            Make(odometer: 100000, totalDistanceKm: null), new OdometerCounterSize(2, 2), UnitPref.Metric, Localizer);

        Assert.Equal("\u2014", view.TotalDrivenValue);
    }

    [Fact]
    public void Project_compact_exposes_big_number_and_unit_caption()
    {
        var view = OdometerCounterProjection.Project(
            Make(odometer: 100000, totalDistanceKm: null), new OdometerCounterSize(1, 1), UnitPref.Metric, Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal(100d, view.OdometerValue, 3);
        Assert.Equal("100", view.OdometerValueText);
        Assert.Equal("km", view.UnitLabel);
        Assert.Contains("100", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("km", view.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_zero_odometer_renders_zero_not_empty()
    {
        // Web parity: odometer 0 → convertedOdometer 0 (not null) → shows "0", not the empty state.
        var view = OdometerCounterProjection.Project(
            Make(odometer: 0, totalDistanceKm: 0), new OdometerCounterSize(1, 2), UnitPref.Metric, Localizer);

        Assert.Equal("0", view.OdometerValueText);
        Assert.Equal("0 km", view.TotalDrivenValue);
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_has_non_empty_accessibility_names()
    {
        var view = OdometerCounterProjection.Project(
            Make(), new OdometerCounterSize(2, 2), UnitPref.Metric, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.CompactAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(view.ExpandedAutomationName));
        Assert.Contains(view.TotalOdometerLabel, view.ExpandedAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.OdometerValueText, view.ExpandedAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.TotalDrivenLabel, view.TotalDrivenAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.TotalDrivenValue, view.TotalDrivenAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.UnitTileLabel, view.UnitTileAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (parse + combine + status preservation) ---------------------

    [Fact]
    public void Mapper_parses_state_and_combines_total_distance()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":7,"odometer":100000}}""");

        var loaded = OdometerCounterResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), totalDistanceKm: 50000);

        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(100000, loaded.Value!.Odometer);
        Assert.Equal(50000, loaded.Value!.TotalDistanceKm);
    }

    [Fact]
    public void Mapper_odometerless_state_collapses_to_empty()
    {
        // Web parity: a successful response carrying no odometer surfaces the EmptyState.
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":7}}""");

        var mapped = OdometerCounterResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), totalDistanceKm: 50000);

        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_preserves_cached_and_offline_status()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":7,"odometer":10}}""");

        var cached = OdometerCounterResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true), 1d);
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(10, cached.Value!.Odometer);
        Assert.Equal(1d, cached.Value!.TotalDistanceKm);

        var offline = OdometerCounterResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            totalDistanceKm: null);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Null(offline.Value!.TotalDistanceKm);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, OdometerCounterResultMapper.Map(
            RepositoryResult<JsonElement>.Loading(), 1d).Status);

        Assert.Equal(LoadStatus.Empty, OdometerCounterResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now), 1d).Status);

        Assert.Equal(LoadStatus.Error, OdometerCounterResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), 1d).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<OdometerSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(OdometerCounterState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(Make()));
        await vm.LoadAsync();

        Assert.Equal(OdometerCounterState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("100", vm.Display.OdometerValueText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_zero_odometer_still_renders_loaded()
    {
        // Web parity: odometer 0 renders the number, not the empty state.
        using var vm = NewViewModel(Loaded(Make(odometer: 0, totalDistanceKm: 0)));
        await vm.LoadAsync();

        Assert.Equal(OdometerCounterState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("0", vm.Display.OdometerValueText);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        // The Source yields Empty() for an odometer-less response and the disabled no-vehicle query.
        using var vm = NewViewModel(RepositoryResult<OdometerSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(OdometerCounterState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No odometer data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<OdometerSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(OdometerCounterState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<OdometerSnapshot>.Cached(Make(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(OdometerCounterState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<OdometerSnapshot>.OfflineCached(
            Make(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(OdometerCounterState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<OdometerSnapshot>.Loading(),
            RepositoryResult<OdometerSnapshot>.Cached(Make(odometer: 80000), Now, stale: false),
            RepositoryResult<OdometerSnapshot>.Loaded(Make(odometer: 100000), Now));
        await vm.LoadAsync();

        Assert.Equal(OdometerCounterState.Loaded, vm.State);
        Assert.Equal("100", vm.Display.OdometerValueText); // last snapshot wins (100,000 m → 100 km)
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new OdometerCounterSize(2, 2), Loaded(Make()));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);
        Assert.True(vm.Display.IsWide);

        vm.Size = new OdometerCounterSize(1, 1);
        Assert.True(vm.Display.IsCompact);
        Assert.False(vm.Display.IsWide);
        Assert.Equal(OdometerCounterState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_values()
    {
        using var vm = NewViewModel(new OdometerCounterSize(2, 2), Loaded(Make(odometer: 100000, totalDistanceKm: 50000)));
        await vm.LoadAsync();
        Assert.Equal("km", vm.Display.UnitLabel);
        Assert.Equal("100", vm.Display.OdometerValueText);
        Assert.Equal("50 km", vm.Display.TotalDrivenValue);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", vm.Display.UnitLabel);
        Assert.Equal("62", vm.Display.OdometerValueText);
        Assert.Equal("31 mi", vm.Display.TotalDrivenValue);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<OdometerSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Odometer", vm.Title);
        Assert.Equal("No odometer data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Make()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(OdometerCounterViewModel.State), changed);
        Assert.Contains(nameof(OdometerCounterViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("odometer-counter", OdometerCounterRegistration.Id);
        Assert.Equal("vehicle", OdometerCounterRegistration.Category);
        Assert.Equal("OdometerCounterWidget", OdometerCounterRegistration.Slug);
        Assert.Equal(new OdometerCounterSize(1, 2), OdometerCounterRegistration.DefaultSize);
        Assert.Equal(new OdometerCounterSize(1, 2), OdometerCounterRegistration.MinSize);
        Assert.Equal(new OdometerCounterSize(2, 40), OdometerCounterRegistration.MaxSize);
        Assert.Equal("Odometer Counter", OdometerCounterRegistration.Name(Localizer));
        Assert.Contains("odometer", OdometerCounterRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]   // default / min
    [InlineData(2, 2, true)]
    [InlineData(2, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(3, 40, false)] // above max cols
    [InlineData(1, 41, false)] // above max rows
    [InlineData(1, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, OdometerCounterRegistration.IsWithinBounds(new OdometerCounterSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new OdometerCounterSize(1, 2), OdometerCounterRegistration.Clamp(new OdometerCounterSize(0, 0)));
        Assert.Equal(new OdometerCounterSize(2, 40), OdometerCounterRegistration.Clamp(new OdometerCounterSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new OdometerCounterDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=OdometerCounterWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<OdometerSnapshot> Loaded(OdometerSnapshot snapshot) =>
        RepositoryResult<OdometerSnapshot>.Loaded(snapshot, Now);

    private static OdometerCounterViewModel NewViewModel(params RepositoryResult<OdometerSnapshot>[] emissions) =>
        NewViewModel(OdometerCounterSize.Default, emissions);

    private static OdometerCounterViewModel NewViewModel(
        OdometerCounterSize size,
        params RepositoryResult<OdometerSnapshot>[] emissions) =>
        new(new FakeOdometerCounterSource(emissions), Localizer, size, UnitPref.Metric, () => Now);

    private sealed class FakeOdometerCounterSource(params RepositoryResult<OdometerSnapshot>[] emissions) : IOdometerCounterSource
    {
        public async IAsyncEnumerable<RepositoryResult<OdometerSnapshot>> StreamAsync(
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
}
