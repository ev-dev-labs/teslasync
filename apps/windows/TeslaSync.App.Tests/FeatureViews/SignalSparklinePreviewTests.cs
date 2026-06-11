using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the signal-sparkline preview surface's UI-thread-free logic — the kind
/// normalization + numeric/non-numeric classification, the <c>envelopesToNumbers</c> series adapter, the
/// cache-then-network result mapper (with the web <c>numericSeries.length &lt; 2</c> em-dash collapse), the
/// state-holder view-model's per-state matrix (disabled / non-numeric / loading / loaded / empty / error /
/// stale / offline) and its enabled-gate flip, the localized copy + accessible names, the repository source's
/// request shape, the registry metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/telemetry/components/SignalSparklinePreview.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class SignalSparklinePreviewTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);

    private const string FloatHistory = """
    {
      "vehicle_id": 5,
      "signal": "VehicleSpeed",
      "expected_kind": "ValueKindFloat",
      "from": "2026-06-10T11:00:00Z",
      "to": "2026-06-10T12:00:00Z",
      "count": 3,
      "data": [
        { "kind": "ValueKindFloat", "value": 10.0, "ts": "2026-06-10T11:40:00Z" },
        { "kind": "ValueKindFloat", "value": 20.0, "ts": "2026-06-10T11:50:00Z" },
        { "kind": "ValueKindFloat", "value": 15.0, "ts": "2026-06-10T11:59:00Z" }
      ]
    }
    """;

    // ── Kind normalization / classification ──────────────────────────────────────────────────────────

    [Theory]
    [InlineData("\"ValueKindFloat\"", SignalKind.Float)]
    [InlineData("\"ValueKindDouble\"", SignalKind.Float)]
    [InlineData("\"ValueKindInt32\"", SignalKind.Int)]
    [InlineData("\"ValueKindInt64\"", SignalKind.Int)]
    [InlineData("\"ValueKindEnum\"", SignalKind.Int)]
    [InlineData("\"ValueKindBool\"", SignalKind.Bool)]
    [InlineData("\"ValueKindString\"", SignalKind.String)]
    [InlineData("\"ValueKindTime\"", SignalKind.Time)]
    [InlineData("\"ValueKindCompound\"", SignalKind.Unknown)]
    [InlineData("\"float\"", SignalKind.Float)]
    [InlineData("\"bool\"", SignalKind.Bool)]
    [InlineData("5", SignalKind.Float)]
    [InlineData("2", SignalKind.Bool)]
    [InlineData("3", SignalKind.Int)]
    [InlineData("9", SignalKind.Time)]
    [InlineData("\"nonsense\"", SignalKind.Unknown)]
    [InlineData("true", SignalKind.Unknown)]
    public void Normalize_maps_wire_kinds_to_compact_union(string json, SignalKind expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, SignalSparklineKinds.Normalize(doc.RootElement));
    }

    [Theory]
    [InlineData(SignalKind.Bool, true)]
    [InlineData(SignalKind.Int, true)]
    [InlineData(SignalKind.Float, true)]
    [InlineData(SignalKind.String, false)]
    [InlineData(SignalKind.Time, false)]
    [InlineData(SignalKind.Unknown, false)]
    public void IsNumeric_matches_web_non_numeric_set(SignalKind kind, bool numeric)
    {
        Assert.Equal(numeric, SignalSparklineKinds.IsNumeric(kind));
    }

    [Theory]
    [InlineData(SignalKind.String, "string")]
    [InlineData(SignalKind.Bool, "bool")]
    [InlineData(SignalKind.Int, "int")]
    [InlineData(SignalKind.Float, "float")]
    [InlineData(SignalKind.Time, "time")]
    [InlineData(SignalKind.Unknown, "unknown")]
    public void Token_renders_compact_kind_verbatim(SignalKind kind, string token)
    {
        Assert.Equal(token, SignalSparklineKinds.Token(kind));
    }

    // ── Series adapter (web envelopesToNumbers) ────────────────────────────────────────────────────────

    [Fact]
    public void FromHistory_keeps_numbers_in_wire_order()
    {
        using var doc = JsonDocument.Parse(FloatHistory);
        Assert.Equal(new double[] { 10, 20, 15 }, SignalSparklineSeries.FromHistory(doc.RootElement));
    }

    [Fact]
    public void FromHistory_folds_booleans_to_one_and_zero()
    {
        using var doc = JsonDocument.Parse("""
        { "data": [
          { "kind": "ValueKindBool", "value": true },
          { "kind": "ValueKindBool", "value": false },
          { "kind": "ValueKindBool", "value": true }
        ] }
        """);
        Assert.Equal(new double[] { 1, 0, 1 }, SignalSparklineSeries.FromHistory(doc.RootElement));
    }

    [Fact]
    public void FromHistory_coerces_numeric_strings_for_numeric_kinds_only()
    {
        using var doc = JsonDocument.Parse("""
        { "data": [
          { "kind": "ValueKindInt32", "value": "42" },
          { "kind": "ValueKindFloat", "value": "3.5" },
          { "kind": "ValueKindString", "value": "100" },
          { "kind": "ValueKindFloat", "value": "not-a-number" }
        ] }
        """);
        // The string-100 is a String kind (web coerceValue passes it through as a string → skipped); the
        // unparseable float string is skipped too. Only the int "42" and float "3.5" coerce.
        Assert.Equal(new double[] { 42, 3.5 }, SignalSparklineSeries.FromHistory(doc.RootElement));
    }

    [Fact]
    public void FromHistory_skips_null_time_and_string_values()
    {
        using var doc = JsonDocument.Parse("""
        { "data": [
          { "kind": "ValueKindFloat", "value": null },
          { "kind": "ValueKindTime", "value": "2026-06-10T11:40:00Z" },
          { "kind": "ValueKindString", "value": "Drive" },
          { "kind": "ValueKindFloat", "value": 7.0 }
        ] }
        """);
        Assert.Equal(new double[] { 7 }, SignalSparklineSeries.FromHistory(doc.RootElement));
    }

    [Fact]
    public void FromHistory_tolerant_of_missing_data_and_non_object()
    {
        using var noData = JsonDocument.Parse("""{"vehicle_id":5}""");
        Assert.Empty(SignalSparklineSeries.FromHistory(noData.RootElement));

        using var notObject = JsonDocument.Parse("[]");
        Assert.Empty(SignalSparklineSeries.FromHistory(notObject.RootElement));

        using var dataNotArray = JsonDocument.Parse("""{"data":{}}""");
        Assert.Empty(SignalSparklineSeries.FromHistory(dataNotArray.RootElement));
    }

    // ── Result mapper (cache-then-network preservation + < 2 collapse) ─────────────────────────────────

    [Fact]
    public void Map_loaded_with_two_or_more_points_is_loaded()
    {
        using var doc = JsonDocument.Parse(FloatHistory);
        var mapped = SignalSparklinePreviewResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Equal(3, mapped.Value!.Count);
    }

    [Fact]
    public void Map_loaded_with_fewer_than_two_points_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"data":[{"kind":"ValueKindFloat","value":42.0}]}""");
        var mapped = SignalSparklinePreviewResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Map_preserves_cached_stale_and_offline_status()
    {
        using var doc = JsonDocument.Parse(FloatHistory);

        var cached = SignalSparklinePreviewResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(3, cached.Value!.Count);

        var offline = SignalSparklinePreviewResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(3, offline.Value!.Count);
    }

    [Fact]
    public void Map_cached_with_fewer_than_two_points_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"data":[{"kind":"ValueKindFloat","value":1.0}]}""");
        var mapped = SignalSparklinePreviewResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: false));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Map_passes_through_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, SignalSparklinePreviewResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, SignalSparklinePreviewResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, SignalSparklinePreviewResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ── View-model: enabled / numeric gates ────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_disabled_renders_disabled_and_does_not_fetch()
    {
        var source = new CountingSource(Loaded());
        using var vm = new SignalSparklinePreviewViewModel(source, 5, "VehicleSpeed", SignalKind.Float, enabled: false, Localizer);

        Assert.Equal(SignalSparklinePreviewState.Disabled, vm.State);
        await vm.LoadAsync();

        Assert.Equal(SignalSparklinePreviewState.Disabled, vm.State);
        Assert.Equal(0, source.Calls);
    }

    [Fact]
    public async Task ViewModel_non_numeric_renders_chip_and_does_not_fetch()
    {
        var source = new CountingSource(Loaded());
        using var vm = new SignalSparklinePreviewViewModel(source, 5, "Gear", SignalKind.String, enabled: true, Localizer);

        Assert.Equal(SignalSparklinePreviewState.NonNumeric, vm.State);
        await vm.LoadAsync();

        Assert.Equal(SignalSparklinePreviewState.NonNumeric, vm.State);
        Assert.Equal(0, source.Calls);
        Assert.Equal("bool", SignalSparklineKinds.Token(SignalKind.Bool)); // sanity for chip token mapping
    }

    [Fact]
    public async Task ViewModel_loaded_with_series()
    {
        using var vm = NewViewModel(Loaded());
        await vm.LoadAsync();

        Assert.Equal(SignalSparklinePreviewState.Loaded, vm.State);
        Assert.True(vm.HasTrend);
        Assert.Equal(new double[] { 10, 20, 15 }, vm.Series);
        Assert.False(vm.IsError);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_window_renders_em_dash_state()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<double>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SignalSparklinePreviewState.Empty, vm.State);
        Assert.False(vm.HasTrend);
        Assert.Equal("No samples in last hour", vm.EmptyLabel);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<double>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SignalSparklinePreviewState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_series()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<double>>.Cached(
            Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SignalSparklinePreviewState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasTrend);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_series_and_sets_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<double>>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SignalSparklinePreviewState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.True(vm.HasTrend);
    }

    [Fact]
    public async Task ViewModel_set_enabled_flip_starts_and_stops_the_surface()
    {
        var source = new CountingSource(Loaded());
        using var vm = new SignalSparklinePreviewViewModel(source, 5, "VehicleSpeed", SignalKind.Float, enabled: false, Localizer);
        Assert.Equal(SignalSparklinePreviewState.Disabled, vm.State);

        Assert.True(vm.SetEnabled(true));
        Assert.NotEqual(SignalSparklinePreviewState.Disabled, vm.State);

        await vm.LoadAsync();
        Assert.Equal(SignalSparklinePreviewState.Loaded, vm.State);
        Assert.Equal(1, source.Calls);

        Assert.True(vm.SetEnabled(false));
        Assert.Equal(SignalSparklinePreviewState.Disabled, vm.State);
        Assert.False(vm.SetEnabled(false)); // idempotent
    }

    // ── View-model: localized copy + accessible names (a11y) ───────────────────────────────────────────

    [Fact]
    public async Task AccessibleName_is_present_for_every_visible_state()
    {
        using var loaded = NewViewModel(Loaded());
        await loaded.LoadAsync();
        Assert.Equal(loaded.TrendLabel, loaded.AccessibleName);
        Assert.False(string.IsNullOrWhiteSpace(loaded.TrendLabel));

        using var empty = NewViewModel(RepositoryResult<IReadOnlyList<double>>.Empty(Now));
        await empty.LoadAsync();
        Assert.Equal("No samples in last hour", empty.AccessibleName);

        using var error = NewViewModel(RepositoryResult<IReadOnlyList<double>>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await error.LoadAsync();
        Assert.Equal("Couldn't load signal trend", error.AccessibleName);

        using var stale = NewViewModel(RepositoryResult<IReadOnlyList<double>>.Cached(Sample(), Now, stale: true));
        await stale.LoadAsync();
        Assert.Contains("Stale", stale.AccessibleName, StringComparison.Ordinal);

        using var offline = NewViewModel(RepositoryResult<IReadOnlyList<double>>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await offline.LoadAsync();
        Assert.Contains("Offline", offline.AccessibleName, StringComparison.Ordinal);

        var nonNumericSource = new CountingSource(Loaded());
        using var chip = new SignalSparklinePreviewViewModel(nonNumericSource, 5, "Gear", SignalKind.Time, enabled: true, Localizer);
        Assert.Equal(chip.NonNumericTooltip, chip.AccessibleName);
        Assert.Contains("time", chip.AccessibleName, StringComparison.Ordinal);
    }

    [Fact]
    public void Localized_copy_matches_catalog_fallbacks()
    {
        var source = new CountingSource(Loaded());
        using var vm = new SignalSparklinePreviewViewModel(source, 5, "VehicleSpeed", SignalKind.Float, enabled: true, Localizer);

        Assert.Equal("No samples in last hour", vm.EmptyLabel);
        Assert.Equal("Non-numeric signal (float)", vm.NonNumericTooltip);
        Assert.Equal("Signal trend, last hour", vm.TrendLabel);
        Assert.Equal("Couldn't load signal trend", vm.ErrorLabel);
        Assert.Equal("Stale", vm.StaleLabel);
        Assert.Equal("Offline", vm.OfflineLabel);
        Assert.Equal("Retry", vm.RetryLabel);
    }

    // ── Repository source request shape (engine + fake client) ─────────────────────────────────────────

    [Fact]
    public async Task Source_streams_series_and_targets_the_history_operation_with_path_and_query()
    {
        using var doc = JsonDocument.Parse(FloatHistory);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamHistoryAsync(5, "VehicleSpeed"));

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.Count);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_signals_vehicleID_signalName_history", request.OperationId);
        Assert.Equal("5", request.PathParams!["vehicleID"]);
        Assert.Equal("VehicleSpeed", request.PathParams!["signalName"]);
        Assert.Equal(SignalSparklinePreviewQuery.Hours, Convert.ToInt32(request.Query!["hours"], CultureInfo.InvariantCulture));
        Assert.Equal(SignalSparklinePreviewQuery.Limit, Convert.ToInt32(request.Query!["limit"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_single_point_window_streams_empty()
    {
        using var doc = JsonDocument.Parse("""{"signal":"x","data":[{"kind":"ValueKindFloat","value":1.0}]}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamHistoryAsync(5, "x"));

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ── Registry + diagnostics ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("signal-sparkline-preview", SignalSparklinePreviewRegistration.Id);
        Assert.Equal("SignalSparklinePreview", SignalSparklinePreviewRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new SignalSparklinePreviewDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalSparklinePreview", Assert.Single(sink));
    }

    // ── helpers ────────────────────────────────────────────────────────────────────────────────────────

    private static SignalSparklinePreviewViewModel NewViewModel(RepositoryResult<IReadOnlyList<double>> result) =>
        new(new CountingSource(result), vehicleId: 5, "VehicleSpeed", SignalKind.Float, enabled: true, Localizer);

    private static SignalSparklinePreviewSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new SignalSparklinePreviewSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<double>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<double>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<double>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static IReadOnlyList<double> Sample() => new double[] { 10, 20, 15 };

    private static RepositoryResult<IReadOnlyList<double>> Loaded() =>
        RepositoryResult<IReadOnlyList<double>>.Loaded(Sample(), Now);

    private sealed class CountingSource : ISignalSparklinePreviewSource
    {
        private readonly RepositoryResult<IReadOnlyList<double>> _result;

        public CountingSource(RepositoryResult<IReadOnlyList<double>> result) => _result = result;

        public int Calls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<double>>> StreamHistoryAsync(
            long vehicleId,
            string signal,
            [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<IReadOnlyList<double>>.Loading();
            await Task.Yield();
            yield return _result;
        }
    }
}
