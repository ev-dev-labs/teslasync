using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the MediaNavigationPanel's UI-thread-free logic — the media + location JSON parse
/// adapters (with the web <c>cleanNil</c> filter and the SI-metres distance read), the playback-status badge
/// token mapping, the projection (the Now-Playing card + its title / artist fallbacks and source / status chips,
/// the active-route card with its converted distance and verbatim minutes, the Home / Work / Favorite presence
/// chips, the labels and accessibility names), the cache-then-network result mapper, the registration metadata,
/// the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline) plus unit re-projection. Mirrors the web spec
/// (web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx).
/// </summary>
public sealed class MediaNavigationPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 5, 0, TimeSpan.Zero);

    // ---- cleanNil filter (web lib/cleanNil.ts) -------------------------------------

    [Theory]
    [InlineData("<nil>", null)]
    [InlineData("nil", null)]
    [InlineData("null", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    [InlineData("Bohemian Rhapsody", "Bohemian Rhapsody")]
    public void CleanNil_strips_go_nil_strings(string? input, string? expected)
    {
        Assert.Equal(expected, MediaNavValues.CleanNil(input));
    }

    // ---- Media parse adapter -------------------------------------------------------

    [Fact]
    public void Media_FromResponse_reads_and_cleans_fields()
    {
        using var doc = JsonDocument.Parse("""
        {
          "now_playing_title": "Yellow",
          "now_playing_artist": "Coldplay",
          "playback_source": "Spotify",
          "playback_status": "Playing"
        }
        """);

        var media = MediaReading.FromResponse(doc.RootElement);

        Assert.NotNull(media);
        Assert.Equal("Yellow", media!.NowPlayingTitle);
        Assert.Equal("Coldplay", media.NowPlayingArtist);
        Assert.Equal("Spotify", media.PlaybackSource);
        Assert.Equal("Playing", media.PlaybackStatus);
    }

    [Fact]
    public void Media_FromResponse_applies_cleanNil_to_each_field()
    {
        using var doc = JsonDocument.Parse("""
        { "now_playing_title": "<nil>", "now_playing_artist": "null", "playback_source": "" }
        """);

        var media = MediaReading.FromResponse(doc.RootElement);

        Assert.NotNull(media);
        Assert.Null(media!.NowPlayingTitle);
        Assert.Null(media.NowPlayingArtist);
        Assert.Null(media.PlaybackSource);
        Assert.Null(media.PlaybackStatus);
    }

    [Fact]
    public void Media_FromResponse_object_with_missing_fields_parses_all_null()
    {
        using var doc = JsonDocument.Parse("{}");

        var media = MediaReading.FromResponse(doc.RootElement);

        Assert.NotNull(media);
        Assert.Null(media!.NowPlayingTitle);
        Assert.Null(media.NowPlayingArtist);
    }

    [Fact]
    public void Media_FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Null(MediaReading.FromResponse(doc.RootElement));

        using var arr = JsonDocument.Parse("[]");
        Assert.Null(MediaReading.FromResponse(arr.RootElement));
    }

    // ---- Navigation parse adapter --------------------------------------------------

    [Fact]
    public void Navigation_FromResponse_reads_destination_distance_minutes_and_places()
    {
        using var doc = JsonDocument.Parse("""
        {
          "destination_name": "Supercharger - Mountain View",
          "miles_to_arrival": 1500,
          "minutes_to_arrival": 15,
          "located_at_home": false,
          "located_at_work": true,
          "located_at_favorite": true
        }
        """);

        var nav = NavigationReading.FromResponse(doc.RootElement);

        Assert.NotNull(nav);
        Assert.Equal("Supercharger - Mountain View", nav!.DestinationName);
        Assert.True(nav.HasDestination);
        Assert.Equal(1500, nav.DistanceToArrivalM);   // SI metres on the wire (legacy field name)
        Assert.Equal(15, nav.MinutesToArrival);
        Assert.False(nav.LocatedAtHome);
        Assert.True(nav.LocatedAtWork);
        Assert.True(nav.LocatedAtFavorite);
        Assert.True(nav.HasPlaces);
    }

    [Fact]
    public void Navigation_FromResponse_without_destination_or_places_is_empty_shaped()
    {
        using var doc = JsonDocument.Parse("{}");

        var nav = NavigationReading.FromResponse(doc.RootElement);

        Assert.NotNull(nav);
        Assert.False(nav!.HasDestination);
        Assert.False(nav.HasPlaces);
        Assert.Null(nav.DistanceToArrivalM);
        Assert.Null(nav.MinutesToArrival);
    }

    [Fact]
    public void Navigation_FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Null(NavigationReading.FromResponse(doc.RootElement));
    }

    // ---- Playback-status badge mapping (web Badge colour) --------------------------

    [Theory]
    [InlineData("Playing", StatusKind.Success)]
    [InlineData("Paused", StatusKind.Warning)]
    [InlineData("Stopped", StatusKind.Neutral)]
    [InlineData("Buffering", StatusKind.Neutral)]
    [InlineData(null, StatusKind.Neutral)]
    public void PlaybackStatus_maps_each_web_colour(string? status, StatusKind expected)
    {
        Assert.Equal(expected, MediaNavigationPanelStatusTokens.PlaybackStatus(status));
    }

    // ---- Snapshot HasData gate -----------------------------------------------------

    [Fact]
    public void Snapshot_hasData_when_media_present_or_navigation_present()
    {
        Assert.True(new MediaNavigationSnapshot(Media("Song", "Artist"), Nav("Home Base")).HasData);
        Assert.True(new MediaNavigationSnapshot(Media("Song", "Artist"), null).HasData);
        Assert.True(new MediaNavigationSnapshot(null, Nav("Home Base")).HasData);
        Assert.False(new MediaNavigationSnapshot(null, null).HasData);
    }

    // ---- Projection: Now Playing ---------------------------------------------------

    [Fact]
    public void Project_builds_now_playing_card_with_source_and_status()
    {
        var snapshot = new MediaNavigationSnapshot(
            new MediaReading("Clocks", "Coldplay", "Spotify", "Playing"), null);

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal("Media & Navigation", view.Title);
        Assert.NotNull(view.NowPlaying);
        Assert.Equal("Clocks", view.NowPlaying!.Title);
        Assert.Equal("Coldplay", view.NowPlaying.Artist);
        Assert.Equal("Spotify", view.NowPlaying.Source);
        Assert.True(view.NowPlaying.HasSource);
        Assert.Equal("Playing", view.NowPlaying.StatusLabel);
        Assert.Equal(StatusKind.Success, view.NowPlaying.StatusKind);
        Assert.True(view.NowPlaying.HasStatus);
    }

    [Fact]
    public void Project_now_playing_applies_localized_fallbacks_for_missing_title_and_artist()
    {
        // Media object exists but its title / artist were cleaned to null — web shows the fallbacks.
        var snapshot = new MediaNavigationSnapshot(new MediaReading(null, null, null, null), null);

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.NotNull(view.NowPlaying);
        Assert.Equal("Nothing playing", view.NowPlaying!.Title);
        Assert.Equal("Unknown artist", view.NowPlaying.Artist);
        Assert.False(view.NowPlaying.HasSource);
        Assert.False(view.NowPlaying.HasStatus);
    }

    [Fact]
    public void Project_no_media_object_yields_null_now_playing_and_the_no_media_caption()
    {
        var view = MediaNavigationPanelProjection.Project(
            new MediaNavigationSnapshot(null, Nav("Home Base")), UnitPref.Metric, Localizer);

        Assert.Null(view.NowPlaying);
        Assert.Equal("No media data", view.NoMediaMessage);
    }

    // ---- Projection: Navigation ----------------------------------------------------

    [Fact]
    public void Project_builds_destination_card_with_metric_distance_and_minutes()
    {
        var snapshot = new MediaNavigationSnapshot(
            null, new NavigationReading("Home Base", 1500, 15, false, false, false));

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.True(view.HasNavigation);
        Assert.NotNull(view.Destination);
        Assert.Equal("Home Base", view.Destination!.Name);
        Assert.Equal("1.50 km", view.Destination.Distance);   // 1500 m -> 1.5 km, fmtNumber default precision 2
        Assert.Equal("15 min", view.Destination.Eta);          // minutes rendered verbatim (fmtInt)
        Assert.True(view.Destination.HasDistance);
        Assert.True(view.Destination.HasEta);
    }

    [Fact]
    public void Project_converts_destination_distance_to_imperial_display_unit()
    {
        var snapshot = new MediaNavigationSnapshot(
            null, new NavigationReading("Home Base", 1500, 15, false, false, false));

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Imperial, Localizer);

        Assert.Equal("0.93 mi", view.Destination!.Distance);   // 1500 m -> 0.932… mi -> "0.93"
        Assert.Equal("15 min", view.Destination.Eta);           // minutes are not unit-converted (web parity)
    }

    [Fact]
    public void Project_destination_zero_distance_is_a_value_not_hidden()
    {
        // Web renders miles_to_arrival when != null, even at 0.
        var snapshot = new MediaNavigationSnapshot(
            null, new NavigationReading("Home Base", 0, 0, false, false, false));

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.Equal("0.00 km", view.Destination!.Distance);
        Assert.Equal("0 min", view.Destination.Eta);
    }

    [Fact]
    public void Project_navigation_without_destination_yields_no_active_destination()
    {
        var snapshot = new MediaNavigationSnapshot(
            null, new NavigationReading(null, null, null, true, false, false));

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.True(view.HasNavigation);
        Assert.Null(view.Destination);
        Assert.Equal("No active destination", view.NoActiveDestinationMessage);
    }

    [Fact]
    public void Project_builds_only_the_active_presence_chips()
    {
        var snapshot = new MediaNavigationSnapshot(
            null, new NavigationReading(null, null, null, true, false, true));

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.Equal(2, view.Places.Count);
        Assert.Equal("Home", view.Places[0].Label);
        Assert.Equal(StatusKind.Success, view.Places[0].Status);
        Assert.Equal("Favorite", view.Places[1].Label);
        Assert.Equal(StatusKind.Warning, view.Places[1].Status);
        Assert.All(view.Places, p => Assert.False(string.IsNullOrEmpty(p.Marker)));
    }

    [Fact]
    public void Project_no_location_object_yields_no_location_caption()
    {
        var view = MediaNavigationPanelProjection.Project(
            new MediaNavigationSnapshot(Media("Song", "Artist"), null), UnitPref.Metric, Localizer);

        Assert.False(view.HasNavigation);
        Assert.Empty(view.Places);
        Assert.Null(view.Destination);
        Assert.Equal("No location data", view.NoLocationMessage);
    }

    [Fact]
    public void Project_empty_snapshot_has_no_data_but_resolves_messages()
    {
        var view = MediaNavigationPanelProjection.Project(
            new MediaNavigationSnapshot(null, null), UnitPref.Metric, Localizer);

        Assert.False(view.HasData);
        Assert.Null(view.NowPlaying);
        Assert.False(view.HasNavigation);
        Assert.False(string.IsNullOrWhiteSpace(view.EmptyMessage));
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var snapshot = new MediaNavigationSnapshot(
            new MediaReading(null, null, null, null),
            new NavigationReading(null, null, null, true, true, true));

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Metric, echo);

        Assert.Equal("L:telemetry.mediaNav", view.Title);
        Assert.Equal("L:telemetry.nowPlaying", view.NowPlayingLabel);
        Assert.Equal("L:telemetry.navigation", view.NavigationLabel);
        Assert.Equal("L:telemetry.noMediaData", view.NoMediaMessage);
        Assert.Equal("L:telemetry.noActiveDestination", view.NoActiveDestinationMessage);
        Assert.Equal("L:telemetry.noLocationData", view.NoLocationMessage);
        Assert.Equal("L:telemetry.nothingPlaying", view.NowPlaying!.Title);
        Assert.Equal("L:telemetry.unknownArtist", view.NowPlaying.Artist);
        Assert.Equal("L:telemetry.placeHome", view.Places[0].Label);
        Assert.Equal("L:telemetry.placeWork", view.Places[1].Label);
        Assert.Equal("L:telemetry.placeFavorite", view.Places[2].Label);
        Assert.Equal("L:telemetry.mediaNav.empty", view.EmptyMessage);
        Assert.Equal("L:telemetry.mediaNav.aria", view.AriaLabel);
    }

    [Fact]
    public void Project_eta_uses_the_min_short_catalog_key()
    {
        var echo = new KeyEchoLocalizer();
        var snapshot = new MediaNavigationSnapshot(
            null, new NavigationReading("Home Base", 1500, 15, false, false, false));

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Metric, echo);

        Assert.EndsWith("L:common.minShort", view.Destination!.Eta);
    }

    // ---- a11y: every card / chip carries a spoken name -----------------------------

    [Fact]
    public void Every_card_and_chip_carries_a_non_empty_automation_name()
    {
        var snapshot = new MediaNavigationSnapshot(
            new MediaReading("Clocks", "Coldplay", "Spotify", "Playing"),
            new NavigationReading("Home Base", 1500, 15, true, false, false));

        var view = MediaNavigationPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.Contains("Clocks", view.NowPlaying!.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Coldplay", view.NowPlaying.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Playing", view.NowPlaying.AutomationName, StringComparison.Ordinal);

        Assert.Contains("Home Base", view.Destination!.AutomationName, StringComparison.Ordinal);
        Assert.Contains("1.50 km", view.Destination.AutomationName, StringComparison.Ordinal);
        Assert.Contains("15 min", view.Destination.AutomationName, StringComparison.Ordinal);

        Assert.All(view.Places, p =>
        {
            Assert.False(string.IsNullOrWhiteSpace(p.AutomationName));
            Assert.Equal(p.Label, p.AutomationName);
        });
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_folds_navigation()
    {
        using var doc = JsonDocument.Parse("""{ "now_playing_title": "Clocks", "playback_status": "Paused" }""");
        var nav = Nav("Home Base");

        var cached = MediaNavigationPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true), nav);
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal("Clocks", cached.Value!.Media!.NowPlayingTitle);
        Assert.Equal(nav, cached.Value.Navigation);

        var offline = MediaNavigationPanelResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            nav);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(nav, offline.Value!.Navigation);
    }

    [Fact]
    public void Mapper_maps_loading_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, MediaNavigationPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loading(), null).Status);

        Assert.Equal(LoadStatus.Error, MediaNavigationPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            null).Status);
    }

    [Fact]
    public void Mapper_null_media_keeps_navigation_for_loaded()
    {
        using var doc = JsonDocument.Parse("null");
        var nav = Nav("Home Base");

        var loaded = MediaNavigationPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), nav);

        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Null(loaded.Value!.Media);
        Assert.Equal(nav, loaded.Value.Navigation);
        Assert.True(loaded.Value.HasData);
    }

    [Fact]
    public void Mapper_empty_status_becomes_navigation_only_loaded()
    {
        var nav = Nav("Home Base");

        var mapped = MediaNavigationPanelResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now), nav);

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Null(mapped.Value!.Media);
        Assert.Equal(nav, mapped.Value.Navigation);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<MediaNavigationSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(MediaNavigationPanelState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_sections()
    {
        using var vm = NewViewModel(Loaded(new MediaNavigationSnapshot(
            new MediaReading("Clocks", "Coldplay", "Spotify", "Playing"),
            new NavigationReading("Home Base", 1500, 15, true, false, false))));
        await vm.LoadAsync();

        Assert.Equal(MediaNavigationPanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display.NowPlaying);
        Assert.True(vm.Display.HasNavigation);
        Assert.NotNull(vm.Display.Destination);
        Assert.Single(vm.Display.Places);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_any_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(new MediaNavigationSnapshot(null, null)));
        await vm.LoadAsync();

        Assert.Equal(MediaNavigationPanelState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.Display.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<MediaNavigationSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(MediaNavigationPanelState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<MediaNavigationSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(MediaNavigationPanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<MediaNavigationSnapshot>.Cached(
            new MediaNavigationSnapshot(Media("Clocks", "Coldplay"), null), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(MediaNavigationPanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<MediaNavigationSnapshot>.OfflineCached(
            new MediaNavigationSnapshot(Media("Clocks", "Coldplay"), null),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(MediaNavigationPanelState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<MediaNavigationSnapshot>.Loading(),
            RepositoryResult<MediaNavigationSnapshot>.Cached(
                new MediaNavigationSnapshot(Media("Old", "Artist"), null), Now, stale: false),
            RepositoryResult<MediaNavigationSnapshot>.Loaded(
                new MediaNavigationSnapshot(Media("Clocks", "Coldplay"), Nav("Home Base")), Now));
        await vm.LoadAsync();

        Assert.Equal(MediaNavigationPanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("Clocks", vm.Display.NowPlaying!.Title);
        Assert.True(vm.Display.HasNavigation);
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(new MediaNavigationSnapshot(
            null, new NavigationReading("Home Base", 1500, 15, false, false, false))));
        await vm.LoadAsync();
        Assert.Equal("1.50 km", vm.Display.Destination!.Distance);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("0.93 mi", vm.Display.Destination!.Distance);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<MediaNavigationSnapshot>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Media & Navigation", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new MediaNavigationSnapshot(Media("Clocks", "Coldplay"), null)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(MediaNavigationPanelViewModel.State), changed);
        Assert.Contains(nameof(MediaNavigationPanelViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("media-navigation-panel", MediaNavigationPanelRegistration.Id);
        Assert.Equal("vehicles", MediaNavigationPanelRegistration.Category);
        Assert.Equal("MediaNavigationPanel", MediaNavigationPanelRegistration.Slug);
        Assert.Equal("Media & Navigation", MediaNavigationPanelRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MediaNavigationPanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MediaNavigationPanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static MediaReading Media(string? title, string? artist) => new(title, artist, null, null);

    private static NavigationReading Nav(string? destination) =>
        new(destination, null, null, false, false, false);

    private static RepositoryResult<MediaNavigationSnapshot> Loaded(MediaNavigationSnapshot snapshot) =>
        RepositoryResult<MediaNavigationSnapshot>.Loaded(snapshot, Now);

    private static MediaNavigationPanelViewModel NewViewModel(params RepositoryResult<MediaNavigationSnapshot>[] emissions) =>
        new(new FakeMediaNavigationPanelSource(emissions), Localizer);

    private sealed class FakeMediaNavigationPanelSource(params RepositoryResult<MediaNavigationSnapshot>[] emissions)
        : IMediaNavigationPanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<MediaNavigationSnapshot>> StreamAsync(
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
