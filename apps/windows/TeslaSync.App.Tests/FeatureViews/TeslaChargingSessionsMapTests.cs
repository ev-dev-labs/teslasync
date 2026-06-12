using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Tesla charging-sessions map surface's UI-thread-free logic — the JSON parse adapter
/// (the <c>{sessions:[…]}</c> envelope + bare-array + numeric-string coercion), the cache-then-network result
/// mapper, the projection (the web <c>useMemo(center)</c> mean-coordinate fallback, the finite-coordinate marker
/// filter, the <c>kWh</c> / currency / uppercased-charger popup lines and the <c>markerLabel</c> aria text), the
/// repository source's request shape + offline fallback, the state-holder view-model's full state matrix
/// (loading / ready / empty / stale / offline / error), the i18n facade key coverage, the registry metadata and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/pages/TeslaChargingSessionsMap.tsx). The WinUI view itself is exercised by the app
/// build; its per-state branch selection is driven entirely by the view-model
/// <see cref="TeslaChargingSessionsMapState"/> asserted here.
/// </summary>
public sealed class TeslaChargingSessionsMapTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private const string SampleJson = """
    {
      "sessions": [
        {"session_id":101,"site_location_name":"Fremont SC","charge_start_datetime":"2026-05-01T15:30:00Z",
         "total_energy_added_wh":42000,"total_cost":12.5,"charger_type":"supercharger","latitude":37.5,"longitude":-121.9},
        {"session_id":102,"site_location_name":"","charge_start_datetime":"2026-05-02T09:00:00Z",
         "total_energy_added_wh":8000,"total_cost":null,"charger_type":null,"latitude":38.0,"longitude":-122.0},
        {"session_id":103,"site_location_name":"No Coords Site","charge_start_datetime":"2026-05-03T10:00:00Z",
         "total_energy_added_wh":5000,"total_cost":3.0,"charger_type":"destination","latitude":null,"longitude":null}
      ],
      "summary": {"total_sessions":3}
    }
    """;

    // ---- JSON parse adapter ---------------------------------------------------------

    [Fact]
    public void Data_parses_sessions_from_the_envelope()
    {
        var data = Sample();

        Assert.Equal(3, data.Sessions.Count);
        Assert.Equal(101, data.Sessions[0].SessionId);
        Assert.Equal("Fremont SC", data.Sessions[0].SiteLocationName);
        Assert.Equal(42000, data.Sessions[0].TotalEnergyAddedWh);
        Assert.Equal(12.5, data.Sessions[0].TotalCost);
        Assert.Equal("supercharger", data.Sessions[0].ChargerType);
        Assert.Equal(37.5, data.Sessions[0].Latitude);
        Assert.Equal(-121.9, data.Sessions[0].Longitude);
        Assert.NotNull(data.Sessions[0].ChargeStart);

        Assert.Equal(string.Empty, data.Sessions[1].SiteLocationName);
        Assert.Null(data.Sessions[1].TotalCost);
        Assert.Null(data.Sessions[1].ChargerType);

        Assert.Null(data.Sessions[2].Latitude);
        Assert.Null(data.Sessions[2].Longitude);
    }

    [Fact]
    public void Data_parses_a_bare_session_array()
    {
        using var doc = JsonDocument.Parse("""[{"session_id":7,"latitude":1.0,"longitude":2.0}]""");
        var data = TeslaChargingSessionsMapData.FromJson(doc.RootElement);

        var row = Assert.Single(data.Sessions);
        Assert.Equal(7, row.SessionId);
        Assert.Equal(1.0, row.Latitude);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("\"x\"")]
    [InlineData("123")]
    [InlineData("{}")]
    [InlineData("{\"summary\":{}}")]
    [InlineData("[]")]
    public void Data_is_empty_for_a_non_array_or_missing_sessions_body(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Empty(TeslaChargingSessionsMapData.FromJson(doc.RootElement).Sessions);
    }

    [Fact]
    public void Data_coerces_numeric_strings()
    {
        using var doc = JsonDocument.Parse(
            """{"sessions":[{"session_id":"55","total_energy_added_wh":"9000","latitude":"3.5","longitude":"4.5"}]}""");
        var row = Assert.Single(TeslaChargingSessionsMapData.FromJson(doc.RootElement).Sessions);

        Assert.Equal(55, row.SessionId);
        Assert.Equal(9000, row.TotalEnergyAddedWh);
        Assert.Equal(3.5, row.Latitude);
        Assert.Equal(4.5, row.Longitude);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(SampleJson);

        var cached = TeslaChargingSessionsMapResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(3, cached.Value!.Sessions.Count);

        var offline = TeslaChargingSessionsMapResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(3, offline.Value!.Sessions.Count);

        var loaded = TeslaChargingSessionsMapResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(101, loaded.Value!.Sessions[0].SessionId);
    }

    [Fact]
    public void Map_passes_loading_empty_and_error_through()
    {
        Assert.Equal(LoadStatus.Loading, TeslaChargingSessionsMapResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, TeslaChargingSessionsMapResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, TeslaChargingSessionsMapResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- Projection: viewport + markers + popup ------------------------------------

    [Fact]
    public void Center_is_the_mean_of_every_session_coordinate()
    {
        var display = TeslaChargingSessionsMapProjection.Project(Sample(), Localizer, Now);

        // Web parity: avg of (lat ?? 0) over ALL sessions, including the coordinate-less one (0,0).
        Assert.Equal((37.5 + 38.0 + 0) / 3, display.CenterLatitude, 4);
        Assert.Equal((-121.9 - 122.0 + 0) / 3, display.CenterLongitude, 4);
        Assert.Equal(5, display.Zoom);
        Assert.Equal(3, display.TotalSessions);
    }

    [Fact]
    public void Center_defaults_to_the_san_francisco_view_with_no_sessions()
    {
        var display = TeslaChargingSessionsMapProjection.Project(null, Localizer, Now);

        Assert.Equal(TeslaChargingSessionsMapProjection.DefaultCenterLatitude, display.CenterLatitude);
        Assert.Equal(TeslaChargingSessionsMapProjection.DefaultCenterLongitude, display.CenterLongitude);
        Assert.False(display.HasPoints);
        Assert.Equal(0, display.TotalSessions);
    }

    [Fact]
    public void Only_sessions_with_finite_coordinates_become_markers()
    {
        var display = TeslaChargingSessionsMapProjection.Project(Sample(), Localizer, Now);

        Assert.Equal(2, display.Points.Count); // 101 + 102; 103 has null coords
        Assert.Equal("101", display.Points[0].Id);
        Assert.Equal("102", display.Points[1].Id);
        Assert.Equal(TeslaChargingSessionsMapProjection.MarkerColorHex, display.Points[0].MarkerColor);
    }

    [Fact]
    public void Marker_popup_carries_site_energy_cost_and_uppercased_charger()
    {
        var first = TeslaChargingSessionsMapProjection.Project(Sample(), Localizer, Now).Points[0];

        Assert.Equal("Fremont SC", first.SiteName);
        // DetailLines: [date, energy, cost, charger].
        Assert.Equal(4, first.DetailLines.Count);
        Assert.Contains("42.0 kWh", first.DetailLines);
        Assert.Contains("$12.50", first.DetailLines);
        Assert.Contains("SUPERCHARGER", first.DetailLines);
    }

    [Fact]
    public void Marker_popup_omits_absent_cost_and_charger_and_falls_back_to_unknown()
    {
        var second = TeslaChargingSessionsMapProjection.Project(Sample(), Localizer, Now).Points[1];

        Assert.Equal("Unknown", second.SiteName); // empty site name → localized Unknown
        Assert.Equal("Unknown charging session", second.AriaLabel);
        Assert.Equal(2, second.DetailLines.Count); // [date, energy]; no cost / charger lines
        Assert.Contains("8.0 kWh", second.DetailLines);
        Assert.DoesNotContain(second.DetailLines, line => line.Contains('$', StringComparison.Ordinal));
    }

    [Fact]
    public void Marker_aria_label_interpolates_the_site_name()
    {
        var first = TeslaChargingSessionsMapProjection.Project(Sample(), Localizer, Now).Points[0];
        Assert.Equal("Fremont SC charging session", first.AriaLabel);
    }

    [Fact]
    public void Currency_symbol_override_is_honoured()
    {
        var first = TeslaChargingSessionsMapProjection.Project(Sample(), Localizer, Now, "€").Points[0];
        Assert.Contains("€12.50", first.DetailLines);
    }

    [Fact]
    public void Marker_label_interpolates_the_generated_catalog_token()
    {
        // The generated Windows catalog renders the web i18next "{{name}}" token as string.Format's "{0}"
        // (apps/shared/i18n/generators/gen-i18n.ts); the marker label must compose with that positional form,
        // not a literal "{{name}}" replace, or the real .resw value would surface as raw "{0} charging session".
        var catalog = new CatalogLocalizer("tesla_sessions.markerLabel", "{0} charging session");

        var display = TeslaChargingSessionsMapProjection.Project(Sample(), catalog, Now);

        Assert.Equal("Fremont SC charging session", display.Points[0].AriaLabel);
        Assert.Equal("Unknown charging session", display.Points[1].AriaLabel);
    }

    // ---- View-model state matrix (loading / ready / empty / stale / offline / error) ----

    [Fact]
    public async Task ViewModel_loading_then_ready_shows_the_markers()
    {
        var source = new FakeMapSource(
            RepositoryResult<TeslaChargingSessionsMapData>.Loading(),
            RepositoryResult<TeslaChargingSessionsMapData>.Loaded(Sample(), Now));
        using var vm = new TeslaChargingSessionsMapViewModel(source, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingSessionsMapState.Ready, vm.State);
        Assert.Equal(2, vm.Display.Points.Count);
        Assert.False(vm.IsFetching);
        Assert.NotNull(vm.UpdatedAt);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_empty_body_is_whole_surface_empty()
    {
        var source = new FakeMapSource(RepositoryResult<TeslaChargingSessionsMapData>.Empty(Now));
        using var vm = new TeslaChargingSessionsMapViewModel(source, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingSessionsMapState.Empty, vm.State);
        Assert.False(string.IsNullOrEmpty(vm.EmptyText));
        Assert.False(vm.Display.HasPoints);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_content_and_sets_stale_chip()
    {
        var source = new FakeMapSource(
            RepositoryResult<TeslaChargingSessionsMapData>.Cached(Sample(), Now, stale: true));
        using var vm = new TeslaChargingSessionsMapViewModel(source, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingSessionsMapState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Equal(2, vm.Display.Points.Count);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_content_and_sets_error_chip()
    {
        var source = new FakeMapSource(RepositoryResult<TeslaChargingSessionsMapData>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = new TeslaChargingSessionsMapViewModel(source, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingSessionsMapState.Offline, vm.State);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
        Assert.Equal(2, vm.Display.Points.Count);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache_shows_retry_state()
    {
        var source = new FakeMapSource(RepositoryResult<TeslaChargingSessionsMapData>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new TeslaChargingSessionsMapViewModel(source, Localizer, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(TeslaChargingSessionsMapState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.Display.HasPoints);
        Assert.False(string.IsNullOrEmpty(vm.RetryLabel));
        Assert.False(string.IsNullOrEmpty(vm.ErrorText));
    }

    [Fact]
    public async Task ViewModel_retry_reloads_from_the_source()
    {
        var source = new FakeMapSource(RepositoryResult<TeslaChargingSessionsMapData>.Loaded(Sample(), Now));
        using var vm = new TeslaChargingSessionsMapViewModel(source, Localizer, clock: () => Now);

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, source.Calls);
        Assert.Equal(TeslaChargingSessionsMapState.Ready, vm.State);
    }

    [Fact]
    public async Task ViewModel_status_announcement_tracks_the_state()
    {
        var stale = new FakeMapSource(RepositoryResult<TeslaChargingSessionsMapData>.Cached(Sample(), Now, stale: true));
        using var staleVm = new TeslaChargingSessionsMapViewModel(stale, Localizer, clock: () => Now);
        await staleVm.LoadAsync();
        Assert.Equal(staleVm.StaleLabel, staleVm.StatusAnnouncement);

        var ready = new FakeMapSource(RepositoryResult<TeslaChargingSessionsMapData>.Loaded(Sample(), Now));
        using var readyVm = new TeslaChargingSessionsMapViewModel(ready, Localizer, clock: () => Now);
        await readyVm.LoadAsync();
        Assert.Null(readyVm.StatusAnnouncement);
    }

    // ---- Repository source request shape (engine + fake client) --------------------

    [Fact]
    public async Task Source_requests_tesla_charging_sessions_with_no_params()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Sessions.Count);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_tesla_charging_sessions", request.OperationId);
        Assert.Null(request.PathParams);
        Assert.Null(request.Query);
    }

    [Fact]
    public async Task Source_falls_back_to_cache_when_the_network_fails()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        var cache = new InMemoryCacheStore();
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        var engine = new CacheThenNetworkEngine(cache, () => Now);

        var ok = new TeslaChargingSessionsMapSource(new FakeApiClient().ReturnsValue(doc.RootElement.Clone()), engine, options);
        _ = await Collect(ok.StreamAsync()); // warm the cache

        var down = new TeslaChargingSessionsMapSource(
            new FakeApiClient().Throws(new HttpRequestException("offline")), engine, options);
        var emissions = await Collect(down.StreamAsync());

        Assert.Equal(LoadStatus.Offline, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Sessions.Count);
    }

    // ---- i18n facade coverage + accessibility + registry + diagnostics -------------

    [Fact]
    public void Every_surface_string_resolves_through_the_facade_with_the_source_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = TeslaChargingSessionsMapProjection.Project(Sample(), recorder, Now);
        _ = TeslaChargingSessionsMapRegistration.StaleLabel(recorder);
        _ = TeslaChargingSessionsMapRegistration.OfflineLabel(recorder);
        _ = TeslaChargingSessionsMapRegistration.RetryLabel(recorder);
        _ = TeslaChargingSessionsMapRegistration.LoadingLabel(recorder);
        _ = TeslaChargingSessionsMapRegistration.ErrorText(recorder);

        // The three web-source keys, plus the empty + chrome keys, all resolve through the facade.
        Assert.Contains("tesla_sessions.mapLabel", recorder.Keys);
        Assert.Contains("tesla_sessions.unknown", recorder.Keys);
        Assert.Contains("tesla_sessions.markerLabel", recorder.Keys);
        Assert.Contains("tesla_sessions.noMapData", recorder.Keys);
        Assert.Contains("mqtt.stale", recorder.Keys);
        Assert.Contains("common.offline", recorder.Keys);
        Assert.Contains("common.retry", recorder.Keys);
        Assert.Contains("common.loading", recorder.Keys);
        Assert.Contains("error.loadFailed", recorder.Keys);
    }

    [Fact]
    public void Map_and_marker_labels_are_present_for_accessibility()
    {
        var display = TeslaChargingSessionsMapProjection.Project(Sample(), Localizer, Now);

        Assert.Equal("Charging sessions map", display.MapLabel);
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
        Assert.All(display.Points, point => Assert.False(string.IsNullOrWhiteSpace(point.AriaLabel)));
    }

    [Fact]
    public void Registration_exposes_a_stable_slug_and_currency_default()
    {
        Assert.Equal("TeslaChargingSessionsMap", TeslaChargingSessionsMapRegistration.Slug);
        Assert.Equal("$", TeslaChargingSessionsMapRegistration.DefaultCurrencySymbol);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug_and_no_payload()
    {
        var sink = new List<string>();
        var diagnostics = new TeslaChargingSessionsMapDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        var line = Assert.Single(sink);
        Assert.Equal("view.opened slug=TeslaChargingSessionsMap", line);
        Assert.DoesNotContain("Fremont", line, StringComparison.Ordinal);
    }

    // ---- helpers -------------------------------------------------------------------

    private static TeslaChargingSessionsMapData Sample()
    {
        using var doc = JsonDocument.Parse(SampleJson);
        return TeslaChargingSessionsMapData.FromJson(doc.RootElement);
    }

    private static TeslaChargingSessionsMapSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new TeslaChargingSessionsMapSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<TeslaChargingSessionsMapData>>> Collect(
        IAsyncEnumerable<RepositoryResult<TeslaChargingSessionsMapData>> stream)
    {
        var list = new List<RepositoryResult<TeslaChargingSessionsMapData>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeMapSource : ITeslaChargingSessionsMapSource
    {
        private readonly IReadOnlyList<RepositoryResult<TeslaChargingSessionsMapData>> _results;

        public FakeMapSource(params RepositoryResult<TeslaChargingSessionsMapData>[] results) => _results = results;

        public int Calls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<TeslaChargingSessionsMapData>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            foreach (var result in _results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
            }

            await Task.CompletedTask;
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    // Resolves one key to its generated-catalog value (e.g. the "{0}"-tokenized markerLabel), every other key
    // to the supplied English fallback — exercising the real resource shape the shell's Localization bridge serves.
    private sealed class CatalogLocalizer : ILocalizer
    {
        private readonly string _key;
        private readonly string _value;

        public CatalogLocalizer(string key, string value)
        {
            _key = key;
            _value = value;
        }

        public string GetString(string key, string fallback) =>
            string.Equals(key, _key, StringComparison.Ordinal) ? _value : fallback;
    }
}
