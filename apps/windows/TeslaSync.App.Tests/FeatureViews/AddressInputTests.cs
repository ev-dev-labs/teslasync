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
/// Headless verification of the <c>AddressInput</c> surface's UI-thread-free logic — the geocode JSON parse
/// adapter, the cache-then-network result mapper, the projection (option label / key, the three-character
/// minimum-length gate), the repository source's request shape (snake_case <c>q</c> + <c>limit</c>), the
/// state-holder view-model's full state matrix (idle / loading / ready / empty / stale / offline / error), the
/// minimum-length / no-call guard, the registry metadata, the i18n facade coverage and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/driving/components/AddressInput.tsx). The WinUI view itself is exercised
/// by the app build; its per-state branch selection is driven entirely by the view-model
/// <see cref="AddressInputState"/> asserted here.
/// </summary>
public sealed class AddressInputTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- JSON parse adapter --------------------------------------------------------

    [Fact]
    public void Suggestion_parses_real_api_fields()
    {
        var obj = Json("""{"display_name":"1 Infinite Loop, Cupertino, CA","lat":37.3318,"lng":-122.0312}""");

        var suggestion = GeocodeSuggestion.FromJson(obj);

        Assert.NotNull(suggestion);
        Assert.Equal("1 Infinite Loop, Cupertino, CA", suggestion!.DisplayName);
        Assert.Equal(37.3318, suggestion.Lat);
        Assert.Equal(-122.0312, suggestion.Lng);
    }

    [Fact]
    public void Suggestion_tolerates_numeric_strings_and_rejects_unusable_rows()
    {
        var numericStrings = GeocodeSuggestion.FromJson(Json("""{"display_name":"X","lat":"1.5","lng":"-2.5"}"""));
        Assert.Equal(1.5, numericStrings!.Lat);
        Assert.Equal(-2.5, numericStrings.Lng);

        // Missing coords default to 0; a blank / missing display_name has no label so the row is dropped.
        Assert.Equal(0, GeocodeSuggestion.FromJson(Json("""{"display_name":"Y"}"""))!.Lat);
        Assert.Null(GeocodeSuggestion.FromJson(Json("""{"lat":1,"lng":2}""")));
        Assert.Null(GeocodeSuggestion.FromJson(Json("""{"display_name":"  "}""")));
        Assert.Null(GeocodeSuggestion.FromJson(Json("[]")));
    }

    [Fact]
    public void Suggestions_array_parses_filters_blanks_and_tolerates_non_array()
    {
        var list = GeocodeSuggestions.FromJsonArray(Json("""
            [{"display_name":"A","lat":1,"lng":2},
             {"display_name":"  ","lat":3,"lng":4},
             {"display_name":"B","lat":5,"lng":6}]
            """));

        Assert.Equal(2, list.Count); // the blank-label row is dropped
        Assert.Equal("A", list[0].DisplayName);
        Assert.Equal("B", list[1].DisplayName);

        Assert.Empty(GeocodeSuggestions.FromJsonArray(Json("""{"not":"an array"}""")));
        Assert.Empty(GeocodeSuggestions.FromJsonArray(Json("[]")));
    }

    [Theory]
    [InlineData("[]", true)]
    [InlineData("""{"x":1}""", true)]
    [InlineData("""[{"display_name":"A","lat":1,"lng":2}]""", false)]
    public void Suggestions_IsEmpty_matches_array_emptiness(string json, bool expected) =>
        Assert.Equal(expected, GeocodeSuggestions.IsEmpty(Json(json)));

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        var array = Json("""[{"display_name":"A","lat":1,"lng":2},{"display_name":"B","lat":3,"lng":4}]""");

        var cached = AddressGeocodeResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(array, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.Count);

        var offline = AddressGeocodeResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            array, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal("A", offline.Value![0].DisplayName);

        var loaded = AddressGeocodeResultMapper.Map(RepositoryResult<JsonElement>.Loaded(array, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(2, loaded.Value!.Count);
    }

    [Fact]
    public void Map_passes_loading_empty_and_error_through()
    {
        Assert.Equal(LoadStatus.Loading, AddressGeocodeResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, AddressGeocodeResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, AddressGeocodeResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- Projection (option label / key + min-length gate) -------------------------

    [Fact]
    public void Projection_option_label_and_key_match_web()
    {
        var suggestion = new GeocodeSuggestion("221B Baker Street", 51.5237, -0.1585);

        Assert.Equal("221B Baker Street", AddressInputProjection.OptionLabel(suggestion));
        Assert.Equal("51.5237--0.1585-221B Baker Street", AddressInputProjection.OptionKey(suggestion));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("ab", false)]
    [InlineData("  a  ", false)]
    [InlineData("abc", true)]
    [InlineData(" abc ", true)]
    [InlineData("coffee", true)]
    public void Projection_min_length_gate_matches_web(string? query, bool expected) =>
        Assert.Equal(expected, AddressInputProjection.MeetsMinLength(query));

    // ---- View-model state matrix (idle / loading / ready / empty / stale / offline / error) ----

    [Fact]
    public async Task ViewModel_short_query_is_idle_without_hitting_the_source()
    {
        var source = new FakeGeocodeSource(Loaded(Suggestion("X")));
        using var vm = new AddressInputViewModel(source, Localizer);

        await vm.SetQueryAsync("ab");

        Assert.Equal(AddressInputState.Idle, vm.State);
        Assert.Equal(0, source.Calls);
        Assert.Empty(vm.Suggestions);
        Assert.Null(vm.StatusAnnouncement);
    }

    [Fact]
    public async Task ViewModel_loading_then_ready_exposes_suggestions()
    {
        var source = new FakeGeocodeSource(
            RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Loading(),
            Loaded(Suggestion("Cafe One"), Suggestion("Cafe Two")));
        using var vm = new AddressInputViewModel(source, Localizer);

        await vm.SetQueryAsync("cafe");

        Assert.Equal(AddressInputState.Ready, vm.State);
        Assert.Equal(2, vm.Suggestions.Count);
        Assert.True(vm.HasSuggestions);
        Assert.False(vm.IsFetching);
        Assert.NotNull(vm.UpdatedAt);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_empty_result_is_no_matches()
    {
        var source = new FakeGeocodeSource(RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Empty(Now));
        using var vm = new AddressInputViewModel(source, Localizer);

        await vm.SetQueryAsync("zzzzzz");

        Assert.Equal(AddressInputState.Empty, vm.State);
        Assert.Empty(vm.Suggestions);
        Assert.False(string.IsNullOrEmpty(vm.NoMatchesLabel));
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_suggestions_and_sets_stale()
    {
        var source = new FakeGeocodeSource(
            RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Cached(
                new[] { Suggestion("Cached Place") }, Now, stale: true));
        using var vm = new AddressInputViewModel(source, Localizer);

        await vm.SetQueryAsync("cached");

        Assert.Equal(AddressInputState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Single(vm.Suggestions);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_suggestions_and_sets_error()
    {
        var source = new FakeGeocodeSource(RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.OfflineCached(
            new[] { Suggestion("Last Good") }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = new AddressInputViewModel(source, Localizer);

        await vm.SetQueryAsync("last good");

        Assert.Equal(AddressInputState.Offline, vm.State);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
        Assert.Single(vm.Suggestions);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache_clears_suggestions_and_offers_retry()
    {
        var source = new FakeGeocodeSource(RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new AddressInputViewModel(source, Localizer);

        await vm.SetQueryAsync("boom");

        Assert.Equal(AddressInputState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Empty(vm.Suggestions);
        Assert.False(string.IsNullOrEmpty(vm.RetryLabel));
    }

    [Fact]
    public async Task ViewModel_clear_returns_to_idle()
    {
        var source = new FakeGeocodeSource(Loaded(Suggestion("X")));
        using var vm = new AddressInputViewModel(source, Localizer);
        await vm.SetQueryAsync("xray");
        Assert.Equal(AddressInputState.Ready, vm.State);

        vm.Clear();

        Assert.Equal(AddressInputState.Idle, vm.State);
        Assert.Empty(vm.Suggestions);
        Assert.Equal(string.Empty, vm.Query);
    }

    // ---- View-model: request context + min-length guard ----------------------------

    [Fact]
    public async Task ViewModel_passes_trimmed_query_and_limit_to_the_source()
    {
        var source = new FakeGeocodeSource(Loaded(Suggestion("Y")));
        using var vm = new AddressInputViewModel(source, Localizer) { Limit = 7 };

        await vm.SetQueryAsync("  downtown depot  ");

        Assert.Equal(1, source.Calls);
        Assert.Equal("downtown depot", source.LastQuery);
        Assert.Equal(7, source.LastLimit);
        Assert.Equal("downtown depot", vm.Query);
    }

    [Fact]
    public void ViewModel_limit_falls_back_to_default_for_non_positive()
    {
        var source = new FakeGeocodeSource();
        using var vm = new AddressInputViewModel(source, Localizer) { Limit = 0 };

        Assert.Equal(AddressInputRegistration.DefaultLimit, vm.Limit);
    }

    // ---- Repository source request shape (engine + fake client) --------------------

    [Fact]
    public async Task Source_requests_geocode_search_with_query_and_limit()
    {
        var client = new FakeApiClient().ReturnsValue(
            Json("""[{"display_name":"Pier 39, San Francisco","lat":37.8087,"lng":-122.4098}]"""));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync("pier", AddressInputRegistration.DefaultLimit));

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal("Pier 39, San Francisco", emissions[^1].Value![0].DisplayName);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_geocode_search", request.OperationId);
        Assert.Equal("pier", request.Query!["q"]);
        Assert.Equal("5", request.Query!["limit"]?.ToString());
    }

    [Fact]
    public async Task Source_empty_array_yields_empty_terminal()
    {
        var client = new FakeApiClient().ReturnsValue(Json("[]"));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync("nowhere", AddressInputRegistration.DefaultLimit));

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- i18n facade coverage + a11y + registry + diagnostics ----------------------

    [Fact]
    public void Every_source_string_resolves_through_the_facade_with_the_source_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = AddressInputRegistration.LabelText(recorder);
        _ = AddressInputRegistration.SearchingLabel(recorder);
        _ = AddressInputRegistration.NoMatchesLabel(recorder);
        _ = AddressInputRegistration.TypeMoreHint(recorder);
        _ = AddressInputRegistration.StaleLabel(recorder);
        _ = AddressInputRegistration.OfflineLabel(recorder);
        _ = AddressInputRegistration.RetryLabel(recorder);
        _ = AddressInputRegistration.ErrorText(recorder);
        _ = AddressInputRegistration.OfflineText(recorder);

        Assert.Contains("addressInput.label", recorder.Keys); // the one web-source key
        Assert.Contains("addressInput.searching", recorder.Keys);
        Assert.Contains("addressInput.noMatches", recorder.Keys);
        Assert.Contains("addressInput.retry", recorder.Keys);
        Assert.Contains("addressInput.error", recorder.Keys);
    }

    [Fact]
    public void Label_and_state_copy_are_present_for_accessibility()
    {
        Assert.Equal("Address", AddressInputRegistration.LabelText(Localizer)); // web t('addressInput.label','Address')
        Assert.False(string.IsNullOrWhiteSpace(AddressInputRegistration.SearchingLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(AddressInputRegistration.NoMatchesLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(AddressInputRegistration.RetryLabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(AddressInputRegistration.ErrorText(Localizer)));
    }

    [Fact]
    public void Registration_exposes_stable_id_slug_and_defaults()
    {
        Assert.Equal("address-input", AddressInputRegistration.Id);
        Assert.Equal("AddressInput", AddressInputRegistration.Slug);
        Assert.Equal(3, AddressInputRegistration.MinQueryLength);
        Assert.Equal(5, AddressInputRegistration.DefaultLimit);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new AddressInputDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AddressInput", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static GeocodeSuggestion Suggestion(string name) => new(name, 1.0, 2.0);

    private static RepositoryResult<IReadOnlyList<GeocodeSuggestion>> Loaded(params GeocodeSuggestion[] items) =>
        RepositoryResult<IReadOnlyList<GeocodeSuggestion>>.Loaded(items, Now);

    private static AddressGeocodeSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new AddressGeocodeSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<GeocodeSuggestion>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeocodeSuggestion>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<GeocodeSuggestion>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeGeocodeSource : IAddressGeocodeSource
    {
        private readonly IReadOnlyList<RepositoryResult<IReadOnlyList<GeocodeSuggestion>>> _results;

        public FakeGeocodeSource(params RepositoryResult<IReadOnlyList<GeocodeSuggestion>>[] results) =>
            _results = results;

        public int Calls { get; private set; }

        public string? LastQuery { get; private set; }

        public int LastLimit { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<GeocodeSuggestion>>> StreamAsync(
            string query,
            int limit,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            LastQuery = query;
            LastLimit = limit;

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
}
