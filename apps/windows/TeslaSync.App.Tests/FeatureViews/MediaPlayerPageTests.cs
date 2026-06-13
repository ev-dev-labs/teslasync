using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.VehicleSystems;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MediaPlayerPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx) with its loading / empty / error / success
/// matrix, the tolerant two-source parsers, the ported <c>statusVariant</c> / <c>statusLabel</c> /
/// <c>fmtPlayTime</c> helpers and the <c>stats</c> / <c>volumeChartData</c> / <c>sourceData</c> memos, the
/// twenty-six manifest i18n keys, the view-model state matrix, and the generated-client feed's request shaping
/// (web <c>useMediaLatest</c> + <c>useMediaHistory</c>). The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="MediaPlayerDisplay"/> flags asserted here.
/// </summary>
public sealed class MediaPlayerPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The twenty-six i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "Artist",
        "Avg Volume",
        "Media Player",
        "No playback history",
        "No playback history for this period",
        "No source data available",
        "No track",
        "No volume data for this period",
        "Now playing, volume, and listening history",
        "Paused",
        "Playback History",
        "Playing",
        "Source",
        "Source Distribution",
        "Status",
        "Stopped",
        "Time",
        "Top Source",
        "Track",
        "Unique Tracks",
        "Unknown artist",
        "Volume",
        "Volume Step",
        "Volume over Time",
        "error.loadFailed",
        "records",
    ];

    private static MediaReading SampleReading(
        string? title = "Bohemian Rhapsody",
        string? artist = "Queen",
        string? album = "A Night at the Opera",
        string? station = null,
        string? source = "Spotify",
        string? status = "Playing",
        double? durationMs = 354000,
        double? elapsedMs = 60000,
        double? volume = 7,
        double? volumeMax = 11,
        double? volumeIncrement = 0.5) =>
        new(title, artist, album, station, source, status, durationMs, elapsedMs, volume, volumeMax, volumeIncrement);

    private static MediaHistoryEntry HistoryEntry(
        long id = 1,
        string? title = "Bohemian Rhapsody",
        string? artist = "Queen",
        string? source = "Spotify",
        string? status = "Playing",
        double? volume = 7,
        double? volumeMax = 11,
        string? createdAt = "2026-06-10T08:00:00Z") =>
        new(
            id,
            title,
            artist,
            source,
            status,
            volume,
            volumeMax,
            createdAt is null
                ? null
                : DateTimeOffset.Parse(createdAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal));

    private static MediaPlayerModel SuccessModel(
        MediaReading? latest = null, IReadOnlyList<MediaHistoryEntry>? history = null) =>
        new(MediaPlayerSnapshot.Compose(latest ?? SampleReading(), history ?? [HistoryEntry()]), false, null);

    private static MediaPlayerDisplay Project(MediaPlayerModel model) =>
        MediaPlayerProjection.Project(model, Localizer, Now);

    // ---- i18n key coverage (all 26 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = MediaPlayerProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = MediaPlayerProjection.Project(MediaPlayerModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_twenty_six_unique_keys() =>
        Assert.Equal(26, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_primary_query_in_flight()
    {
        var display = Project(MediaPlayerModel.Initial);

        Assert.Equal(MediaPlayerState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_media_and_no_history()
    {
        var model = new MediaPlayerModel(MediaPlayerSnapshot.Empty, false, null);
        var display = Project(model);

        Assert.Equal(MediaPlayerState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.Equal("No playback history for this period", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_primary_query_failed()
    {
        var model = new MediaPlayerModel(MediaPlayerSnapshot.Empty, false, "network down");
        var display = Project(model);

        Assert.Equal(MediaPlayerState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("Failed to load data", display.ErrorText, StringComparison.Ordinal);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_latest_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(MediaPlayerState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void State_success_when_only_history_present()
    {
        var model = new MediaPlayerModel(MediaPlayerSnapshot.Compose(null, [HistoryEntry()]), false, null);
        var display = Project(model);

        Assert.Equal(MediaPlayerState.Success, display.State);
        Assert.True(display.ShowContent);
    }

    // ---- Now-playing card (GlassPanel1) -------------------------------------------

    [Fact]
    public void NowPlaying_falls_back_to_no_track_and_unknown_artist()
    {
        var latest = SampleReading(title: null, artist: null, album: null, status: null);
        var display = Project(SuccessModel(latest));

        Assert.Equal("No track", display.NowPlaying.TrackTitle);
        Assert.Equal("Unknown artist", display.NowPlaying.ArtistLine);
        Assert.False(display.NowPlaying.Status.Visible);
    }

    [Fact]
    public void NowPlaying_joins_artist_and_album_and_shows_status()
    {
        var display = Project(SuccessModel(SampleReading(artist: "Queen", album: "A Night at the Opera", status: "Playing")));

        Assert.Contains("Queen", display.NowPlaying.ArtistLine, StringComparison.Ordinal);
        Assert.Contains("A Night at the Opera", display.NowPlaying.ArtistLine, StringComparison.Ordinal);
        Assert.True(display.NowPlaying.Status.Visible);
        Assert.Equal("Playing", display.NowPlaying.Status.Text);
        Assert.Equal(StatusKind.Success, display.NowPlaying.Status.Status);
        Assert.True(display.NowPlaying.IsPlaying);
    }

    [Fact]
    public void NowPlaying_progress_clock_matches_fmt_play_time()
    {
        var display = Project(SuccessModel(SampleReading(durationMs: 354000, elapsedMs: 60000)));

        Assert.True(display.NowPlaying.HasProgress);
        Assert.Equal("1:00", display.NowPlaying.ElapsedText);
        Assert.Equal("5:54", display.NowPlaying.DurationText);
        Assert.Equal(60000.0 / 354000.0, display.NowPlaying.ProgressFraction, 4);
    }

    [Fact]
    public void NowPlaying_hides_progress_without_duration()
    {
        var display = Project(SuccessModel(SampleReading(durationMs: 0, elapsedMs: 0)));

        Assert.False(display.NowPlaying.HasProgress);
        Assert.Equal(0, display.NowPlaying.ProgressFraction);
    }

    [Theory]
    [InlineData("Playing", StatusKind.Success)]
    [InlineData("Paused", StatusKind.Warning)]
    [InlineData("Stopped", StatusKind.Neutral)]
    [InlineData(null, StatusKind.Neutral)]
    public void StatusVariant_follows_the_web_bands(string? status, StatusKind expected) =>
        Assert.Equal(expected, MediaPlayerProjection.StatusVariant(status));

    [Fact]
    public void StatusLabel_localizes_each_state()
    {
        var s = MediaStrings.Resolve(Localizer);

        Assert.Equal("Playing", MediaPlayerProjection.StatusLabel("Playing", s));
        Assert.Equal("Paused", MediaPlayerProjection.StatusLabel("paused", s));
        Assert.Equal("Stopped", MediaPlayerProjection.StatusLabel("idle", s));
    }

    [Theory]
    [InlineData(0, "0:00")]
    [InlineData(215000, "3:35")]
    [InlineData(60000, "1:00")]
    [InlineData(-5, "0:00")]
    public void PlayClock_formats_minutes_and_seconds(double ms, string expected) =>
        Assert.Equal(expected, MediaPlayerProjection.PlayClock(ms));

    // ---- Volume gauge (GlassPanel2) -----------------------------------------------

    [Fact]
    public void Volume_gauge_reads_latest_volume_and_max()
    {
        var display = Project(SuccessModel(SampleReading(volume: 7, volumeMax: 11)));

        Assert.Equal(7, display.VolumeValue);
        Assert.Equal(11, display.VolumeMax);
        Assert.Equal("Volume", display.VolumeLabel);
    }

    [Fact]
    public void Volume_gauge_defaults_max_to_eleven()
    {
        var display = Project(SuccessModel(SampleReading(volume: 3, volumeMax: null)));

        Assert.Equal(11, display.VolumeMax);
    }

    // ---- Four metric tiles (Unique-Tracks / Top-Source / Avg-Volume / Volume-Step) -

    [Fact]
    public void Metric_cards_project_four_tiles_with_labels()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.MetricCards.Count);
        Assert.Equal("Unique Tracks", display.MetricCards[0].Label);
        Assert.Equal("Top Source", display.MetricCards[1].Label);
        Assert.Equal("Avg Volume", display.MetricCards[2].Label);
        Assert.Equal("Volume Step", display.MetricCards[3].Label);
    }

    [Fact]
    public void Volume_step_tile_formats_increment_or_dash()
    {
        var withStep = Project(SuccessModel(SampleReading(volumeIncrement: 0.5)));
        Assert.Equal("0.50", withStep.MetricCards[3].Value);

        var noStep = Project(SuccessModel(SampleReading(volumeIncrement: null)));
        Assert.Equal("\u2014", noStep.MetricCards[3].Value);
    }

    // ---- Derived stats (web stats memo) -------------------------------------------

    [Fact]
    public void UniqueTracks_counts_distinct_non_empty_titles()
    {
        var history = new List<MediaHistoryEntry>
        {
            HistoryEntry(id: 1, title: "A"),
            HistoryEntry(id: 2, title: "A"),
            HistoryEntry(id: 3, title: "B"),
            HistoryEntry(id: 4, title: null),
        };

        Assert.Equal(2, MediaPlayerProjection.UniqueTracks(history));
    }

    [Fact]
    public void TopSource_returns_the_most_frequent_source_or_dash()
    {
        var history = new List<MediaHistoryEntry>
        {
            HistoryEntry(id: 1, source: "Spotify"),
            HistoryEntry(id: 2, source: "Spotify"),
            HistoryEntry(id: 3, source: "Bluetooth"),
        };

        Assert.Equal("Spotify", MediaPlayerProjection.TopSource(history));
        Assert.Equal("--", MediaPlayerProjection.TopSource(Array.Empty<MediaHistoryEntry>()));
    }

    [Fact]
    public void AverageVolume_is_the_mean_across_history()
    {
        var history = new List<MediaHistoryEntry>
        {
            HistoryEntry(id: 1, volume: 6),
            HistoryEntry(id: 2, volume: 8),
        };

        Assert.Equal(7, MediaPlayerProjection.AverageVolume(history));
        Assert.Equal(0, MediaPlayerProjection.AverageVolume(Array.Empty<MediaHistoryEntry>()));
    }

    // ---- Volume-over-Time chart (GlassPanel7) -------------------------------------

    [Fact]
    public void Volume_chart_sorts_points_ascending_by_time()
    {
        var history = new List<MediaHistoryEntry>
        {
            HistoryEntry(id: 1, volume: 3, createdAt: "2026-06-10T10:00:00Z"),
            HistoryEntry(id: 2, volume: 9, createdAt: "2026-06-10T08:00:00Z"),
        };

        var display = Project(SuccessModel(history: history));

        Assert.True(display.VolumeChart.HasData);
        Assert.Equal(2, display.VolumeChart.Points.Count);
        Assert.Equal(9, display.VolumeChart.Points[0].Y);
        Assert.Equal(3, display.VolumeChart.Points[1].Y);
        Assert.Equal(11, display.VolumeChart.YMax);
    }

    [Fact]
    public void Volume_chart_empty_without_history()
    {
        var model = new MediaPlayerModel(MediaPlayerSnapshot.Compose(SampleReading(), Array.Empty<MediaHistoryEntry>()), false, null);
        var display = Project(model);

        Assert.False(display.VolumeChart.HasData);
        Assert.Empty(display.VolumeChart.Points);
        Assert.Equal("No volume data for this period", display.VolumeChart.EmptyMessage);
    }

    // ---- Source-Distribution pie (GlassPanel8) ------------------------------------

    [Fact]
    public void Source_chart_buckets_and_sorts_slices_descending()
    {
        var history = new List<MediaHistoryEntry>
        {
            HistoryEntry(id: 1, source: "Spotify"),
            HistoryEntry(id: 2, source: "Spotify"),
            HistoryEntry(id: 3, source: "Bluetooth"),
            HistoryEntry(id: 4, source: null),
        };

        var display = Project(SuccessModel(history: history));

        Assert.True(display.SourceChart.HasData);
        Assert.Equal("Spotify", display.SourceChart.Slices[0].Label);
        Assert.Equal(2, display.SourceChart.Slices[0].Y);
        Assert.Contains(display.SourceChart.Legend, l => l.Name == "Unknown" && l.Count == 1);
        Assert.Equal(0, display.SourceChart.Legend[0].ColorIndex);
    }

    [Fact]
    public void Source_chart_empty_without_history()
    {
        var model = new MediaPlayerModel(MediaPlayerSnapshot.Compose(SampleReading(), Array.Empty<MediaHistoryEntry>()), false, null);
        var display = Project(model);

        Assert.False(display.SourceChart.HasData);
        Assert.Empty(display.SourceChart.Slices);
        Assert.Equal("No source data available", display.SourceChart.EmptyMessage);
    }

    // ---- Playback-history table (GlassPanel9) -------------------------------------

    [Fact]
    public void History_table_projects_columns_rows_and_records_badge()
    {
        var history = new List<MediaHistoryEntry>
        {
            HistoryEntry(id: 1, title: "Old", createdAt: "2026-06-09T08:00:00Z"),
            HistoryEntry(id: 2, title: "New", createdAt: "2026-06-11T08:00:00Z"),
        };

        var display = Project(SuccessModel(history: history));

        Assert.Collection(
            display.History.Columns,
            c => Assert.Equal("Time", c),
            c => Assert.Equal("Track", c),
            c => Assert.Equal("Artist", c),
            c => Assert.Equal("Source", c),
            c => Assert.Equal("Volume", c),
            c => Assert.Equal("Status", c));

        Assert.True(display.History.HasRows);
        Assert.Equal(2, display.History.RecordCount);
        Assert.Equal("2 records", display.History.RecordsBadge);

        // Newest-first (web default sort created_at desc).
        Assert.Equal("New", display.History.Rows[0].Track);
        Assert.Equal("Old", display.History.Rows[1].Track);
    }

    [Fact]
    public void History_row_formats_volume_cell_and_status()
    {
        var display = Project(SuccessModel(history: [HistoryEntry(volume: 7, volumeMax: 11, status: "Paused")]));

        var row = Assert.Single(display.History.Rows);
        Assert.Equal("7/11", row.Volume);
        Assert.Equal("Paused", row.Status);
        Assert.Equal(StatusKind.Warning, row.StatusKind);
    }

    [Fact]
    public void History_table_empty_messages_are_localized()
    {
        var model = new MediaPlayerModel(MediaPlayerSnapshot.Compose(SampleReading(), Array.Empty<MediaHistoryEntry>()), false, null);
        var display = Project(model);

        Assert.False(display.History.HasRows);
        Assert.Empty(display.History.Rows);
        Assert.Equal("No playback history", display.History.TableEmptyMessage);
        Assert.Equal("No playback history for this period", display.History.PanelEmptyMessage);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Reading_parses_snake_case_fields()
    {
        var reading = MediaReading.FromJson(Json(
            "{\"now_playing_title\":\"Song\",\"now_playing_artist\":\"Band\",\"now_playing_album\":\"Album\"," +
            "\"playback_source\":\"Spotify\",\"playback_status\":\"Playing\",\"now_playing_duration\":1000," +
            "\"now_playing_elapsed\":500,\"audio_volume\":5,\"audio_volume_max\":11,\"audio_volume_increment\":0.5}"));

        Assert.NotNull(reading);
        Assert.Equal("Song", reading!.Title);
        Assert.Equal("Band", reading.Artist);
        Assert.Equal("Spotify", reading.PlaybackSource);
        Assert.Equal(1000, reading.DurationMs);
        Assert.Equal(5, reading.Volume);
        Assert.Equal(0.5, reading.VolumeIncrement);
    }

    [Fact]
    public void Reading_is_null_for_a_non_object_body() =>
        Assert.Null(MediaReading.FromJson(Json("null")));

    [Fact]
    public void History_parses_an_array_of_objects()
    {
        var rows = MediaHistoryEntry.ParseList(Json(
            "[{\"id\":1,\"now_playing_title\":\"A\",\"audio_volume\":4,\"created_at\":\"2026-06-10T08:00:00Z\"}," +
            "{\"id\":2,\"now_playing_title\":\"B\",\"audio_volume\":8}]"));

        Assert.Equal(2, rows.Count);
        Assert.Equal(1, rows[0].Id);
        Assert.Equal("A", rows[0].Title);
        Assert.NotNull(rows[0].CreatedAt);
        Assert.Equal(8, rows[1].Volume);
    }

    [Fact]
    public void History_tolerates_a_non_array_body() =>
        Assert.Empty(MediaHistoryEntry.ParseList(Json("{}")));

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_media_into_the_success_state()
    {
        var feed = new FakeMediaFeed(MediaPlayerSnapshot.Compose(SampleReading(), [HistoryEntry()]));
        using var vm = new MediaPlayerPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(MediaPlayerState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new MediaPlayerPageViewModel(EmptyMediaPlayerFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(MediaPlayerState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new MediaPlayerPageViewModel(new ThrowingMediaFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(MediaPlayerState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeMediaFeed(MediaPlayerSnapshot.Compose(SampleReading(), [HistoryEntry()]));
        using var vm = new MediaPlayerPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useMediaLatest + useMediaHistory) -------------

    [Fact]
    public async Task ClientFeed_sends_both_operations_with_the_vehicle_id_and_limit()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"now_playing_title\":\"Song\",\"audio_volume\":5}"));
        api.ReturnsValue(Json("[{\"id\":1,\"now_playing_title\":\"Song\",\"audio_volume\":5}]"));
        var feed = new MediaPlayerClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasLatest);
        Assert.Equal("Song", snapshot.Latest!.Title);
        Assert.Single(snapshot.History);
        Assert.Equal(2, api.Requests.Count);
        Assert.Equal("get_api_v1_media_latest", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("get_api_v1_media", api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].Query!["vehicle_id"]?.ToString());
        Assert.Equal("500", api.Requests[1].Query!["limit"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_latest_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new MediaPlayerClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_degrades_gracefully_when_only_history_fails()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"now_playing_title\":\"Song\"}"));
        api.Throws(new ApiException("history subsystem down", 503));
        var feed = new MediaPlayerClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasLatest);
        Assert.Equal("Song", snapshot.Latest!.Title);
        Assert.Empty(snapshot.History);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new MediaPlayerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MediaPlayerPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("MediaPlayer", MediaPlayerRegistration.RouteName);
        Assert.Equal("get_api_v1_media_latest", MediaPlayerRegistration.LatestOperation);
        Assert.Equal("get_api_v1_media", MediaPlayerRegistration.HistoryOperation);
        Assert.Equal("Media Player", MediaPlayerRegistration.Title(Localizer));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeMediaFeed(MediaPlayerSnapshot snapshot) : IMediaPlayerFeed
    {
        public int FetchCount { get; private set; }

        public Task<MediaPlayerSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingMediaFeed : IMediaPlayerFeed
    {
        public Task<MediaPlayerSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
