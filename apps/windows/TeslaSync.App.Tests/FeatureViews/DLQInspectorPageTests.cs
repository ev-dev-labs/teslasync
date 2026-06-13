using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.FeatureViews.DlqInspector;
using TeslaSync.App.ModalsDialogs;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DLQInspectorPage</c> surface's Microsoft.UI-free logic — the four data ports
/// (web <c>useDLQList</c> / <c>useDLQEntry</c> / <c>useDLQAudit</c> / <c>useDLQReplay</c>), the generated-client feeds'
/// request shaping + tolerant parsing, the view-model's list/error/success matrix, the inspect → drawer → entry-load
/// flow, and the replay confirm flow with its three terminal branches (ok closes the drawer, <c>disabled</c> and the
/// HTTP-403 gate raise the replay-blocked banner). The WinUI view is exercised by the app build; its per-region
/// visibility is driven entirely by the view-model state asserted here.
/// </summary>
public sealed class DLQInspectorPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Generated-client binding (web hook → operation id) ───────────────────────────────────────────────────────

    [Fact]
    public void Operations_ResolveAgainstTheGeneratedEndpointTable()
    {
        string[] operations =
        [
            DlqInspectorRegistration.ListOperation,
            DlqInspectorRegistration.EntryOperation,
            DlqInspectorRegistration.AuditOperation,
            DlqInspectorRegistration.EntryAuditOperation,
            DlqInspectorRegistration.ReplayOperation,
        ];

        foreach (string op in operations)
        {
            Assert.Contains(GeneratedApi.ApiEndpoints.All, e => e.OperationId == op);
        }
    }

    [Fact]
    public async Task ListClientFeed_ShapesTheRequest_AndParsesTheSnapshot()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            """{ "count": 2, "replay_enabled": true, "entries": [ { "id": 7, "replayable": true }, { "id": 8, "replayable": false } ] }"""));
        var feed = new DlqListClientFeed(api);

        DlqListSnapshot snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.Equal(DlqInspectorRegistration.ListOperation, api.Requests[0].OperationId);
        Assert.Equal(2, snapshot.Count);
        Assert.True(snapshot.ReplayEnabled);
        Assert.Equal(2, snapshot.Entries.Count);
        Assert.Equal(7, snapshot.Entries[0].Id);
        Assert.True(snapshot.Entries[0].Replayable);
    }

    [Fact]
    public async Task AuditClientFeed_ShapesTheGlobalRequest_WithLimit_AndParsesRows()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            """{ "rows": [ { "id": 1, "replayed_at": "2026-06-06T12:00:00Z", "actor": "ops", "dlq_id": 7, "result": "ok", "dst_topic": "telemetry/x" } ] }"""));
        var feed = new DlqAuditClientFeed(api);

        IReadOnlyList<AuditRecord> rows = await feed.FetchAsync(null, 50, CancellationToken.None);

        ApiRequest request = api.Requests[0];
        Assert.Equal(DlqInspectorRegistration.AuditOperation, request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal(50, request.Query!["limit"]);
        Assert.Single(rows);
        Assert.Equal("ops", rows[0].Actor);
        Assert.Equal("ok", rows[0].Result);
        Assert.Equal(7, rows[0].DlqId);
    }

    [Fact]
    public async Task AuditClientFeed_ScopesToAnEntry_ViaThePathId()
    {
        var api = new FakeApiClient().ReturnsValue(Json("""{ "rows": [] }"""));
        var feed = new DlqAuditClientFeed(api);

        await feed.FetchAsync(7, 50, CancellationToken.None);

        ApiRequest request = api.Requests[0];
        Assert.Equal(DlqInspectorRegistration.EntryAuditOperation, request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("7", request.PathParams!["id"]);
    }

    [Fact]
    public async Task EntryClientFeed_ShapesTheRequest_WithThePathId()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            """{ "id": 7, "replayable": true, "raw_payload_b64": "cmF3", "inner_payload_b64": "aW5uZXI=" }"""));
        var feed = new DlqEntryClientFeed(api);

        DlqEntryFull full = await feed.FetchAsync(7, CancellationToken.None);

        Assert.Equal(DlqInspectorRegistration.EntryOperation, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["id"]);
        Assert.Equal(7, full.Summary.Id);
        Assert.Equal("cmF3", full.RawPayloadB64);
        Assert.Equal("aW5uZXI=", full.InnerPayloadB64);
    }

    [Fact]
    public async Task ReplayClientService_ShapesThePostRequest_AndParsesTheOutcome()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            """{ "ok": true, "replayed_id": 7, "dst_topic": "telemetry/x", "result": "ok" }"""));
        var service = new DlqReplayClientService(api);

        DlqReplayOutcome outcome = await service.ReplayAsync(7, CancellationToken.None);

        Assert.Equal(DlqInspectorRegistration.ReplayOperation, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["id"]);
        Assert.True(outcome.Ok);
        Assert.Equal(7, outcome.ReplayedId);
        Assert.Equal(DlqReplayResultCode.Ok, outcome.Result);
        Assert.Equal("telemetry/x", outcome.DstTopic);
    }

    [Theory]
    [InlineData("ok", DlqReplayResultCode.Ok)]
    [InlineData("publish_failed", DlqReplayResultCode.PublishFailed)]
    [InlineData("rate_limited", DlqReplayResultCode.RateLimited)]
    [InlineData("disabled", DlqReplayResultCode.Disabled)]
    [InlineData("not_found", DlqReplayResultCode.NotFound)]
    [InlineData("unparseable", DlqReplayResultCode.Unparseable)]
    [InlineData("something_else", DlqReplayResultCode.Unknown)]
    public void ResultCodes_MapEveryWireCode(string wire, DlqReplayResultCode expected) =>
        Assert.Equal(expected, DlqReplayResultCodes.Parse(wire));

    // ── View-model data-state matrix (the three required parity states) ──────────────────────────────────────────

    [Fact]
    public void InitialState_IsLoading_WithLoadingChildModels()
    {
        using var vm = NewViewModel();

        Assert.Equal(DlqInspectorState.Loading, vm.State);
        Assert.True(vm.StatusModel.Loading);
        Assert.True(vm.EntriesModel.Loading);
        Assert.True(vm.AuditModel.Loading);
    }

    [Fact]
    public async Task LoadAsync_Success_ReachesReadyState_AndProjectsChildModels()
    {
        var snapshot = new DlqListSnapshot(1, true, new[] { Row(7) });
        using var vm = NewViewModel(
            list: new FakeListFeed(snapshot),
            audit: new FakeAuditFeed(new[] { Audit(1, 7) }));

        await vm.LoadAsync();

        Assert.Equal(DlqInspectorState.Ready, vm.State);
        Assert.False(vm.ShowListError);
        Assert.NotNull(vm.ListUpdatedAt);
        Assert.Same(snapshot, vm.StatusModel.Data);
        Assert.Single(vm.EntriesModel.Rows);
        Assert.Single(vm.AuditModel.Rows);
        Assert.False(vm.AuditModel.Loading);
    }

    [Fact]
    public async Task LoadAsync_ListFailure_ReachesErrorState()
    {
        using var vm = NewViewModel(list: new ThrowingListFeed());

        await vm.LoadAsync();

        Assert.Equal(DlqInspectorState.Error, vm.State);
        Assert.True(vm.ShowListError);
        Assert.True(vm.IsListError);
    }

    [Fact]
    public async Task Inspect_OpensTheDrawer_AndLoadsTheFullEntry()
    {
        var full = new DlqEntryFull(Row(7), "cmF3", "aW5uZXI=");
        using var vm = NewViewModel(
            list: new FakeListFeed(new DlqListSnapshot(1, true, new[] { Row(7) })),
            entry: new FakeEntryFeed(full));
        await vm.LoadAsync();

        vm.Inspect(Row(7));

        Assert.True(vm.Drawer.IsOpen);
        Assert.NotNull(vm.Drawer.Full);
        Assert.Equal(7, vm.Drawer.Full!.Summary.Id);
        Assert.True(vm.Drawer.ReplayEnabled);
        Assert.False(vm.Drawer.ReplayDisabled);
    }

    // ── Replay confirm flow (the three web terminal branches) ────────────────────────────────────────────────────

    [Fact]
    public async Task Replay_RequestRaisesConfirm_AndOkOutcomeClosesDrawer_NoBanner()
    {
        var full = new DlqEntryFull(Row(7), "cmF3", "aW5uZXI=");
        var replay = new FakeReplayService(new DlqReplayOutcome(true, 7, "telemetry/x", DlqReplayResultCode.Ok));
        using var vm = NewViewModel(
            list: new FakeListFeed(new DlqListSnapshot(1, true, new[] { Row(7) })),
            entry: new FakeEntryFeed(full),
            replay: replay);
        await vm.LoadAsync();
        vm.Inspect(Row(7));

        bool confirmRequested = false;
        vm.ReplayConfirmRequested += (_, _) => confirmRequested = true;
        vm.Drawer.RequestReplay();

        Assert.True(confirmRequested);
        Assert.True(vm.HasPendingReplay);
        Assert.Equal(7, vm.PendingReplay!.Id);

        await vm.ConfirmReplayAsync();

        Assert.Equal(7, replay.LastId);
        Assert.False(vm.Drawer.IsOpen);
        Assert.False(vm.ReplayDisabledBannerVisible);
        Assert.False(vm.HasPendingReplay);
    }

    [Fact]
    public async Task Replay_DisabledOutcome_RaisesTheBanner_AndKeepsTheDrawerOpen()
    {
        var full = new DlqEntryFull(Row(7), "cmF3", "aW5uZXI=");
        var replay = new FakeReplayService(new DlqReplayOutcome(false, 7, string.Empty, DlqReplayResultCode.Disabled));
        using var vm = NewViewModel(
            list: new FakeListFeed(new DlqListSnapshot(1, true, new[] { Row(7) })),
            entry: new FakeEntryFeed(full),
            replay: replay);
        await vm.LoadAsync();
        vm.Inspect(Row(7));
        vm.Drawer.RequestReplay();

        await vm.ConfirmReplayAsync();

        Assert.True(vm.ReplayDisabledBannerVisible);
        Assert.True(vm.Drawer.IsOpen);
        Assert.False(vm.HasPendingReplay);
    }

    [Fact]
    public async Task Replay_Http403_RaisesTheBanner()
    {
        var full = new DlqEntryFull(Row(7), "cmF3", "aW5uZXI=");
        var replay = new ThrowingReplayService(new ApiException("replay disabled", 403));
        using var vm = NewViewModel(
            list: new FakeListFeed(new DlqListSnapshot(1, true, new[] { Row(7) })),
            entry: new FakeEntryFeed(full),
            replay: replay);
        await vm.LoadAsync();
        vm.Inspect(Row(7));
        vm.Drawer.RequestReplay();

        await vm.ConfirmReplayAsync();

        Assert.True(vm.ReplayDisabledBannerVisible);
        Assert.False(vm.HasPendingReplay);
    }

    [Fact]
    public async Task DismissReplayBanner_HidesIt()
    {
        var full = new DlqEntryFull(Row(7), "cmF3", "aW5uZXI=");
        using var vm = NewViewModel(
            list: new FakeListFeed(new DlqListSnapshot(1, true, new[] { Row(7) })),
            entry: new FakeEntryFeed(full),
            replay: new ThrowingReplayService(new ApiException("replay disabled", 403)));
        await vm.LoadAsync();
        vm.Inspect(Row(7));
        vm.Drawer.RequestReplay();
        await vm.ConfirmReplayAsync();
        Assert.True(vm.ReplayDisabledBannerVisible);

        vm.DismissReplayBanner();

        Assert.False(vm.ReplayDisabledBannerVisible);
    }

    // ── i18n: every visible literal resolves through the catalog ─────────────────────────────────────────────────

    [Fact]
    public void Registration_ResolvesEveryRequiredCatalogKey()
    {
        var recorder = new RecordingLocalizer();

        _ = DlqInspectorRegistration.Title(recorder);
        _ = DlqInspectorRegistration.Subtitle(recorder);
        _ = DlqInspectorRegistration.PanelEntries(recorder);
        _ = DlqInspectorRegistration.PanelAudit(recorder);
        _ = DlqInspectorRegistration.BannerBlockedTitle(recorder);
        _ = DlqInspectorRegistration.BannerBlockedMessage(recorder);
        _ = DlqInspectorRegistration.ConfirmTitle(recorder);
        _ = DlqInspectorRegistration.ConfirmMessage(recorder, 7);
        _ = DlqInspectorRegistration.ConfirmLabel(recorder);
        _ = DlqInspectorRegistration.CancelLabel(recorder);

        string[] required =
        [
            "translation.admin.dlq.pageTitle",
            "translation.admin.dlq.subtitle",
            "translation.admin.dlq.panels.entries",
            "translation.admin.dlq.panels.audit",
            "translation.admin.dlq.banners.replayBlockedTitle",
            "translation.admin.dlq.banners.replayBlockedMessage",
            "translation.admin.dlq.confirm.title",
            "translation.admin.dlq.confirm.message",
            "translation.admin.dlq.confirm.confirm",
            "translation.common.cancel",
        ];

        foreach (string key in required)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void ConfirmMessage_InterpolatesTheEntryId()
    {
        string message = DlqInspectorRegistration.ConfirmMessage(Localizer, 42);
        Assert.Contains("#42", message, StringComparison.Ordinal);
        Assert.DoesNotContain("{0}", message, StringComparison.Ordinal);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static DlqEntrySummary Row(long id) => new(
        Id: id,
        ArrivedAt: "2026-06-06T12:00:00Z",
        ParsedReason: "decode_error",
        Replayable: true,
        RawPayloadSize: 128,
        ParsedSourceTopic: "telemetry/x",
        DlqTopic: "dlq/telemetry");

    private static AuditRecord Audit(long id, long dlqId) =>
        new(id, "2026-06-06T12:00:00Z", "ops", dlqId, "ok", "telemetry/x", string.Empty, "trace-1");

    private static DlqInspectorPageViewModel NewViewModel(
        IDlqListFeed? list = null,
        IDlqEntryFeed? entry = null,
        IDlqAuditFeed? audit = null,
        IDlqReplayService? replay = null) =>
        new(
            list ?? new FakeListFeed(new DlqListSnapshot(0, false, Array.Empty<DlqEntrySummary>())),
            entry ?? new FakeEntryFeed(new DlqEntryFull(Row(1), string.Empty, string.Empty)),
            audit ?? new FakeAuditFeed(Array.Empty<AuditRecord>()),
            replay ?? new FakeReplayService(new DlqReplayOutcome(true, 1, string.Empty, DlqReplayResultCode.Ok)),
            Localizer);

    private sealed class FakeListFeed(DlqListSnapshot snapshot) : IDlqListFeed
    {
        public Task<DlqListSnapshot> FetchAsync(CancellationToken cancellationToken) => Task.FromResult(snapshot);
    }

    private sealed class ThrowingListFeed : IDlqListFeed
    {
        public Task<DlqListSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("list load failed");
    }

    private sealed class FakeEntryFeed(DlqEntryFull full) : IDlqEntryFeed
    {
        public Task<DlqEntryFull> FetchAsync(long id, CancellationToken cancellationToken) => Task.FromResult(full);
    }

    private sealed class FakeAuditFeed(IReadOnlyList<AuditRecord> rows) : IDlqAuditFeed
    {
        public Task<IReadOnlyList<AuditRecord>> FetchAsync(long? dlqId, int limit, CancellationToken cancellationToken) =>
            Task.FromResult(rows);
    }

    private sealed class FakeReplayService(DlqReplayOutcome outcome) : IDlqReplayService
    {
        public long? LastId { get; private set; }

        public Task<DlqReplayOutcome> ReplayAsync(long id, CancellationToken cancellationToken)
        {
            LastId = id;
            return Task.FromResult(outcome);
        }
    }

    private sealed class ThrowingReplayService(Exception exception) : IDlqReplayService
    {
        public Task<DlqReplayOutcome> ReplayAsync(long id, CancellationToken cancellationToken) => throw exception;
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
