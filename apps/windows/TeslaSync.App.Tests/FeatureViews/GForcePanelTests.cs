using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the GForcePanel's UI-thread-free logic — the drive-dynamics JSON parse adapter
/// (number-only, web <c>typeof === 'number'</c>), the combined-magnitude computation
/// (<c>sqrt(lateral² + longitudinal²)</c>), the projection (the three tiles, their <c>fmtNumber(_, 2)</c>
/// values, the <c>g</c> unit, the em-dash fallbacks, the labels and accessibility names), the cache-then-network
/// result mapper, the registration metadata, the diagnostics, the generated-operation contract pin, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/driving/components/driving-dynamics/GForcePanel.tsx).
/// </summary>
public sealed class GForcePanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_both_acceleration_axes()
    {
        using var doc = JsonDocument.Parse(
            """{ "lateral_acceleration": 0.45, "longitudinal_acceleration": -0.3 }""");

        var snap = GForcePanelSnapshot.FromJson(doc.RootElement);

        Assert.Equal(0.45, snap.LateralAcceleration);
        Assert.Equal(-0.3, snap.LongitudinalAcceleration);
        Assert.True(snap.HasAny);
    }

    [Fact]
    public void FromJson_ignores_non_numeric_values()
    {
        // Web parity: `typeof data?.lateral_acceleration === 'number'` — a numeric STRING is treated as absent.
        using var doc = JsonDocument.Parse(
            """{ "lateral_acceleration": "0.45", "longitudinal_acceleration": 0.3 }""");

        var snap = GForcePanelSnapshot.FromJson(doc.RootElement);

        Assert.Null(snap.LateralAcceleration);
        Assert.Equal(0.3, snap.LongitudinalAcceleration);
        Assert.True(snap.HasAny);
    }

    [Fact]
    public void FromJson_tolerates_missing_axes()
    {
        using var doc = JsonDocument.Parse("""{ "lateral_acceleration": 0.45 }""");

        var snap = GForcePanelSnapshot.FromJson(doc.RootElement);

        Assert.Equal(0.45, snap.LateralAcceleration);
        Assert.Null(snap.LongitudinalAcceleration);
    }

    [Fact]
    public void FromJson_non_object_is_empty()
    {
        using var doc = JsonDocument.Parse("null");

        var snap = GForcePanelSnapshot.FromJson(doc.RootElement);

        Assert.False(snap.HasAny);
        Assert.Null(snap.LateralAcceleration);
        Assert.Null(snap.LongitudinalAcceleration);
    }

    [Fact]
    public void FromJson_ignores_non_finite_numbers()
    {
        // System.Text.Json rejects raw NaN/Infinity tokens, so a non-finite axis can only arrive via a huge
        // exponent that overflows to Infinity — which the guard treats as absent.
        using var doc = JsonDocument.Parse("""{ "lateral_acceleration": 1e400 }""");

        var snap = GForcePanelSnapshot.FromJson(doc.RootElement);

        Assert.Null(snap.LateralAcceleration);
    }

    // ---- Magnitude (web sqrt(lateral² + longitudinal²)) ----------------------------

    [Fact]
    public void Magnitude_combines_both_axes()
    {
        Assert.Equal(5.0, GForcePanelProjection.Magnitude(3.0, 4.0)!.Value, 9);
        Assert.Equal(Math.Sqrt(0.2925), GForcePanelProjection.Magnitude(0.45, -0.3)!.Value, 9);
    }

    [Fact]
    public void Magnitude_is_null_unless_both_axes_present()
    {
        Assert.Null(GForcePanelProjection.Magnitude(0.45, null));
        Assert.Null(GForcePanelProjection.Magnitude(null, 0.3));
        Assert.Null(GForcePanelProjection.Magnitude(null, null));
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_empty_when_no_axis_reported()
    {
        var view = GForcePanelProjection.Project(GForcePanelSnapshot.Empty, Localizer);

        Assert.False(view.HasData);
        Assert.Empty(view.Metrics);
        Assert.Equal("Acceleration G-Force", view.Title);
        Assert.Equal("No G-force telemetry received yet", view.EmptyMessage);
    }

    [Fact]
    public void Project_null_snapshot_is_empty()
    {
        var view = GForcePanelProjection.Project(null, Localizer);

        Assert.False(view.HasData);
        Assert.Empty(view.Metrics);
    }

    [Fact]
    public void Project_builds_three_tiles_with_web_formatting()
    {
        var view = GForcePanelProjection.Project(new GForcePanelSnapshot(0.45, -0.30), Localizer);

        Assert.True(view.HasData);
        Assert.Equal(3, view.Metrics.Count);

        var lateral = view.Metrics[0];
        Assert.Equal("Lateral", lateral.Label);
        Assert.Equal("0.45", lateral.Value);
        Assert.Equal("g", lateral.Unit);
        Assert.Equal("0.45 g", lateral.ValueWithUnit);

        var longitudinal = view.Metrics[1];
        Assert.Equal("Longitudinal", longitudinal.Label);
        Assert.Equal("-0.30", longitudinal.Value);

        var combined = view.Metrics[2];
        Assert.Equal("Combined", combined.Label);
        Assert.Equal("0.54", combined.Value); // sqrt(0.45² + 0.30²) = 0.5408… → fmtNumber(_, 2)
        Assert.Equal("g", combined.Unit);
    }

    [Fact]
    public void Project_partial_axis_shows_em_dash_for_missing_and_combined()
    {
        var view = GForcePanelProjection.Project(new GForcePanelSnapshot(0.45, null), Localizer);

        Assert.True(view.HasData); // web hasAny: one axis present is enough to show the grid
        Assert.Equal("0.45", view.Metrics[0].Value);
        Assert.Equal(GForcePanelProjection.EmDash, view.Metrics[1].Value);
        Assert.Equal(GForcePanelProjection.EmDash, view.Metrics[2].Value); // combined needs both axes
    }

    [Fact]
    public void Project_formats_to_two_decimals()
    {
        var view = GForcePanelProjection.Project(new GForcePanelSnapshot(1, 0), Localizer);

        Assert.Equal("1.00", view.Metrics[0].Value);
        Assert.Equal("0.00", view.Metrics[1].Value);
        Assert.Equal("1.00", view.Metrics[2].Value); // sqrt(1 + 0) = 1
    }

    // ---- i18n: every label resolves through its catalog key -------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();

        var view = GForcePanelProjection.Project(new GForcePanelSnapshot(0.45, -0.30), echo);

        Assert.Equal("L:dynamics.gForce", view.Title);
        Assert.Equal("L:dynamics.gForceNoData", view.EmptyMessage);
        Assert.Equal("L:dynamics.gForceAria", view.AriaLabel);
        Assert.Equal("L:dynamics.lateral", view.Metrics[0].Label);
        Assert.Equal("L:dynamics.longitudinal", view.Metrics[1].Label);
        Assert.Equal("L:dynamics.combined", view.Metrics[2].Label);
    }

    // ---- a11y: every tile carries a spoken name ------------------------------------

    [Fact]
    public void Every_metric_carries_a_non_empty_value_label_unit_and_automation_name()
    {
        var view = GForcePanelProjection.Project(new GForcePanelSnapshot(0.45, -0.30), Localizer);

        Assert.All(view.Metrics, m =>
        {
            Assert.False(string.IsNullOrWhiteSpace(m.Value));
            Assert.False(string.IsNullOrWhiteSpace(m.Label));
            Assert.False(string.IsNullOrWhiteSpace(m.Unit));
            Assert.False(string.IsNullOrWhiteSpace(m.AutomationName));
            Assert.Contains(m.Label, m.AutomationName, StringComparison.Ordinal);
            Assert.Contains(m.Value, m.AutomationName, StringComparison.Ordinal);
            Assert.Contains(m.Unit, m.AutomationName, StringComparison.Ordinal);
        });
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse(
            """{ "lateral_acceleration": 0.45, "longitudinal_acceleration": -0.3 }""");

        var cached = GForcePanelResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(0.45, cached.Value!.LateralAcceleration);

        var offline = GForcePanelResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(-0.3, offline.Value!.LongitudinalAcceleration);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, GForcePanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, GForcePanelResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, GForcePanelResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<GForcePanelSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(GForcePanelState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_three_tiles()
    {
        using var vm = NewViewModel(Loaded(Snap(0.45, -0.30)));
        await vm.LoadAsync();

        Assert.Equal(GForcePanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Metrics.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_axes_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Snap(null, null)));
        await vm.LoadAsync();

        Assert.Equal(GForcePanelState.Empty, vm.State);
        Assert.False(vm.HasData);
        // Even empty, the surface keeps the friendly message (never a blank box).
        Assert.Equal("No G-force telemetry received yet", vm.Display.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<GForcePanelSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(GForcePanelState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<GForcePanelSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(GForcePanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<GForcePanelSnapshot>.Cached(
            Snap(0.45, -0.30), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(GForcePanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<GForcePanelSnapshot>.OfflineCached(
            Snap(0.45, -0.30),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(GForcePanelState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<GForcePanelSnapshot>.Loading(),
            RepositoryResult<GForcePanelSnapshot>.Cached(Snap(0.1, 0.1), Now, stale: false),
            RepositoryResult<GForcePanelSnapshot>.Loaded(Snap(0.45, -0.30), Now));
        await vm.LoadAsync();

        Assert.Equal(GForcePanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("0.45", vm.Display.Metrics[0].Value);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<GForcePanelSnapshot>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Acceleration G-Force", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snap(0.45, -0.30)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(GForcePanelViewModel.State), changed);
        Assert.Contains(nameof(GForcePanelViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("g-force-panel", GForcePanelRegistration.Id);
        Assert.Equal("driving", GForcePanelRegistration.Category);
        Assert.Equal("GForcePanel", GForcePanelRegistration.Slug);
        Assert.Equal("Acceleration G-Force", GForcePanelRegistration.Name(Localizer));
    }

    // ---- Generated-operation contract pin ------------------------------------------

    [Fact]
    public void Operation_resolves_against_the_generated_endpoint_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(
            e => e.OperationId == GForcePanelSource.DriveDynamicsLatestOperation);

        Assert.True(
            descriptor is not null,
            $"Operation '{GForcePanelSource.DriveDynamicsLatestOperation}' is not in the generated endpoint table.");
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new GForcePanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=GForcePanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static GForcePanelSnapshot Snap(double? lateral, double? longitudinal) =>
        new(lateral, longitudinal);

    private static RepositoryResult<GForcePanelSnapshot> Loaded(GForcePanelSnapshot snapshot) =>
        RepositoryResult<GForcePanelSnapshot>.Loaded(snapshot, Now);

    private static GForcePanelViewModel NewViewModel(params RepositoryResult<GForcePanelSnapshot>[] emissions) =>
        new(new FakeGForcePanelSource(emissions), Localizer, () => Now);

    private sealed class FakeGForcePanelSource(params RepositoryResult<GForcePanelSnapshot>[] emissions) : IGForcePanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<GForcePanelSnapshot>> StreamAsync(
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

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
