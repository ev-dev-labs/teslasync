using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.FeatureViews.IngestXRay;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>IngestXRayPage</c> surface's Microsoft.UI-free logic — the two data ports
/// (web <c>useVehicles</c> / <c>useIngestXRay</c>), the generated-client feed's request shaping + tolerant parsing,
/// the view-model's per-source loading / empty / success / error matrix, the no-vehicle gate, and the
/// selection → reload flow that drives the composed XRayControls / XRayHeader / XRayBucketChart / XRayFieldsTable
/// child models. The WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// view-model state asserted here.
/// </summary>
public sealed class IngestXRayPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Generated-client binding (web hook → operation id) ───────────────────────────────────────────────────────

    [Fact]
    public void Operations_ResolveAgainstTheGeneratedEndpointTable()
    {
        string[] operations =
        [
            IngestXRayPageRegistration.VehiclesOperation,
            IngestXRayPageRegistration.XRayOperation,
        ];

        foreach (string op in operations)
        {
            Assert.Contains(GeneratedApi.ApiEndpoints.All, e => e.OperationId == op);
        }
    }

    [Fact]
    public async Task VehiclesClientFeed_ShapesTheRequest_AndParsesTheFleet()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            """[ { "id": 7, "display_name": "Roadster", "vin": "5YJ" }, { "id": 8, "vin": "5YJABC" }, { "id": 0 } ]"""));
        var feed = new IngestXRayPageClientFeed(api);

        IReadOnlyList<VehicleOption> vehicles = await feed.FetchVehiclesAsync(CancellationToken.None);

        Assert.Equal(IngestXRayPageRegistration.VehiclesOperation, api.Requests[0].OperationId);
        Assert.Equal(2, vehicles.Count); // the id=0 row is dropped
        Assert.Equal(7, vehicles[0].Id);
        Assert.Equal("Roadster", vehicles[0].DisplayName);
        Assert.Equal("5YJABC", vehicles[1].Vin);
    }

    [Fact]
    public async Task XRayClientFeed_ShapesTheRequest_WithPathAndSnakeCaseQuery()
    {
        var api = new FakeApiClient().ReturnsValue(Json("""{ "total_samples": 0, "unique_fields": 0 }"""));
        var feed = new IngestXRayPageClientFeed(api);

        await feed.FetchXRayAsync(7, IngestXRayWindow.H6, IngestXRayBucket.M5, 100, CancellationToken.None);

        ApiRequest request = api.Requests[0];
        Assert.Equal(IngestXRayPageRegistration.XRayOperation, request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("7", request.PathParams![IngestXRayPageRegistration.VehiclePathParam]);
        Assert.NotNull(request.Query);
        Assert.Equal("6h", request.Query!["window"]);
        Assert.Equal("5m", request.Query!["bucket"]);
        Assert.Equal(100, request.Query!["limit"]);
    }

    [Fact]
    public async Task XRayClientFeed_ParsesSummaryBucketsAndFields()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            """
            {
              "total_samples": 1234,
              "unique_fields": 2,
              "window": "1h",
              "bucket": "1m",
              "buckets": [ { "bucket_start": "2026-06-06T12:00:00Z", "count": 10 }, { "bucket_start": "2026-06-06T12:01:00Z", "count": 5 } ],
              "fields": [ { "field": "VehicleSpeed", "sample_count": 800, "last_seen_at": "2026-06-06T12:01:00Z", "value_kind": 6 }, { "field": "Soc", "sample_count": 434, "last_seen_at": "2026-06-06T12:00:30Z", "value_kind": 5 } ]
            }
            """));
        var feed = new IngestXRayPageClientFeed(api);

        IngestXRayPageData data = await feed.FetchXRayAsync(
            7, IngestXRayWindow.H1, IngestXRayBucket.M1, 100, CancellationToken.None);

        Assert.Equal(1234, data.Summary.TotalSamples);
        Assert.Equal(2, data.Summary.UniqueFields);
        Assert.False(data.HasNoData);
        Assert.Equal(2, data.Buckets.Count);
        Assert.Equal("2026-06-06T12:00:00Z", data.Buckets[0].BucketStart);
        Assert.Equal(10, data.Buckets[0].Count);
        Assert.Equal(2, data.Fields.Count);
        Assert.Equal("VehicleSpeed", data.Fields[0].Field);
        Assert.Equal(800, data.Fields[0].SampleCount);
        Assert.Equal(6, data.Fields[0].ValueKind);
    }

    [Fact]
    public void ParseXRay_TolerantOfNonObjectBody()
    {
        IngestXRayPageData data = IngestXRayPageClientFeed.ParseXRay(Json("null"));
        Assert.True(data.HasNoData);
        Assert.Empty(data.Buckets);
        Assert.Empty(data.Fields);
    }

    // ── useVehicles data states (loading → success → empty → error) ──────────────────────────────────────────────

    [Fact]
    public void InitialState_IsVehiclesLoading_AndNoVehicleSelected()
    {
        using var vm = NewViewModel();

        Assert.Equal(XRayVehiclesStatus.Loading, vm.ControlsModel.VehiclesStatus);
        Assert.True(vm.ShowNoVehicle);
        Assert.False(vm.HasVehicle);
        Assert.Null(vm.VehicleId);
    }

    [Fact]
    public async Task LoadAsync_VehiclesSuccess_ResolvesTheControls()
    {
        using var vm = NewViewModel(new FakeFeed(new[] { Vehicle(7, "Roadster") }, _ => Data(0, [], [])));

        await vm.LoadAsync();

        Assert.Equal(XRayVehiclesStatus.Resolved, vm.ControlsModel.VehiclesStatus);
        Assert.Single(vm.ControlsModel.Vehicles);
        Assert.Equal(7, vm.ControlsModel.Vehicles[0].Id);
        Assert.True(vm.ShowNoVehicle); // still no vehicle picked
    }

    [Fact]
    public async Task LoadAsync_VehiclesEmpty_ResolvesWithNoVehicles()
    {
        using var vm = NewViewModel(new FakeFeed(Array.Empty<VehicleOption>(), _ => Data(0, [], [])));

        await vm.LoadAsync();

        Assert.Equal(XRayVehiclesStatus.Resolved, vm.ControlsModel.VehiclesStatus);
        Assert.Empty(vm.ControlsModel.Vehicles);
    }

    [Fact]
    public async Task LoadAsync_VehiclesFailure_ReachesErrorStatus()
    {
        using var vm = NewViewModel(new ThrowingVehiclesFeed());

        await vm.LoadAsync();

        Assert.Equal(XRayVehiclesStatus.Error, vm.ControlsModel.VehiclesStatus);
        Assert.Empty(vm.ControlsModel.Vehicles);
    }

    // ── useIngestXRay data states (loading → success → empty → error) ────────────────────────────────────────────

    [Fact]
    public async Task SelectVehicle_XRayLoading_ShowsLoadingState_WithEmDashTiles()
    {
        var gate = new GatedXRayFeed(new[] { Vehicle(7, "Roadster") });
        using var vm = NewViewModel(gate);
        await vm.LoadAsync();

        Task selecting = vm.SelectVehicleAsync(7);

        Assert.Equal(IngestXRayPageState.Loading, vm.State);
        Assert.True(vm.HasVehicle);
        Assert.True(vm.BucketChartModel.Loading);
        Assert.True(vm.FieldsTableModel.Loading);
        Assert.Equal(XRayHeaderProjection.EmDash, vm.HeaderDisplay.SamplesValue);

        gate.Release(Data(1234, [Field("VehicleSpeed", 800)], [Bucket("2026-06-06T12:00:00Z", 10)]));
        await selecting;

        Assert.Equal(IngestXRayPageState.Ready, vm.State);
    }

    [Fact]
    public async Task SelectVehicle_XRaySuccess_ReachesReadyState_AndProjectsChildModels()
    {
        var data = Data(
            1234,
            [Field("VehicleSpeed", 800), Field("Soc", 434)],
            [Bucket("2026-06-06T12:00:00Z", 10), Bucket("2026-06-06T12:01:00Z", 5)]);
        using var vm = NewViewModel(new FakeFeed(new[] { Vehicle(7, "Roadster") }, _ => data));
        await vm.LoadAsync();

        await vm.SelectVehicleAsync(7);

        Assert.Equal(IngestXRayPageState.Ready, vm.State);
        Assert.False(vm.ShowNoVehicle);
        Assert.False(vm.ShowXRayError);
        Assert.NotNull(vm.UpdatedAt);
        Assert.Equal(2, vm.BucketChartModel.Buckets.Count);
        Assert.False(vm.BucketChartModel.Loading);
        Assert.Equal(2, vm.FieldsTableModel.Rows.Count);
        Assert.Equal(XRayHeaderProjection.FormatInt(1234), vm.HeaderDisplay.SamplesValue);
        Assert.Equal(XRayHeaderProjection.FormatInt(2), vm.HeaderDisplay.FieldsValue);
    }

    [Fact]
    public async Task SelectVehicle_XRayZeroSamples_ReachesEmptyState()
    {
        using var vm = NewViewModel(new FakeFeed(new[] { Vehicle(7, "Roadster") }, _ => Data(0, [], [])));
        await vm.LoadAsync();

        await vm.SelectVehicleAsync(7);

        Assert.Equal(IngestXRayPageState.Empty, vm.State);
        Assert.True(vm.HasVehicle);
        Assert.False(vm.ShowXRayError);
        Assert.Empty(vm.BucketChartModel.Buckets);
        Assert.Empty(vm.FieldsTableModel.Rows);
        // web parity: not loading → fmtInt(0), not the em-dash.
        Assert.Equal(XRayHeaderProjection.FormatInt(0), vm.HeaderDisplay.SamplesValue);
    }

    [Fact]
    public async Task SelectVehicle_XRayFailure_ReachesErrorState()
    {
        using var vm = NewViewModel(new ThrowingXRayFeed(new[] { Vehicle(7, "Roadster") }));
        await vm.LoadAsync();

        await vm.SelectVehicleAsync(7);

        Assert.Equal(IngestXRayPageState.Error, vm.State);
        Assert.True(vm.ShowXRayError);
        Assert.True(vm.IsError);
        Assert.Equal(XRayHeaderProjection.EmDash, vm.HeaderDisplay.SamplesValue);
    }

    [Fact]
    public async Task SelectVehicle_Null_ShowsNoVehiclePanel_AndDropsData()
    {
        var data = Data(1234, [Field("VehicleSpeed", 800)], [Bucket("2026-06-06T12:00:00Z", 10)]);
        using var vm = NewViewModel(new FakeFeed(new[] { Vehicle(7, "Roadster") }, _ => data));
        await vm.LoadAsync();
        await vm.SelectVehicleAsync(7);
        Assert.Equal(IngestXRayPageState.Ready, vm.State);

        await vm.SelectVehicleAsync(null);

        Assert.True(vm.ShowNoVehicle);
        Assert.False(vm.HasVehicle);
        Assert.Empty(vm.BucketChartModel.Buckets);
        Assert.Empty(vm.FieldsTableModel.Rows);
    }

    // ── Selection → reload (web setWindowSel / setBucketSel re-key the query) ─────────────────────────────────────

    [Fact]
    public async Task SelectWindow_ReloadsXRay_WithTheNewWindow()
    {
        var feed = new FakeFeed(new[] { Vehicle(7, "Roadster") }, _ => Data(1, [Field("Soc", 1)], []));
        using var vm = NewViewModel(feed);
        await vm.LoadAsync();
        await vm.SelectVehicleAsync(7);

        await vm.SelectWindowAsync(IngestXRayWindow.H24);

        Assert.Equal(IngestXRayWindow.H24, vm.Window);
        Assert.Equal(IngestXRayWindow.H24, feed.LastWindow);
        Assert.Equal(7, feed.LastVehicleId);
    }

    [Fact]
    public async Task SelectBucket_ReloadsXRay_WithTheNewBucket()
    {
        var feed = new FakeFeed(new[] { Vehicle(7, "Roadster") }, _ => Data(1, [Field("Soc", 1)], []));
        using var vm = NewViewModel(feed);
        await vm.LoadAsync();
        await vm.SelectVehicleAsync(7);

        await vm.SelectBucketAsync(IngestXRayBucket.S30);

        Assert.Equal(IngestXRayBucket.S30, vm.Bucket);
        Assert.Equal(IngestXRayBucket.S30, feed.LastBucket);
    }

    [Fact]
    public async Task SelectWindow_WithNoVehicle_DoesNotQueryTheXRay()
    {
        var feed = new FakeFeed(new[] { Vehicle(7, "Roadster") }, _ => Data(1, [Field("Soc", 1)], []));
        using var vm = NewViewModel(feed);
        await vm.LoadAsync();

        await vm.SelectWindowAsync(IngestXRayWindow.M5);

        Assert.Equal(IngestXRayWindow.M5, vm.Window);
        Assert.Equal(0, feed.XRayCalls); // web parity: useIngestXRay disabled while vehicleId is null
        Assert.True(vm.ShowNoVehicle);
    }

    [Fact]
    public async Task RetryXRay_AfterFailure_RecoversToReady()
    {
        var feed = new FlakyXRayFeed(new[] { Vehicle(7, "Roadster") }, Data(99, [Field("Soc", 99)], []));
        using var vm = NewViewModel(feed);
        await vm.LoadAsync();
        await vm.SelectVehicleAsync(7);
        Assert.Equal(IngestXRayPageState.Error, vm.State);

        await vm.RetryXRayAsync();

        Assert.Equal(IngestXRayPageState.Ready, vm.State);
        Assert.False(vm.ShowXRayError);
        Assert.Single(vm.FieldsTableModel.Rows);
    }

    // ── Diagnostics + i18n ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_RecordsTheViewOpenedEvent()
    {
        var lines = new List<string>();
        var diagnostics = new IngestXRayPageDiagnostics(lines.Add);
        using var vm = new IngestXRayPageViewModel(EmptyIngestXRayPageFeed.Instance, Localizer, diagnostics);

        vm.NotifyOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains($"view.opened slug={IngestXRayPageRegistration.Slug}", lines);
    }

    [Fact]
    public void Registration_ResolvesEveryRequiredCatalogKey()
    {
        var recorder = new RecordingLocalizer();

        _ = IngestXRayPageRegistration.Title(recorder);
        _ = IngestXRayPageRegistration.Subtitle(recorder);
        _ = IngestXRayPageRegistration.PanelFields(recorder);
        _ = IngestXRayPageRegistration.NoVehicleTitle(recorder);
        _ = IngestXRayPageRegistration.NoVehicleMessage(recorder);

        string[] required =
        [
            "translation.admin.xray.pageTitle",
            "translation.admin.xray.subtitle",
            "translation.admin.xray.panels.fields",
            "translation.admin.xray.noVehicle.title",
            "translation.admin.xray.noVehicle.message",
        ];

        foreach (string key in required)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static VehicleOption Vehicle(long id, string name) => new(id, name);

    private static IngestXRayFieldStat Field(string name, long count) =>
        new(name, count, "2026-06-06T12:00:00Z", 6);

    private static XRayBucketPoint Bucket(string start, long count) => new(start, count);

    private static IngestXRayPageData Data(
        long samples,
        IReadOnlyList<IngestXRayFieldStat> fields,
        IReadOnlyList<XRayBucketPoint> buckets) =>
        new(new IngestXRaySummary(samples, fields.Count, "1h", "1m", null), buckets, fields);

    private static IngestXRayPageViewModel NewViewModel(IIngestXRayPageFeed? feed = null) =>
        new(
            feed ?? new FakeFeed(Array.Empty<VehicleOption>(), _ => IngestXRayPageData.Empty),
            Localizer,
            clock: () => DateTimeOffset.UnixEpoch);

    private sealed class FakeFeed(
        IReadOnlyList<VehicleOption> vehicles,
        Func<int, IngestXRayPageData> xray) : IIngestXRayPageFeed
    {
        public IngestXRayWindow LastWindow { get; private set; }

        public IngestXRayBucket LastBucket { get; private set; }

        public int LastVehicleId { get; private set; }

        public int XRayCalls { get; private set; }

        public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(vehicles);

        public Task<IngestXRayPageData> FetchXRayAsync(
            int vehicleId,
            IngestXRayWindow window,
            IngestXRayBucket bucket,
            int limit,
            CancellationToken cancellationToken)
        {
            XRayCalls++;
            LastVehicleId = vehicleId;
            LastWindow = window;
            LastBucket = bucket;
            return Task.FromResult(xray(vehicleId));
        }
    }

    private sealed class ThrowingVehiclesFeed : IIngestXRayPageFeed
    {
        public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("fleet load failed");

        public Task<IngestXRayPageData> FetchXRayAsync(
            int vehicleId,
            IngestXRayWindow window,
            IngestXRayBucket bucket,
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult(IngestXRayPageData.Empty);
    }

    private sealed class ThrowingXRayFeed(IReadOnlyList<VehicleOption> vehicles) : IIngestXRayPageFeed
    {
        public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(vehicles);

        public Task<IngestXRayPageData> FetchXRayAsync(
            int vehicleId,
            IngestXRayWindow window,
            IngestXRayBucket bucket,
            int limit,
            CancellationToken cancellationToken) =>
            throw new InvalidOperationException("xray load failed");
    }

    // First X-Ray fetch throws; every subsequent fetch resolves — exercises the retry-recovers path.
    private sealed class FlakyXRayFeed(IReadOnlyList<VehicleOption> vehicles, IngestXRayPageData data)
        : IIngestXRayPageFeed
    {
        private int _calls;

        public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(vehicles);

        public Task<IngestXRayPageData> FetchXRayAsync(
            int vehicleId,
            IngestXRayWindow window,
            IngestXRayBucket bucket,
            int limit,
            CancellationToken cancellationToken)
        {
            _calls++;
            return _calls == 1
                ? throw new InvalidOperationException("xray load failed")
                : Task.FromResult(data);
        }
    }

    // Gates the X-Ray fetch on a manual signal so the in-flight loading state is observable.
    private sealed class GatedXRayFeed(IReadOnlyList<VehicleOption> vehicles) : IIngestXRayPageFeed
    {
        private readonly TaskCompletionSource<IngestXRayPageData> _gate =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<IReadOnlyList<VehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(vehicles);

        public Task<IngestXRayPageData> FetchXRayAsync(
            int vehicleId,
            IngestXRayWindow window,
            IngestXRayBucket bucket,
            int limit,
            CancellationToken cancellationToken) => _gate.Task;

        public void Release(IngestXRayPageData data) => _gate.SetResult(data);
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
}
