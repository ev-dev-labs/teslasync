using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the MapTileLayer shared surface's UI-thread-free logic — the registration metadata
/// (slug, automation ids, the live contract, the i18n keys/fallbacks and the Segoe Fluent glyphs), the
/// <see cref="MapTileLayerRegistration.ClassifyState"/> + provider/style label helpers, the
/// <see cref="MapTileLayerSnapshot.FromRepositoryResult"/> adapter (every cache-then-network state, incl. the
/// free-tile fallback and the offline-cached case), the pure <see cref="MapTileLayerProjection"/> (per-state
/// overlay gating, localized strings, attribution, the accessible-name contract and its key-safety), the
/// <see cref="MapTileLayerViewModel"/> state holder (initial projection, reprojection, refresh forwarding,
/// subscription cleanup), the static / repository seams (incl. style re-projection), and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/components/maps/MapTileLayer.tsx). The WinUI view itself
/// (shared-surfaces/MapTileLayer/MapTileLayer.cs) is exercised by the app build.
/// </summary>
public sealed class MapTileLayerTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("MapTileLayer", MapTileLayerRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("map-tile-layer", MapTileLayerRegistration.RootAutomationId);
        Assert.Equal("map-tile-layer-map", MapTileLayerRegistration.MapAutomationId);
        Assert.Equal("map-tile-layer-loading", MapTileLayerRegistration.LoadingAutomationId);
        Assert.Equal("map-tile-layer-error", MapTileLayerRegistration.ErrorAutomationId);
        Assert.Equal("map-tile-layer-status", MapTileLayerRegistration.StatusChipAutomationId);
        Assert.Equal("map-tile-layer-fullscreen", MapTileLayerRegistration.FullscreenAutomationId);
    }

    [Fact]
    public void Live_setting_is_polite() => Assert.Equal("polite", MapTileLayerRegistration.LiveSetting);

    [Fact]
    public void Freshness_window_matches_the_web_stale_time() =>
        Assert.Equal(TimeSpan.FromMinutes(5), MapTileLayerRegistration.FreshnessWindow);

    [Fact]
    public void Glyphs_are_the_shared_fluent_stand_ins()
    {
        Assert.Equal("\uE707", MapTileLayerRegistration.MapGlyph);
        Assert.Equal("\uEB5E", MapTileLayerRegistration.OfflineGlyph);
        Assert.Equal("\uE81C", MapTileLayerRegistration.StaleGlyph);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_are_stable()
    {
        // The web MapTileLayer.tsx has no t() calls (only brand attributions); these keys carry the WinUI literals.
        Assert.Equal("translation.mapTileLayer.loading", MapTileLayerRegistration.LoadingKey);
        Assert.Equal("Loading map...", MapTileLayerRegistration.LoadingFallback);
        Assert.Equal("translation.mapTileLayer.error.title", MapTileLayerRegistration.ErrorTitleKey);
        Assert.Equal("Map settings unavailable", MapTileLayerRegistration.ErrorTitleFallback);
        Assert.Equal("translation.mapTileLayer.error.message", MapTileLayerRegistration.ErrorMessageKey);
        Assert.Equal(
            "Couldn't load the map configuration. Showing default community tiles.",
            MapTileLayerRegistration.ErrorMessageFallback);
        Assert.Equal("translation.mapTileLayer.retry", MapTileLayerRegistration.RetryKey);
        Assert.Equal("Retry", MapTileLayerRegistration.RetryFallback);
        Assert.Equal("translation.mapTileLayer.fullscreen", MapTileLayerRegistration.FullscreenKey);
        Assert.Equal("Toggle fullscreen map", MapTileLayerRegistration.FullscreenFallback);
        Assert.Equal("translation.mapTileLayer.stale", MapTileLayerRegistration.StaleKey);
        Assert.Equal("Showing cached map settings", MapTileLayerRegistration.StaleFallback);
        Assert.Equal("translation.mapTileLayer.offline", MapTileLayerRegistration.OfflineKey);
        Assert.Equal("Offline - showing cached map settings", MapTileLayerRegistration.OfflineFallback);
        Assert.Equal("translation.mapTileLayer.empty", MapTileLayerRegistration.EmptyNoteKey);
        Assert.Equal("Using default community map tiles", MapTileLayerRegistration.EmptyNoteFallback);
        Assert.Equal("translation.mapTileLayer.accessibleName", MapTileLayerRegistration.AccessibleNameKey);
        Assert.Equal("Map base tiles - {0}, {1} style", MapTileLayerRegistration.AccessibleNameFallback);
    }

    // ── state classification ──────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(LoadStatus.Loading, false, MapTileLayerVisualState.Loading)]
    [InlineData(LoadStatus.Loaded, false, MapTileLayerVisualState.Ready)]
    [InlineData(LoadStatus.Empty, false, MapTileLayerVisualState.Empty)]
    [InlineData(LoadStatus.Error, false, MapTileLayerVisualState.Error)]
    [InlineData(LoadStatus.Offline, true, MapTileLayerVisualState.Offline)]
    [InlineData(LoadStatus.Cached, true, MapTileLayerVisualState.Stale)]
    [InlineData(LoadStatus.Cached, false, MapTileLayerVisualState.Ready)]
    [InlineData(LoadStatus.Refreshing, true, MapTileLayerVisualState.Stale)]
    [InlineData(LoadStatus.Refreshing, false, MapTileLayerVisualState.Ready)]
    public void ClassifyState_maps_each_load_status(LoadStatus status, bool stale, MapTileLayerVisualState expected) =>
        Assert.Equal(expected, MapTileLayerRegistration.ClassifyState(status, stale));

    [Theory]
    [InlineData(MapProvider.Free, "Community")]
    [InlineData(MapProvider.Azure, "Azure Maps")]
    [InlineData(MapProvider.Google, "Google Maps")]
    public void ProviderLabel_resolves_each_provider(MapProvider provider, string expected) =>
        Assert.Equal(expected, MapTileLayerRegistration.ProviderLabel(provider, Localizer));

    [Theory]
    [InlineData(MapStyleKind.Dark, "Dark")]
    [InlineData(MapStyleKind.Satellite, "Satellite")]
    [InlineData(MapStyleKind.Streets, "Streets")]
    [InlineData(MapStyleKind.Terrain, "Terrain")]
    public void StyleLabel_resolves_each_style(MapStyleKind style, string expected) =>
        Assert.Equal(expected, MapTileLayerRegistration.StyleLabel(style, Localizer));

    // ── snapshot adapter (RepositoryResult → snapshot): the web useQuery tile-table selection ───────────────

    [Fact]
    public void FromResult_loading_falls_back_to_free_tiles()
    {
        var snap = MapTileLayerSnapshot.FromRepositoryResult(
            RepositoryResult<MapConfig>.Loading(), MapStyleKind.Dark);

        Assert.Equal(MapTileLayerVisualState.Loading, snap.State);
        Assert.Equal(MapProvider.Free, snap.Provider);
        Assert.False(snap.HasApiKey);
        Assert.Equal("\u00a9 CARTO", snap.Attribution);
    }

    [Fact]
    public void FromResult_loaded_free_resolves_free_tiles()
    {
        var snap = MapTileLayerSnapshot.FromRepositoryResult(
            RepositoryResult<MapConfig>.Loaded(new MapConfig(), Now), MapStyleKind.Streets);

        Assert.Equal(MapTileLayerVisualState.Ready, snap.State);
        Assert.Equal(MapProvider.Free, snap.Provider);
        Assert.Equal("\u00a9 OpenStreetMap contributors", snap.Attribution);
    }

    [Fact]
    public void FromResult_loaded_azure_resolves_azure_tiles()
    {
        var snap = MapTileLayerSnapshot.FromRepositoryResult(
            RepositoryResult<MapConfig>.Loaded(new MapConfig(MapProvider.Azure, "key-123"), Now), MapStyleKind.Dark);

        Assert.Equal(MapTileLayerVisualState.Ready, snap.State);
        Assert.Equal(MapProvider.Azure, snap.Provider);
        Assert.True(snap.HasApiKey);
        Assert.Equal("\u00a9 Azure Maps", snap.Attribution);
    }

    [Fact]
    public void FromResult_loaded_google_resolves_google_tiles()
    {
        var snap = MapTileLayerSnapshot.FromRepositoryResult(
            RepositoryResult<MapConfig>.Loaded(new MapConfig(MapProvider.Google, "key-123"), Now), MapStyleKind.Satellite);

        Assert.Equal(MapProvider.Google, snap.Provider);
        Assert.Equal("\u00a9 Google Maps", snap.Attribution);
    }

    [Fact]
    public void FromResult_cached_stale_is_stale_and_keeps_the_value()
    {
        var snap = MapTileLayerSnapshot.FromRepositoryResult(
            RepositoryResult<MapConfig>.Cached(new MapConfig(MapProvider.Azure, "k"), Now, stale: true),
            MapStyleKind.Dark);

        Assert.Equal(MapTileLayerVisualState.Stale, snap.State);
        Assert.Equal(MapProvider.Azure, snap.Provider);
    }

    [Fact]
    public void FromResult_empty_falls_back_to_free_tiles()
    {
        var snap = MapTileLayerSnapshot.FromRepositoryResult(
            RepositoryResult<MapConfig>.Empty(Now), MapStyleKind.Dark);

        Assert.Equal(MapTileLayerVisualState.Empty, snap.State);
        Assert.Equal(MapProvider.Free, snap.Provider);
    }

    [Fact]
    public void FromResult_failure_falls_back_to_free_tiles()
    {
        var error = new RepositoryError(RepositoryErrorKind.Server, "boom");
        var snap = MapTileLayerSnapshot.FromRepositoryResult(
            RepositoryResult<MapConfig>.Failure(error), MapStyleKind.Dark);

        Assert.Equal(MapTileLayerVisualState.Error, snap.State);
        Assert.Equal(MapProvider.Free, snap.Provider);
        Assert.NotNull(snap.Error);
    }

    [Fact]
    public void FromResult_offline_cached_keeps_the_last_known_provider()
    {
        // web: a TanStack query retains its last successful `data` across a failed refetch — the configured tiles
        // keep rendering rather than reverting.
        var error = new RepositoryError(RepositoryErrorKind.Network, "offline");
        var snap = MapTileLayerSnapshot.FromRepositoryResult(
            RepositoryResult<MapConfig>.OfflineCached(new MapConfig(MapProvider.Azure, "k"), Now, error),
            MapStyleKind.Dark);

        Assert.Equal(MapTileLayerVisualState.Offline, snap.State);
        Assert.Equal(MapProvider.Azure, snap.Provider);
        Assert.True(snap.HasApiKey);
    }

    [Fact]
    public void FromResult_throws_when_the_result_is_null() =>
        Assert.Throws<ArgumentNullException>(() =>
            MapTileLayerSnapshot.FromRepositoryResult(null!, MapStyleKind.Dark));

    [Fact]
    public void Ready_factory_resolves_free_tiles_for_a_style()
    {
        var snap = MapTileLayerSnapshot.Ready(MapStyleKind.Terrain);

        Assert.Equal(MapTileLayerVisualState.Ready, snap.State);
        Assert.Equal(MapProvider.Free, snap.Provider);
        Assert.Equal("\u00a9 OpenTopoMap", snap.Attribution);
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_loading_shows_only_the_busy_overlay()
    {
        var projection = Project(RepositoryResult<MapConfig>.Loading());

        Assert.True(projection.ShowLoading);
        Assert.False(projection.ShowError);
        Assert.False(projection.ShowStaleChip);
        Assert.False(projection.ShowOfflineChip);
        Assert.False(projection.ShowEmptyNote);
        Assert.Equal("Loading map...", projection.LoadingLabel);
    }

    [Fact]
    public void Projection_ready_shows_no_chrome()
    {
        var projection = Project(RepositoryResult<MapConfig>.Loaded(new MapConfig(), Now));

        Assert.Equal(MapTileLayerVisualState.Ready, projection.State);
        Assert.False(projection.ShowLoading);
        Assert.False(projection.ShowError);
        Assert.False(projection.ShowStaleChip);
        Assert.False(projection.ShowOfflineChip);
        Assert.False(projection.ShowEmptyNote);
    }

    [Fact]
    public void Projection_empty_shows_the_free_tile_note()
    {
        var projection = Project(RepositoryResult<MapConfig>.Empty(Now));

        Assert.True(projection.ShowEmptyNote);
        Assert.Equal("Using default community map tiles", projection.EmptyNote);
    }

    [Fact]
    public void Projection_error_shows_the_error_overlay_with_retry()
    {
        var projection = Project(RepositoryResult<MapConfig>.Failure(new RepositoryError(RepositoryErrorKind.Server, "x")));

        Assert.True(projection.ShowError);
        Assert.Equal("Map settings unavailable", projection.ErrorTitle);
        Assert.Equal("Couldn't load the map configuration. Showing default community tiles.", projection.ErrorMessage);
        Assert.Equal("Retry", projection.RetryLabel);
    }

    [Fact]
    public void Projection_stale_shows_the_stale_chip()
    {
        var projection = Project(RepositoryResult<MapConfig>.Cached(new MapConfig(), Now, stale: true));

        Assert.True(projection.ShowStaleChip);
        Assert.Equal("Showing cached map settings", projection.StaleLabel);
    }

    [Fact]
    public void Projection_offline_shows_the_offline_chip()
    {
        var projection = Project(
            RepositoryResult<MapConfig>.OfflineCached(
                new MapConfig(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        Assert.True(projection.ShowOfflineChip);
        Assert.Equal("Offline - showing cached map settings", projection.OfflineLabel);
    }

    [Fact]
    public void Projection_carries_brand_attribution_verbatim()
    {
        var projection = Project(RepositoryResult<MapConfig>.Loaded(new MapConfig(MapProvider.Azure, "k"), Now));

        Assert.Equal("\u00a9 Azure Maps", projection.Attribution);
    }

    [Fact]
    public void Projection_throws_when_arguments_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => MapTileLayerProjection.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => MapTileLayerProjection.Project(MapTileLayerSnapshot.Ready(MapStyleKind.Dark), null!));
    }

    // ── accessibility + key safety ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_name_describes_the_provider_and_style()
    {
        var projection = Project(
            RepositoryResult<MapConfig>.Loaded(new MapConfig(MapProvider.Azure, "k"), Now), MapStyleKind.Satellite);

        Assert.Equal("Map base tiles - Azure Maps, Satellite style", projection.AccessibleName);
        Assert.Equal("Azure Maps", projection.ProviderLabelText);
        Assert.Equal("Satellite", projection.StyleLabelText);
    }

    [Fact]
    public void Accessible_name_never_leaks_the_provider_key()
    {
        // Security: the API key flows only to the tile renderer; it must never appear in the accessible name.
        const string secret = "super-secret-key-DEADBEEF";
        var projection = Project(
            RepositoryResult<MapConfig>.Loaded(new MapConfig(MapProvider.Google, secret), Now), MapStyleKind.Dark);

        Assert.DoesNotContain(secret, projection.AccessibleName, StringComparison.Ordinal);
        Assert.Equal(secret, projection.Config.ApiKey);
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_reprojects_when_the_snapshot_changes()
    {
        var source = new StaticMapTileLayerSource(MapTileLayerSnapshot.Ready(MapStyleKind.Dark));
        using var vm = new MapTileLayerViewModel(Localizer, source);
        Assert.Equal(MapTileLayerVisualState.Ready, vm.State);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(MapTileLayerSnapshot.FromRepositoryResult(
            RepositoryResult<MapConfig>.OfflineCached(
                new MapConfig(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            MapStyleKind.Dark));

        Assert.True(vm.ShowOfflineChip);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_forwards_refresh_to_the_seam()
    {
        var source = new StaticMapTileLayerSource(MapTileLayerSnapshot.Ready(MapStyleKind.Dark));
        using var vm = new MapTileLayerViewModel(Localizer, source);

        vm.RequestRefresh();
        vm.RequestRefresh();

        Assert.Equal(2, source.RefreshCount);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new StaticMapTileLayerSource(MapTileLayerSnapshot.Ready(MapStyleKind.Dark));
        var vm = new MapTileLayerViewModel(Localizer, source);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(MapTileLayerSnapshot.Ready(MapStyleKind.Streets));

        Assert.Equal(0, raised);
    }

    [Fact]
    public void View_model_throws_when_arguments_are_null()
    {
        var source = new StaticMapTileLayerSource(MapTileLayerSnapshot.Ready(MapStyleKind.Dark));
        Assert.Throws<ArgumentNullException>(() => new MapTileLayerViewModel(null!, source));
        Assert.Throws<ArgumentNullException>(() => new MapTileLayerViewModel(Localizer, null!));
    }

    // ── sources ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_set_moves_the_snapshot_and_notifies()
    {
        var source = new StaticMapTileLayerSource(MapTileLayerSnapshot.Ready(MapStyleKind.Dark));
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Set(MapTileLayerSnapshot.Ready(MapStyleKind.Terrain));

        Assert.Equal(MapStyleKind.Terrain, source.Current.Style);
        Assert.Equal(1, raised);
    }

    [Fact]
    public async Task Repository_source_projects_the_stream()
    {
        var source = new RepositoryMapTileLayerSource(Stream, MapStyleKind.Dark, autoStart: false);
        var settled = new TaskCompletionSource();
        source.Changed += (_, _) =>
        {
            if (source.Current.Provider == MapProvider.Azure)
            {
                settled.TrySetResult();
            }
        };

        source.Refresh();
        await settled.Task.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(MapProvider.Azure, source.Current.Provider);
        Assert.Equal(MapTileLayerVisualState.Ready, source.Current.State);
        source.Dispose();

        static async IAsyncEnumerable<RepositoryResult<MapConfig>> Stream(
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            yield return RepositoryResult<MapConfig>.Loading();
            await Task.Yield();
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<MapConfig>.Loaded(new MapConfig(MapProvider.Azure, "key-123"), Now);
        }
    }

    [Fact]
    public async Task Repository_source_reprojects_when_the_style_changes()
    {
        var source = new RepositoryMapTileLayerSource(Stream, MapStyleKind.Dark, autoStart: false);
        var settled = new TaskCompletionSource();
        source.Changed += (_, _) =>
        {
            if (source.Current.State == MapTileLayerVisualState.Ready)
            {
                settled.TrySetResult();
            }
        };

        source.Refresh();
        await settled.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var raised = 0;
        source.Changed += (_, _) => raised++;
        source.SetStyle(MapStyleKind.Satellite);

        Assert.Equal(MapStyleKind.Satellite, source.Current.Style);
        Assert.Equal(MapProvider.Azure, source.Current.Provider);
        Assert.Equal(1, raised);

        // Setting the same style again is a no-op.
        source.SetStyle(MapStyleKind.Satellite);
        Assert.Equal(1, raised);

        source.Dispose();

        static async IAsyncEnumerable<RepositoryResult<MapConfig>> Stream(
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            await Task.Yield();
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<MapConfig>.Loaded(new MapConfig(MapProvider.Azure, "key-123"), Now);
        }
    }

    [Fact]
    public void Repository_source_throws_when_the_stream_is_null() =>
        Assert.Throws<ArgumentNullException>(() => new RepositoryMapTileLayerSource(null!));

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MapTileLayerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=MapTileLayer", "view.opened slug=MapTileLayer" }, lines);
    }

    private static MapTileLayerProjection Project(
        RepositoryResult<MapConfig> result, MapStyleKind style = MapStyleKind.Dark) =>
        MapTileLayerProjection.Project(MapTileLayerSnapshot.FromRepositoryResult(result, style), Localizer);
}
