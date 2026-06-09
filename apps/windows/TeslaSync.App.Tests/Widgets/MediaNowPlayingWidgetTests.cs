using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the MediaNowPlayingWidget's UI-thread-free logic — the JSON parse adapter (the
/// useMediaLatest read), the <c>m:ss</c> duration clock + volume formatters, the progress / volume fractions, the
/// title / artist / album / source fallbacks, the playing-chip guard, the projection, the Narrator name, the
/// footprint predicates (compact / tall), the result mapper, the single-endpoint per-vehicle data source (primary
/// resolution + the query-scoped media read), the registry metadata, the diagnostics, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx).
/// </summary>
public sealed class MediaNowPlayingWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string MediaJson =
        """{"vehicle_id":7,"now_playing_title":"Bohemian Rhapsody","now_playing_artist":"Queen","now_playing_album":"A Night at the Opera","playback_source":"Spotify","playback_status":"Playing","now_playing_duration":355000,"now_playing_elapsed":215000,"audio_volume":7,"audio_volume_max":11}""";

    private const string PausedStationJson =
        """{"now_playing_title":"Yesterday","now_playing_artist":"The Beatles","playback_status":"Paused","now_playing_station":"BBC Radio 2","now_playing_duration":0}""";

    // ---- Parse adapter (web useMediaLatest read) -----------------------------------

    [Fact]
    public void FromResponse_reads_all_media_fields()
    {
        using var doc = JsonDocument.Parse(MediaJson);

        var reading = MediaNowPlayingReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal("Bohemian Rhapsody", reading!.Title);
        Assert.Equal("Queen", reading.Artist);
        Assert.Equal("A Night at the Opera", reading.Album);
        Assert.Equal("Spotify", reading.PlaybackSource);
        Assert.Equal("Playing", reading.PlaybackStatus);
        Assert.Equal(355000, reading.DurationMs);
        Assert.Equal(215000, reading.ElapsedMs);
        Assert.Equal(7, reading.Volume);
        Assert.Equal(11, reading.VolumeMax);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":3}""");

        var reading = MediaNowPlayingReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.Title);
        Assert.Null(reading.Artist);
        Assert.Null(reading.Album);
        Assert.Null(reading.Station);
        Assert.Null(reading.PlaybackSource);
        Assert.Null(reading.PlaybackStatus);
        Assert.Null(reading.DurationMs);
        Assert.Null(reading.ElapsedMs);
        Assert.Null(reading.Volume);
        Assert.Null(reading.VolumeMax);
    }

    [Fact]
    public void FromResponse_treats_explicit_null_numbers_as_null()
    {
        using var doc = JsonDocument.Parse("""{"now_playing_duration":null,"audio_volume":null}""");

        var reading = MediaNowPlayingReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.DurationMs);
        Assert.Null(reading.Volume);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(MediaNowPlayingReading.FromResponse(doc.RootElement));
    }

    // ---- Duration clock formatter (web formatDurationClock) -------------------------

    [Theory]
    [InlineData(0, "0:00")]
    [InlineData(59000, "0:59")]
    [InlineData(60000, "1:00")]
    [InlineData(65000, "1:05")]
    [InlineData(215000, "3:35")]
    [InlineData(355000, "5:55")]
    public void FormatDurationClock_matches_web(double ms, string expected) =>
        Assert.Equal(expected, MediaNowPlayingProjection.FormatDurationClock(ms));

    [Theory]
    [InlineData(-1)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void FormatDurationClock_invalid_is_em_dash(double ms) =>
        Assert.Equal("\u2014", MediaNowPlayingProjection.FormatDurationClock(ms));

    // ---- Volume formatter (web raw {volume}) ---------------------------------------

    [Theory]
    [InlineData(7, "7")]
    [InlineData(0, "0")]
    [InlineData(5.5, "5.5")]
    public void FormatVolume_matches_web(double v, string expected) =>
        Assert.Equal(expected, MediaNowPlayingProjection.FormatVolume(v));

    // ---- Progress fraction (web min(n / d, 1)) -------------------------------------

    [Fact]
    public void ProgressOf_clamps_and_guards_zero_denominator()
    {
        Assert.Equal(0.606, MediaNowPlayingProjection.ProgressOf(215000, 355000), 3);
        Assert.Equal(0.636, MediaNowPlayingProjection.ProgressOf(7, 11), 3);
        Assert.Equal(0, MediaNowPlayingProjection.ProgressOf(5, 0));   // duration 0 → 0
        Assert.Equal(0, MediaNowPlayingProjection.ProgressOf(0, 0));
        Assert.Equal(1, MediaNowPlayingProjection.ProgressOf(20, 10)); // clamp to 1
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_renders_full_track()
    {
        var display = MediaNowPlayingProjection.Project(Reading(), Localizer);

        Assert.Equal("Bohemian Rhapsody", display.Title);
        Assert.Equal("Queen", display.Artist);
        Assert.Equal("A Night at the Opera", display.Album);
        Assert.Equal("Spotify", display.Source);
        Assert.True(display.HasSource);
        Assert.True(display.IsPlaying);
        Assert.Equal("Playing", display.PlayingChipText);
        Assert.True(display.HasDuration);
        Assert.Equal("3:35", display.ElapsedText);
        Assert.Equal("5:55", display.DurationText);
        Assert.Equal(0.606, display.ProgressFraction, 3);
        Assert.True(display.HasVolume);
        Assert.Equal("7", display.VolumeText);
        Assert.Equal(0.636, display.VolumeFraction, 3);
    }

    [Fact]
    public void Project_falls_back_title_artist_to_em_dash()
    {
        var reading = new MediaNowPlayingReading(null, null, null, null, null, null, null, null, null, null);

        var display = MediaNowPlayingProjection.Project(reading, Localizer);

        Assert.Equal("\u2014", display.Title);
        Assert.Equal("\u2014", display.Artist);
        Assert.Null(display.Album);
        Assert.Null(display.Source);
        Assert.False(display.HasSource);
        Assert.False(display.IsPlaying);
        Assert.False(display.HasDuration);
        Assert.False(display.HasVolume);
    }

    [Fact]
    public void Project_source_falls_back_to_station_and_hides_chip_when_paused()
    {
        using var doc = JsonDocument.Parse(PausedStationJson);
        var reading = MediaNowPlayingReading.FromResponse(doc.RootElement)!;

        var display = MediaNowPlayingProjection.Project(reading, Localizer);

        Assert.Equal("BBC Radio 2", display.Source); // playback_source absent → now_playing_station
        Assert.True(display.HasSource);
        Assert.False(display.IsPlaying);             // playback_status "Paused"
        Assert.False(display.HasDuration);           // duration 0
    }

    [Fact]
    public void Project_album_blank_is_dropped()
    {
        var reading = new MediaNowPlayingReading("T", "A", "", null, "Spotify", "Playing", 1000, 0, null, null);

        var display = MediaNowPlayingProjection.Project(reading, Localizer);

        Assert.Null(display.Album);
    }

    // ---- Accessibility (Narrator name) ---------------------------------------------

    [Fact]
    public void Project_automation_name_combines_track_and_active_chips()
    {
        var display = MediaNowPlayingProjection.Project(Reading(), Localizer);

        Assert.Equal(
            "Bohemian Rhapsody, Queen, A Night at the Opera, Playing, 3:35 / 5:55, Source Spotify, Volume 7",
            display.AutomationName);
    }

    [Fact]
    public void Project_automation_name_omits_inactive_sections()
    {
        var reading = new MediaNowPlayingReading("Yesterday", "The Beatles", null, null, null, "Paused", 0, 0, null, null);

        var display = MediaNowPlayingProjection.Project(reading, Localizer);

        Assert.Equal("Yesterday, The Beatles", display.AutomationName);
    }

    // ---- Footprint predicates (web isCompact / isTall) -----------------------------

    [Theory]
    [InlineData(1, 1, true, false)]   // compact
    [InlineData(2, 2, false, true)]   // tall (registry default)
    [InlineData(2, 1, false, false)]  // standard
    [InlineData(1, 2, false, true)]   // min footprint is already tall
    [InlineData(4, 40, false, true)]  // max footprint
    public void Size_predicates_match_web(int cols, int rows, bool compact, bool tall)
    {
        var size = new MediaNowPlayingSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(tall, size.IsTall);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_reading()
    {
        using var doc = JsonDocument.Parse(MediaJson);

        var cached = MediaNowPlayingResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal("Bohemian Rhapsody", cached.Value!.Title);

        var offline = MediaNowPlayingResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(355000, offline.Value!.DurationMs);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(MediaJson);

        Assert.Equal(LoadStatus.Loaded, MediaNowPlayingResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, MediaNowPlayingResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, MediaNowPlayingResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_null_body_to_empty()
    {
        // Web parity: a successful response with no media object (media == null) -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = MediaNowPlayingResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<MediaNowPlayingReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(MediaNowPlayingState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_media_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(MediaNowPlayingState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.NotNull(vm.Display);
        Assert.Equal("Bohemian Rhapsody", vm.Display!.Title);
        Assert.True(vm.Display.IsPlaying);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<MediaNowPlayingReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(MediaNowPlayingState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("Nothing playing", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<MediaNowPlayingReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(MediaNowPlayingState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<MediaNowPlayingReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(MediaNowPlayingState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<MediaNowPlayingReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(MediaNowPlayingState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<MediaNowPlayingReading>.Loading(),
            RepositoryResult<MediaNowPlayingReading>.Cached(new MediaNowPlayingReading("Old", "Artist", null, null, null, "Paused", 0, 0, null, null), Now, stale: false),
            RepositoryResult<MediaNowPlayingReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();

        Assert.Equal(MediaNowPlayingState.Loaded, vm.State);
        Assert.Equal("Bohemian Rhapsody", vm.Display!.Title);
        Assert.True(vm.Display.IsPlaying);
    }

    [Fact]
    public async Task ViewModel_size_change_raises_without_reprojecting()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Size = new MediaNowPlayingSize(1, 1);

        Assert.Contains(nameof(MediaNowPlayingViewModel.Size), changed);
        Assert.Equal(MediaNowPlayingState.Loaded, vm.State);
        Assert.Equal("Bohemian Rhapsody", vm.Display!.Title);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<MediaNowPlayingReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Now Playing", vm.Title);
        Assert.Equal("Nothing playing", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(MediaNowPlayingViewModel.State), changed);
        Assert.Contains(nameof(MediaNowPlayingViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("media-now-playing", MediaNowPlayingRegistration.Id);
        Assert.Equal("media", MediaNowPlayingRegistration.Category);
        Assert.Equal("MediaNowPlayingWidget", MediaNowPlayingRegistration.Slug);
        Assert.Equal(new MediaNowPlayingSize(2, 2), MediaNowPlayingRegistration.DefaultSize);
        Assert.Equal(new MediaNowPlayingSize(1, 2), MediaNowPlayingRegistration.MinSize);
        Assert.Equal(new MediaNowPlayingSize(4, 40), MediaNowPlayingRegistration.MaxSize);
        Assert.Equal("Now Playing", MediaNowPlayingRegistration.Name(Localizer));
        Assert.Equal("Current media: song title, artist, source", MediaNowPlayingRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(5, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, MediaNowPlayingRegistration.IsWithinBounds(new MediaNowPlayingSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new MediaNowPlayingSize(1, 2), MediaNowPlayingRegistration.Clamp(new MediaNowPlayingSize(0, 0)));
        Assert.Equal(new MediaNowPlayingSize(4, 40), MediaNowPlayingRegistration.Clamp(new MediaNowPlayingSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MediaNowPlayingDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MediaNowPlayingWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new MediaNowPlayingSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_media()
    {
        using var media = JsonDocument.Parse(MediaJson);
        var api = new FakeApiClient().ReturnsValue(media.RootElement);
        var source = new MediaNowPlayingSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("Bohemian Rhapsody", terminal.Value!.Title);
        Assert.Equal("Playing", terminal.Value.PlaybackStatus);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_media_latest", request.OperationId);
        Assert.Equal(7L, Assert.IsType<long>(request.Query!["vehicle_id"]));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var media = JsonDocument.Parse(PausedStationJson);
        var api = new FakeApiClient().ReturnsValue(media.RootElement);
        var source = new MediaNowPlayingSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(api.Requests[^1].Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal("Yesterday", results[^1].Value!.Title);
    }

    [Fact]
    public async Task Source_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(nullBody.RootElement);
        var source = new MediaNowPlayingSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static MediaNowPlayingReading Reading() =>
        new("Bohemian Rhapsody", "Queen", "A Night at the Opera", null, "Spotify", "Playing", 355000, 215000, 7, 11);

    private static async Task<List<RepositoryResult<MediaNowPlayingReading>>> Drain(IMediaNowPlayingSource source)
    {
        var list = new List<RepositoryResult<MediaNowPlayingReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<MediaNowPlayingReading> Loaded(MediaNowPlayingReading reading) =>
        RepositoryResult<MediaNowPlayingReading>.Loaded(reading, Now);

    private static MediaNowPlayingViewModel NewViewModel(params RepositoryResult<MediaNowPlayingReading>[] emissions) =>
        new(new FakeMediaNowPlayingSource(emissions), Localizer, MediaNowPlayingSize.Default);

    private sealed class FakeMediaNowPlayingSource(params RepositoryResult<MediaNowPlayingReading>[] emissions) : IMediaNowPlayingSource
    {
        public async IAsyncEnumerable<RepositoryResult<MediaNowPlayingReading>> StreamAsync(
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
