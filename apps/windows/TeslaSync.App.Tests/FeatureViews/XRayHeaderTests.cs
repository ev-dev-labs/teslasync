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
/// Headless verification of the Ingest X-Ray header surface's UI-thread-free logic — the JSON parse adapter,
/// the cache-then-network result mapper, the projection (grouped-integer formatting, the em-dash loading
/// gate, the window labels), the window/bucket wire mapping, the repository source's request shape (path
/// param + snake_case query), the state-holder view-model's full state matrix
/// (loading / ready / empty / stale / offline / error), the window-selection echo, the no-vehicle guard, the
/// registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/ingest-xray/XRayHeader.tsx). The WinUI view itself is exercised by the
/// app build; its per-state branch selection is driven entirely by the view-model <see cref="XRayHeaderState"/>
/// asserted here.
/// </summary>
public sealed class XRayHeaderTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- JSON parse adapter --------------------------------------------------------

    [Fact]
    public void Summary_parses_real_api_fields()
    {
        const string json = """
        {"vehicle_id":7,"window":"1h","bucket":"1m","generated_at":"2026-06-06T12:00:00Z",
         "total_samples":12345,"unique_fields":42,"fields":[],"buckets":[]}
        """;
        using var doc = JsonDocument.Parse(json);

        var summary = IngestXRaySummary.FromJson(doc.RootElement);

        Assert.Equal(12345, summary.TotalSamples);
        Assert.Equal(42, summary.UniqueFields);
        Assert.Equal("1h", summary.Window);
        Assert.Equal("1m", summary.Bucket);
        Assert.Equal("2026-06-06T12:00:00Z", summary.GeneratedAt);
    }

    [Fact]
    public void Summary_is_tolerant_of_missing_fields_numeric_strings_and_non_object()
    {
        using var partial = JsonDocument.Parse("""{"total_samples":"99"}""");
        var s = IngestXRaySummary.FromJson(partial.RootElement);
        Assert.Equal(99, s.TotalSamples); // numeric-string tolerated
        Assert.Equal(0, s.UniqueFields);  // missing → 0
        Assert.Equal(string.Empty, s.Window);
        Assert.Null(s.GeneratedAt);

        using var notObject = JsonDocument.Parse("[]");
        var empty = IngestXRaySummary.FromJson(notObject.RootElement);
        Assert.Equal(0, empty.TotalSamples);
        Assert.Equal(0, empty.UniqueFields);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"total_samples":7,"unique_fields":2}""");

        var cached = XRayHeaderResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(7, cached.Value!.TotalSamples);

        var offline = XRayHeaderResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(7, offline.Value!.TotalSamples);

        var loaded = XRayHeaderResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(2, loaded.Value!.UniqueFields);
    }

    [Fact]
    public void Map_passes_loading_empty_and_error_through()
    {
        Assert.Equal(LoadStatus.Loading, XRayHeaderResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, XRayHeaderResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, XRayHeaderResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- Projection (fmtInt + window labels) ---------------------------------------

    [Fact]
    public void Project_formats_integers_with_grouping()
    {
        var display = XRayHeaderProjection.Project(
            new IngestXRaySummary(1234567, 89, "1h", "1m", null), IngestXRayWindow.H1, Localizer);

        Assert.Equal("1,234,567", display.SamplesValue);
        Assert.Equal("89", display.FieldsValue);
        Assert.Equal("1 hour", display.WindowValue);
    }

    [Fact]
    public void Project_null_summary_renders_em_dash_but_keeps_window_label()
    {
        var display = XRayHeaderProjection.Project(null, IngestXRayWindow.M5, Localizer);

        Assert.Equal("\u2014", display.SamplesValue);
        Assert.Equal("\u2014", display.FieldsValue);
        Assert.Equal("5 minutes", display.WindowValue);
    }

    [Fact]
    public void Project_zero_samples_renders_zero_not_em_dash()
    {
        var display = XRayHeaderProjection.Project(
            new IngestXRaySummary(0, 0, "1h", "1m", null), IngestXRayWindow.H1, Localizer);

        Assert.Equal("0", display.SamplesValue);
        Assert.Equal("0", display.FieldsValue);
    }

    [Theory]
    [InlineData(0L, "0")]
    [InlineData(42L, "42")]
    [InlineData(12345L, "12,345")]
    [InlineData(1000000L, "1,000,000")]
    public void FormatInt_matches_web_fmtInt(long value, string expected) =>
        Assert.Equal(expected, XRayHeaderProjection.FormatInt(value));

    // ---- Window / bucket wire mapping ----------------------------------------------

    [Theory]
    [InlineData(IngestXRayWindow.M5, "5m", "5 minutes")]
    [InlineData(IngestXRayWindow.M15, "15m", "15 minutes")]
    [InlineData(IngestXRayWindow.H1, "1h", "1 hour")]
    [InlineData(IngestXRayWindow.H6, "6h", "6 hours")]
    [InlineData(IngestXRayWindow.H24, "24h", "24 hours")]
    public void Window_wire_label_and_roundtrip(IngestXRayWindow window, string wire, string label)
    {
        Assert.Equal(wire, IngestXRayWindows.Wire(window));
        Assert.Equal(label, IngestXRayWindows.LabelFallback(window));
        Assert.Equal("admin.xray.windowLabel." + wire, IngestXRayWindows.LabelKey(window));
        Assert.Equal(window, IngestXRayWindows.FromWire(wire));
        Assert.Equal(label, XRayHeaderProjection.WindowLabel(window, Localizer));
    }

    [Theory]
    [InlineData(IngestXRayBucket.S30, "30s")]
    [InlineData(IngestXRayBucket.M1, "1m")]
    [InlineData(IngestXRayBucket.M5, "5m")]
    [InlineData(IngestXRayBucket.M15, "15m")]
    [InlineData(IngestXRayBucket.H1, "1h")]
    public void Bucket_wire(IngestXRayBucket bucket, string wire) =>
        Assert.Equal(wire, IngestXRayBuckets.Wire(bucket));

    // ---- View-model state matrix (loading / ready / empty / stale / offline / error) ----

    [Fact]
    public async Task ViewModel_loading_then_ready_shows_formatted_counts()
    {
        var source = new FakeXRaySource(
            RepositoryResult<IngestXRaySummary>.Loading(),
            RepositoryResult<IngestXRaySummary>.Loaded(Summary(12345, 42), Now));
        using var vm = ConfiguredVm(source);

        await vm.LoadAsync();

        Assert.Equal(XRayHeaderState.Ready, vm.State);
        Assert.Equal("12,345", vm.Display.SamplesValue);
        Assert.Equal("42", vm.Display.FieldsValue);
        Assert.Equal("1 hour", vm.Display.WindowValue);
        Assert.False(vm.IsFetching);
        Assert.NotNull(vm.UpdatedAt);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_zero_samples_is_empty_with_zero_values()
    {
        var source = new FakeXRaySource(RepositoryResult<IngestXRaySummary>.Loaded(Summary(0, 0), Now));
        using var vm = ConfiguredVm(source);

        await vm.LoadAsync();

        Assert.Equal(XRayHeaderState.Empty, vm.State);
        Assert.Equal("0", vm.Display.SamplesValue);
        Assert.Equal("0", vm.Display.FieldsValue);
        Assert.False(string.IsNullOrEmpty(vm.EmptyHint));
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_values_and_sets_stale_chip()
    {
        var source = new FakeXRaySource(
            RepositoryResult<IngestXRaySummary>.Cached(Summary(5, 3), Now, stale: true));
        using var vm = ConfiguredVm(source);

        await vm.LoadAsync();

        Assert.Equal(XRayHeaderState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Equal("5", vm.Display.SamplesValue);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_values_and_sets_error_chip()
    {
        var source = new FakeXRaySource(RepositoryResult<IngestXRaySummary>.OfflineCached(
            Summary(9, 4), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        using var vm = ConfiguredVm(source);

        await vm.LoadAsync();

        Assert.Equal(XRayHeaderState.Offline, vm.State);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
        Assert.Equal("9", vm.Display.SamplesValue);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache_shows_em_dash_and_retry_state()
    {
        var source = new FakeXRaySource(RepositoryResult<IngestXRaySummary>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = ConfiguredVm(source);

        await vm.LoadAsync();

        Assert.Equal(XRayHeaderState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal("\u2014", vm.Display.SamplesValue);
        Assert.Equal("\u2014", vm.Display.FieldsValue);
        Assert.False(string.IsNullOrEmpty(vm.RetryLabel));
    }

    // ---- View-model: window echo + request context + no-vehicle guard --------------

    [Fact]
    public void ViewModel_window_selection_drives_window_label_immediately()
    {
        var source = new FakeXRaySource();
        using var vm = new XRayHeaderViewModel(source, Localizer);

        vm.Configure(7, IngestXRayWindow.H24, IngestXRayBucket.M1, XRayHeaderRegistration.DefaultLimit);

        Assert.Equal("24 hours", vm.Display.WindowValue); // before any load resolves
        Assert.Equal("\u2014", vm.Display.SamplesValue);
        Assert.Equal(0, source.Calls);
    }

    [Fact]
    public async Task ViewModel_passes_full_context_to_the_source()
    {
        var source = new FakeXRaySource(RepositoryResult<IngestXRaySummary>.Loaded(Summary(1, 1), Now));
        using var vm = new XRayHeaderViewModel(source, Localizer);
        vm.Configure(99, IngestXRayWindow.H6, IngestXRayBucket.M15, 50);

        await vm.LoadAsync();

        Assert.Equal(1, source.Calls);
        Assert.Equal(99, source.LastVehicleId);
        Assert.Equal(IngestXRayWindow.H6, source.LastWindow);
        Assert.Equal(IngestXRayBucket.M15, source.LastBucket);
        Assert.Equal(50, source.LastLimit);
    }

    [Fact]
    public async Task ViewModel_no_vehicle_is_empty_without_hitting_the_source()
    {
        var source = new FakeXRaySource(RepositoryResult<IngestXRaySummary>.Loaded(Summary(1, 1), Now));
        using var vm = new XRayHeaderViewModel(source, Localizer);
        vm.Configure(0, IngestXRayWindow.H1, IngestXRayBucket.M1, XRayHeaderRegistration.DefaultLimit);

        await vm.LoadAsync();

        Assert.Equal(XRayHeaderState.Empty, vm.State);
        Assert.Equal(0, source.Calls);
        Assert.Equal("\u2014", vm.Display.SamplesValue);
    }

    // ---- Repository source request shape (engine + fake client) --------------------

    [Fact]
    public async Task Source_requests_ingest_xray_with_path_param_and_snake_case_query()
    {
        using var doc = JsonDocument.Parse("""{"total_samples":3,"unique_fields":1}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync(7, IngestXRayWindow.H1, IngestXRayBucket.M1, 100));

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(3, emissions[^1].Value!.TotalSamples);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_system_ingest_xray_vehicleID", request.OperationId);
        Assert.Equal("7", request.PathParams!["vehicleID"]);
        Assert.Equal("1h", request.Query!["window"]);
        Assert.Equal("1m", request.Query!["bucket"]);
        Assert.Equal("100", request.Query!["limit"]?.ToString());
    }

    // ---- i18n facade coverage + registry + diagnostics -----------------------------

    [Fact]
    public void Every_source_string_resolves_through_the_facade_with_the_source_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = XRayHeaderRegistration.SamplesLabel(recorder);
        _ = XRayHeaderRegistration.SamplesSublabel(recorder);
        _ = XRayHeaderRegistration.FieldsLabel(recorder);
        _ = XRayHeaderRegistration.FieldsSublabel(recorder);
        _ = XRayHeaderRegistration.WindowTitle(recorder);
        _ = XRayHeaderRegistration.WindowSublabel(recorder);
        _ = XRayHeaderProjection.WindowLabel(IngestXRayWindow.H1, recorder);

        Assert.Contains("admin.xray.stats.samples", recorder.Keys);
        Assert.Contains("admin.xray.stats.samplesSub", recorder.Keys);
        Assert.Contains("admin.xray.stats.fields", recorder.Keys);
        Assert.Contains("admin.xray.stats.fieldsSub", recorder.Keys);
        Assert.Contains("admin.xray.stats.window", recorder.Keys);
        Assert.Contains("admin.xray.stats.windowSub", recorder.Keys);
        Assert.Contains("admin.xray.windowLabel.1h", recorder.Keys);
    }

    [Fact]
    public void Stat_labels_are_present_for_accessibility()
    {
        Assert.Equal("Total samples", XRayHeaderRegistration.SamplesLabel(Localizer));
        Assert.Equal("Distinct fields", XRayHeaderRegistration.FieldsLabel(Localizer));
        Assert.Equal("Window", XRayHeaderRegistration.WindowTitle(Localizer));
        Assert.False(string.IsNullOrWhiteSpace(XRayHeaderRegistration.SamplesSublabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(XRayHeaderRegistration.FieldsSublabel(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(XRayHeaderRegistration.WindowSublabel(Localizer)));
    }

    [Fact]
    public void Registration_exposes_stable_id_and_slug()
    {
        Assert.Equal("ingest-xray-header", XRayHeaderRegistration.Id);
        Assert.Equal("XRayHeader", XRayHeaderRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new XRayHeaderDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=XRayHeader", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static IngestXRaySummary Summary(long samples, long fields) =>
        new(samples, fields, "1h", "1m", "2026-06-06T12:00:00Z");

    private static XRayHeaderViewModel ConfiguredVm(FakeXRaySource source)
    {
        var vm = new XRayHeaderViewModel(source, Localizer);
        vm.Configure(7, IngestXRayWindow.H1, IngestXRayBucket.M1, XRayHeaderRegistration.DefaultLimit);
        return vm;
    }

    private static XRayHeaderSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new XRayHeaderSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<IngestXRaySummary>>> Collect(
        IAsyncEnumerable<RepositoryResult<IngestXRaySummary>> stream)
    {
        var list = new List<RepositoryResult<IngestXRaySummary>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeXRaySource : IXRayHeaderSource
    {
        private readonly IReadOnlyList<RepositoryResult<IngestXRaySummary>> _results;

        public FakeXRaySource(params RepositoryResult<IngestXRaySummary>[] results) => _results = results;

        public int Calls { get; private set; }

        public int LastVehicleId { get; private set; }

        public IngestXRayWindow LastWindow { get; private set; }

        public IngestXRayBucket LastBucket { get; private set; }

        public int LastLimit { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<IngestXRaySummary>> StreamAsync(
            int vehicleId,
            IngestXRayWindow window,
            IngestXRayBucket bucket,
            int limit,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            LastVehicleId = vehicleId;
            LastWindow = window;
            LastBucket = bucket;
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
