using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the GeofenceDrawer modal's UI-thread-free logic — the parse adapter, the
/// display projection (name sort / unnamed fallback / accessible description), the cache-then-network
/// result mapper, the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/components/maps/GeofenceDrawer.tsx + features/maps/pages/GeofencesPage.tsx).
/// </summary>
public sealed class GeofenceDrawerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static DrawableGeofence Fence(
        string id = "1",
        string? name = "Home",
        double lat = 37.7749,
        double lng = -122.4194,
        double radius = 150) =>
        new(id, Lat: lat, Lng: lng, RadiusMeters: radius, Name: name);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_fields()
    {
        const string json = """
        [{"id":1,"name":"Home","latitude":37.7749,"longitude":-122.4194,"radius":150,
          "enabled":true,"alert_on_entry":true,"alert_on_exit":false}]
        """;
        using var doc = JsonDocument.Parse(json);

        var fence = Assert.Single(GeofenceDrawerParser.ParseList(doc.RootElement));

        Assert.Equal("1", fence.Id);
        Assert.Equal("Home", fence.Name);
        Assert.Equal(37.7749, fence.Lat);
        Assert.Equal(-122.4194, fence.Lng);
        Assert.Equal(150, fence.RadiusMeters);
    }

    [Fact]
    public void ParseList_accepts_string_id()
    {
        using var doc = JsonDocument.Parse("""[{"id":"abc","latitude":1,"longitude":2,"radius":50}]""");

        var fence = Assert.Single(GeofenceDrawerParser.ParseList(doc.RootElement));

        Assert.Equal("abc", fence.Id);
        Assert.Null(fence.Name);
    }

    [Fact]
    public void ParseList_skips_non_renderable_rows()
    {
        // No coordinates / radius -> not renderable -> dropped (web fenceToLayer returns null).
        using var doc = JsonDocument.Parse("""[{"id":2,"name":"Bad"},{"id":3,"latitude":0,"longitude":0,"radius":0}]""");
        Assert.Empty(GeofenceDrawerParser.ParseList(doc.RootElement));
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(GeofenceDrawerParser.ParseList(doc.RootElement));
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_sorts_rows_by_name()
    {
        var rows = GeofenceDrawerProjection.Project(
            new[] { Fence("1", "Yard"), Fence("2", "Home") },
            Localizer);

        Assert.Equal(2, rows.Count);
        Assert.Equal("Home", rows[0].Name);
        Assert.Equal("Yard", rows[1].Name);
    }

    [Fact]
    public void Project_uses_localized_unnamed_fallback()
    {
        var row = Assert.Single(GeofenceDrawerProjection.Project(new[] { Fence("1", name: null) }, Localizer));
        Assert.Equal("Geofence", row.Name);
    }

    [Fact]
    public void Project_builds_accessible_description_matching_describe_fence()
    {
        var row = Assert.Single(GeofenceDrawerProjection.Project(new[] { Fence("1", "Home", 37.7749, -122.4194, 100) }, Localizer));

        Assert.Equal("Home \u2014 100m circle around 37.7749, -122.4194", row.Description);
        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Home", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"name":"Home","latitude":1,"longitude":2,"radius":80}]""");

        var cached = GeofenceDrawerResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = GeofenceDrawerResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_loaded_empty_array_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var mapped = GeofenceDrawerResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_collapses_all_non_renderable_loaded_to_empty()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"name":"Bad"}]""");
        var mapped = GeofenceDrawerResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_maps_failure()
    {
        var mapped = GeofenceDrawerResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, mapped.Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DrawableGeofence>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(GeofenceDrawerState.Loading, vm.State);
        Assert.False(vm.HasFences);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_fences_and_rows()
    {
        using var vm = NewViewModel(Loaded(Fence("1", "Home"), Fence("2", "Work")));
        await vm.LoadAsync();

        Assert.Equal(GeofenceDrawerState.Loaded, vm.State);
        Assert.True(vm.HasFences);
        Assert.Equal(2, vm.Fences.Count);
        Assert.Equal(2, vm.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DrawableGeofence>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(GeofenceDrawerState.Empty, vm.State);
        Assert.False(vm.HasFences);
        Assert.Equal("No geofences yet. Draw one on the map to begin.", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DrawableGeofence>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(GeofenceDrawerState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_fences()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DrawableGeofence>>.Cached(new[] { Fence() }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(GeofenceDrawerState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasFences);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_fences()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DrawableGeofence>>.OfflineCached(
            new[] { Fence() }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(GeofenceDrawerState.Offline, vm.State);
        Assert.True(vm.HasFences);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DrawableGeofence>>.Loading(),
            RepositoryResult<IReadOnlyList<DrawableGeofence>>.Cached(new[] { Fence("1", "Home") }, Now, stale: false),
            RepositoryResult<IReadOnlyList<DrawableGeofence>>.Loaded(new[] { Fence("1", "Home"), Fence("2", "Work") }, Now));
        await vm.LoadAsync();

        Assert.Equal(GeofenceDrawerState.Loaded, vm.State);
        Assert.Equal(2, vm.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_loaded_all_non_renderable_falls_back_to_empty()
    {
        // A circle with a zero radius is not renderable; the projection yields no rows -> Empty.
        using var vm = NewViewModel(Loaded(new DrawableGeofence("1", Lat: 1, Lng: 2, RadiusMeters: 0, Name: "Bad")));
        await vm.LoadAsync();

        Assert.Equal(GeofenceDrawerState.Empty, vm.State);
        Assert.False(vm.HasFences);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DrawableGeofence>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Geofences", vm.Title);
        Assert.Equal("No geofences yet. Draw one on the map to begin.", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state()
    {
        using var vm = NewViewModel(Loaded(Fence()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(GeofenceDrawerViewModel.State), changed);
        Assert.Contains(nameof(GeofenceDrawerViewModel.Fences), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("geofence-drawer", GeofenceDrawerRegistration.Id);
        Assert.Equal("GeofenceDrawer", GeofenceDrawerRegistration.Slug);
        Assert.Equal("Geofences", GeofenceDrawerRegistration.Title(Localizer));
        Assert.False(string.IsNullOrWhiteSpace(GeofenceDrawerRegistration.Description(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(GeofenceDrawerRegistration.EmptyMessage(Localizer)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new GeofenceDrawerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=GeofenceDrawer", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<IReadOnlyList<DrawableGeofence>> Loaded(params DrawableGeofence[] fences) =>
        RepositoryResult<IReadOnlyList<DrawableGeofence>>.Loaded(fences, Now);

    private static GeofenceDrawerViewModel NewViewModel(params RepositoryResult<IReadOnlyList<DrawableGeofence>>[] emissions) =>
        new(new FakeGeofenceDrawerSource(emissions), Localizer);

    private sealed class FakeGeofenceDrawerSource(params RepositoryResult<IReadOnlyList<DrawableGeofence>>[] emissions) : IGeofenceDrawerSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<DrawableGeofence>>> StreamAsync(
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
