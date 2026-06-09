using System.Globalization;
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
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the MediaHistoryWidget's UI-thread-free logic — the JSON parse adapter (the
/// canonical <c>now_playing_*</c> / <c>playback_*</c> wire fields the Go <c>MediaHandler.List</c> emits),
/// the projection (newest-first sort, maxItems cap, <c>🎵 {title} — {artist}</c> composition, the
/// <c>sourceLabel</c> map, the playing→token-brush mapping, the compact <c>list[0]</c> line), the
/// cache-then-network result mapper, the per-vehicle data source (primary resolution + the query-scoped
/// media read against <c>get_api_v1_media</c>), the registry metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/MediaHistoryWidget.tsx).
/// </summary>
public sealed class MediaHistoryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string T0 = "2026-06-06T10:00:00Z";
    private const string T1 = "2026-06-06T11:00:00Z";
    private const string T2 = "2026-06-06T12:00:00Z";

    private static MediaHistorySample Sample(
        long id = 1,
        string? title = "Song",
        string? artist = "Band",
        string? source = "Spotify",
        string? status = "playing",
        string? ts = T2) =>
        new(id, title, artist, source, status, ts is null ? null : DateTimeOffset.Parse(ts, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));

    private static IReadOnlyList<MediaHistorySample> Samples(params MediaHistorySample[] rows) => rows;

    private static MediaHistoryDisplay Project(IReadOnlyList<MediaHistorySample> samples, int cols, int rows) =>
        MediaHistoryProjection.Project(samples, new MediaHistorySize(cols, rows), Localizer, Now);

    // ---- Parse adapter (web useMediaHistory read of the Go /media wire shape) -------

    [Fact]
    public void FromJson_reads_canonical_wire_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            {"id":3,"vehicle_id":7,"now_playing_title":"Track A","now_playing_artist":"Artist A",
             "playback_source":"Spotify","playback_status":"playing","now_playing_station":"Radio X",
             "ts":"2026-06-06T12:00:00Z","created_at":"2026-06-06T12:00:00Z"}
            """);

        var sample = MediaHistorySample.FromJson(doc.RootElement);

        Assert.Equal(3, sample.Id);
        Assert.Equal("Track A", sample.Title);
        Assert.Equal("Artist A", sample.Artist);
        Assert.Equal("Spotify", sample.Source); // playback_source wins over now_playing_station
        Assert.Equal("playing", sample.PlaybackStatus);
        Assert.NotNull(sample.Timestamp);
    }

    [Fact]
    public void FromJson_falls_back_to_station_when_no_playback_source()
    {
        using var doc = JsonDocument.Parse(
            """{"id":1,"now_playing_title":"X","now_playing_station":"Radio X","ts":"2026-06-06T12:00:00Z"}""");

        var sample = MediaHistorySample.FromJson(doc.RootElement);

        Assert.Equal("Radio X", sample.Source); // playback_source absent -> now_playing_station fallback
    }

    [Fact]
    public void FromJson_uses_created_at_when_ts_absent()
    {
        using var doc = JsonDocument.Parse(
            """{"id":1,"now_playing_title":"X","created_at":"2026-06-06T11:00:00Z"}""");

        var sample = MediaHistorySample.FromJson(doc.RootElement);

        Assert.Equal(
            DateTimeOffset.Parse("2026-06-06T11:00:00Z", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
            sample.Timestamp);
    }

    [Fact]
    public void ParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":5}]""");

        var sample = Assert.Single(MediaHistorySample.ParseList(doc.RootElement));

        Assert.Equal(5, sample.Id);
        Assert.Null(sample.Title);
        Assert.Null(sample.Artist);
        Assert.Null(sample.Source);
        Assert.Null(sample.PlaybackStatus);
        Assert.Null(sample.Timestamp);
    }

    [Fact]
    public void ParseList_preserves_order()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"now_playing_title":"A"},{"id":2,"now_playing_title":"B"}]""");

        var list = MediaHistorySample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal("A", list[0].Title);
        Assert.Equal("B", list[1].Title);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(MediaHistorySample.ParseList(doc.RootElement));
    }

    // ---- Projection: feed (web WidgetEventFeed) ------------------------------------

    [Fact]
    public void Project_sorts_newest_first_and_caps_to_feed_budget()
    {
        var samples = new List<MediaHistorySample>();
        for (int i = 0; i < 12; i++)
        {
            // i=0 oldest … i=11 newest
            var ts = new DateTimeOffset(2026, 6, 6, 9, i, 0, TimeSpan.Zero);
            samples.Add(Sample(id: i, title: $"Track {i}", ts: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var view = Project(samples, 2, 4);

        Assert.Equal(MediaHistoryProjection.FeedMaxItems, view.Rows.Count); // capped at 10
        Assert.Contains("Track 11", view.Rows[0].Title, StringComparison.Ordinal);  // newest first
        Assert.Contains("Track 2", view.Rows[^1].Title, StringComparison.Ordinal);  // 10 newest of 0..11 -> 11..2
    }

    [Fact]
    public void Project_composes_emoji_title_with_track_and_artist()
    {
        var row = Project(Samples(Sample(title: "Song", artist: "Band")), 2, 4).Rows[0];

        string expected = $"{MediaHistoryProjection.NoteEmoji} Song {MediaHistoryProjection.EmDash} Band";
        Assert.Equal(expected, row.Title);
    }

    [Fact]
    public void Project_falls_back_to_em_dash_for_missing_title_and_artist()
    {
        var row = Project(Samples(Sample(title: null, artist: null)), 2, 4).Rows[0];

        string expected = $"{MediaHistoryProjection.NoteEmoji} {MediaHistoryProjection.EmDash} {MediaHistoryProjection.EmDash} {MediaHistoryProjection.EmDash}";
        Assert.Equal(expected, row.Title);
    }

    [Theory]
    [InlineData("usb", "USB")]
    [InlineData("USB", "USB")]
    [InlineData("spotify", "Spotify")]
    [InlineData("bluetooth", "Bluetooth")]
    public void Project_source_label_matches_web(string source, string expected)
    {
        var row = Project(Samples(Sample(source: source)), 2, 4).Rows[0];
        Assert.Equal(expected, row.Subtitle);
    }

    [Fact]
    public void Project_omits_subtitle_when_source_absent()
    {
        var row = Project(Samples(Sample(source: null)), 2, 4).Rows[0];
        Assert.Null(row.Subtitle);
    }

    [Theory]
    [InlineData("playing", true)]
    [InlineData("Playing", true)]   // case-insensitive (MediaNowPlaying emits "Playing")
    [InlineData("paused", false)]
    [InlineData(null, false)]
    public void Project_resolves_playing_presentation(string? status, bool playing)
    {
        var row = Project(Samples(Sample(status: status)), 2, 4).Rows[0];

        Assert.Equal(playing, row.IsPlaying);
        string expectedBrush = playing
            ? StatusResources.AccentBrushKey(StatusKind.Success)
            : StatusResources.AccentBrushKey(StatusKind.Neutral);
        Assert.Equal(expectedBrush, row.AccentBrushKey);
    }

    [Fact]
    public void Project_row_relative_time_matches_now()
    {
        var row = Project(Samples(Sample(ts: T2)), 2, 4).Rows[0]; // T2 is 5 minutes before Now
        Assert.Equal("5m ago", row.RelativeTime);
    }

    [Fact]
    public void Project_row_has_non_empty_accessibility_name()
    {
        var row = Project(Samples(Sample(title: "Yesterday", artist: "The Beatles", source: "spotify", ts: T2)), 2, 4).Rows[0];

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Yesterday", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("The Beatles", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Spotify", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Projection: compact (web CompactView, list[0]) ----------------------------

    [Fact]
    public void Project_compact_flag_tracks_single_column()
    {
        Assert.True(Project(Samples(Sample()), 1, 4).IsCompact);
        Assert.False(Project(Samples(Sample()), 2, 4).IsCompact);
    }

    [Fact]
    public void Project_compact_uses_raw_first_row_not_the_newest()
    {
        // Raw order: [First(old), Second(new)]. The feed shows Second first (newest); the compact line
        // shows First (web lastTrack = list[0], unsorted).
        var samples = Samples(
            Sample(id: 1, title: "First", artist: "FA", ts: T0),
            Sample(id: 2, title: "Second", artist: "SA", ts: T2));

        var compact = Project(samples, 1, 4);
        Assert.Equal($"First {MediaHistoryProjection.EmDash} FA", compact.CompactLine);

        var feed = Project(samples, 2, 4);
        Assert.Contains("Second", feed.Rows[0].Title, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_shows_no_tracks_message_when_title_missing()
    {
        var compact = Project(Samples(Sample(title: null)), 1, 4);
        Assert.Equal("No tracks played", compact.CompactLine);
    }

    [Fact]
    public void Project_empty_list_has_no_data_and_no_compact_line()
    {
        var view = Project(Samples(), 1, 4);

        Assert.False(view.HasData);
        Assert.Null(view.CompactLine);
        Assert.Empty(view.Rows);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"now_playing_title":"A","ts":"2026-06-06T12:00:00Z"}]""");

        var cached = MediaHistoryResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = MediaHistoryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_loaded_empty_array_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var mapped = MediaHistoryResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_maps_failure()
    {
        var mapped = MediaHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, mapped.Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MediaHistorySample>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(MediaHistoryState.Loading, vm.State);
        Assert.False(vm.Display.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Samples(Sample(id: 1), Sample(id: 2, ts: T1))));
        await vm.LoadAsync();

        Assert.Equal(MediaHistoryState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MediaHistorySample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(MediaHistoryState.Empty, vm.State);
        Assert.False(vm.Display.HasData);
        Assert.Equal("No tracks played", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MediaHistorySample>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(MediaHistoryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MediaHistorySample>>.Cached(Samples(Sample()), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(MediaHistoryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MediaHistorySample>>.OfflineCached(
            Samples(Sample()), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(MediaHistoryState.Offline, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<MediaHistorySample>>.Loading(),
            RepositoryResult<IReadOnlyList<MediaHistorySample>>.Cached(Samples(Sample(id: 1)), Now, stale: false),
            RepositoryResult<IReadOnlyList<MediaHistorySample>>.Loaded(Samples(Sample(id: 1), Sample(id: 2, ts: T1)), Now));
        await vm.LoadAsync();

        Assert.Equal(MediaHistoryState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_to_compact()
    {
        using var vm = NewViewModel(
            new MediaHistorySize(2, 4),
            RepositoryResult<IReadOnlyList<MediaHistorySample>>.Loaded(Samples(Sample()), Now));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new MediaHistorySize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(MediaHistoryState.Loaded, vm.State);
        Assert.NotNull(vm.Display.CompactLine);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<MediaHistorySample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Media History", vm.Title);
        Assert.Equal("No tracks played", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Samples(Sample())));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(MediaHistoryViewModel.State), changed);
        Assert.Contains(nameof(MediaHistoryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("media-history", MediaHistoryRegistration.Id);
        Assert.Equal("media", MediaHistoryRegistration.Category);
        Assert.Equal("MediaHistoryWidget", MediaHistoryRegistration.Slug);
        Assert.Equal(new MediaHistorySize(2, 4), MediaHistoryRegistration.DefaultSize);
        Assert.Equal(new MediaHistorySize(1, 2), MediaHistoryRegistration.MinSize);
        Assert.Equal(new MediaHistorySize(4, 40), MediaHistoryRegistration.MaxSize);
        Assert.Equal("Media History", MediaHistoryRegistration.Name(Localizer));
        Assert.Contains("tracks", MediaHistoryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(1, 1, false)]  // below min rows
    [InlineData(5, 40, false)] // above max cols
    [InlineData(4, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, MediaHistoryRegistration.IsWithinBounds(new MediaHistorySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new MediaHistorySize(1, 2), MediaHistoryRegistration.Clamp(new MediaHistorySize(0, 0)));
        Assert.Equal(new MediaHistorySize(4, 40), MediaHistoryRegistration.Clamp(new MediaHistorySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MediaHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MediaHistoryWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public void Source_operation_resolves_against_generated_endpoint_table()
    {
        // The inlined operation id must be a real generated endpoint (GET /api/v1/media).
        Assert.Contains(GeneratedApi.ApiEndpoints.All, e => e.OperationId == "get_api_v1_media");
    }

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new MediaHistorySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_media()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"now_playing_title":"A","ts":"2026-06-06T11:00:00Z"},{"id":2,"now_playing_title":"B","ts":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MediaHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_media", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"now_playing_title":"A","ts":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MediaHistorySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Convert.ToInt64(api.Requests[^1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MediaHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<MediaHistorySample>>>> Drain(IMediaHistorySource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<MediaHistorySample>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<MediaHistorySample>> Loaded(IReadOnlyList<MediaHistorySample> samples) =>
        RepositoryResult<IReadOnlyList<MediaHistorySample>>.Loaded(samples, Now);

    private static MediaHistoryViewModel NewViewModel(params RepositoryResult<IReadOnlyList<MediaHistorySample>>[] emissions) =>
        NewViewModel(MediaHistorySize.Default, emissions);

    private static MediaHistoryViewModel NewViewModel(
        MediaHistorySize size,
        params RepositoryResult<IReadOnlyList<MediaHistorySample>>[] emissions) =>
        new(new FakeMediaHistorySource(emissions), Localizer, size, () => Now);

    private sealed class FakeMediaHistorySource(params RepositoryResult<IReadOnlyList<MediaHistorySample>>[] emissions) : IMediaHistorySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MediaHistorySample>>> StreamAsync(
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
