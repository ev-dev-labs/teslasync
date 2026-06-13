using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.FeatureViews.FeatureFlags;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>FeatureFlagsPage</c> surface's Microsoft.UI-free logic — the four data ports
/// (web <c>useFlags</c> / <c>useFlagChanges</c> / <c>useSetFlag</c> / <c>useDeleteFlag</c>), the generated-client
/// feeds' request shaping + tolerant parsing, the view-model's loading / empty / success / error matrix and the
/// freshness signals, the save / delete flows (success re-runs both reads; failure keeps the editor open), and the
/// i18n catalog binding. The WinUI view is exercised by the app build; its per-region visibility is driven entirely
/// by the view-model state asserted here.
/// </summary>
public sealed class FeatureFlagsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Generated-client binding (web hook → operation id) ───────────────────────────────────────────────────────

    [Fact]
    public void Operations_ResolveAgainstTheGeneratedEndpointTable()
    {
        string[] operations =
        [
            FeatureFlagsRegistration.ListOperation,
            FeatureFlagsRegistration.ChangesOperation,
            FeatureFlagsRegistration.SetOperation,
            FeatureFlagsRegistration.DeleteOperation,
        ];

        foreach (string op in operations)
        {
            Assert.Contains(GeneratedApi.ApiEndpoints.All, e => e.OperationId == op);
        }
    }

    [Fact]
    public async Task FlagsClientFeed_ShapesTheRequest_AndParsesTheSnapshot()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            """{ "count": 2, "flags": [ { "key": "feature.a", "value": true }, { "key": "feature.b", "value": { "x": 1 } } ] }"""));
        var feed = new FeatureFlagsClientFeed(api);

        FeatureFlagsSnapshot snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.Equal(FeatureFlagsRegistration.ListOperation, api.Requests[0].OperationId);
        Assert.Equal(2, snapshot.Flags.Count);
        Assert.Equal("feature.a", snapshot.Flags[0].Key);
        Assert.Equal(JsonValueKind.True, snapshot.Flags[0].Value.ValueKind);
        Assert.Equal("feature.b", snapshot.Flags[1].Key);
        Assert.Equal(JsonValueKind.Object, snapshot.Flags[1].Value.ValueKind);
    }

    [Fact]
    public async Task ChangesClientFeed_ShapesTheRequest_WithLimit_AndParsesRows()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            """{ "count": 1, "flag_key": "", "limit": 50, "rows": [ { "id": 9, "changed_at": "2026-06-06T12:00:00Z", "actor": "ops", "flag_key": "feature.a", "operation": "set", "old_value": null, "new_value": true, "reason": "enable" } ] }"""));
        var feed = new FlagChangesClientFeed(api);

        FlagChangesSnapshot snapshot = await feed.FetchAsync(FeatureFlagsRegistration.ChangesLimit, CancellationToken.None);

        ApiRequest request = api.Requests[0];
        Assert.Equal(FeatureFlagsRegistration.ChangesOperation, request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal(50, request.Query!["limit"]);
        FeatureFlagChangeRow row = Assert.Single(snapshot.Rows);
        Assert.Equal("9", row.Id);
        Assert.Equal("feature.a", row.FlagKey);
        Assert.Equal("set", row.Operation);
        Assert.Equal("ops", row.Actor);
        Assert.Equal("enable", row.Reason);
        Assert.Null(row.OldValueJson);          // web compact(null) → em dash
        Assert.Equal("true", row.NewValueJson); // web JSON.stringify(true)
    }

    [Fact]
    public async Task ChangesClientFeed_ToleratesCamelCaseAliases()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            """{ "rows": [ { "id": 3, "changedAt": "2026-06-06T12:00:00Z", "flagKey": "feature.z", "operation": "delete", "oldValue": "on", "newValue": null, "reason": "cleanup" } ] }"""));
        var feed = new FlagChangesClientFeed(api);

        FlagChangesSnapshot snapshot = await feed.FetchAsync(50, CancellationToken.None);

        FeatureFlagChangeRow row = Assert.Single(snapshot.Rows);
        Assert.Equal("feature.z", row.FlagKey);
        Assert.Equal("delete", row.Operation);
        Assert.Equal("\"on\"", row.OldValueJson); // web JSON.stringify("on")
        Assert.Null(row.NewValueJson);
    }

    [Fact]
    public async Task WriteService_Set_ShapesThePutRequest_WithJsonBody()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{}"));
        var service = new FlagWriteClientService(api);

        await service.SetAsync("feature.a", Json("true"), "enable it", CancellationToken.None);

        ApiRequest request = api.Requests[0];
        Assert.Equal(FeatureFlagsRegistration.SetOperation, request.OperationId);
        Assert.Equal("feature.a", request.PathParams!["key"]);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(request.Body);
        Assert.True(body.ContainsKey("value"));
        Assert.Equal("enable it", body["reason"]);
        Assert.Equal(JsonValueKind.True, Assert.IsType<JsonElement>(body["value"]).ValueKind);
    }

    [Fact]
    public async Task WriteService_Delete_ShapesTheDeleteRequest_WithReasonQuery()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{}"));
        var service = new FlagWriteClientService(api);

        await service.DeleteAsync("feature.a", "remove it", CancellationToken.None);

        ApiRequest request = api.Requests[0];
        Assert.Equal(FeatureFlagsRegistration.DeleteOperation, request.OperationId);
        Assert.Equal("feature.a", request.PathParams!["key"]);
        Assert.NotNull(request.Query);
        Assert.Equal("remove it", request.Query!["reason"]);
    }

    // ── View-model data-state matrix (the three required parity states + error) ──────────────────────────────────

    [Fact]
    public void InitialState_IsLoading_WithLoadingChildModels()
    {
        using var vm = NewViewModel();

        Assert.Equal(FeatureFlagsState.Loading, vm.State);
        Assert.True(vm.FlagsModel.Loading);
        Assert.True(vm.ChangesModel.Loading);
    }

    [Fact]
    public async Task LoadAsync_Success_ReachesReadyState_AndPopulatesBothModels()
    {
        using var vm = NewViewModel(
            flags: new FakeFlagsFeed(Flags(("feature.a", "true"), ("feature.b", "1"))),
            changes: new FakeChangesFeed(Changes(Change("5", "set"))));

        await vm.LoadAsync();

        Assert.Equal(FeatureFlagsState.Ready, vm.State);
        Assert.False(vm.IsFlagsError);
        Assert.NotNull(vm.FlagsUpdatedAt);
        Assert.False(vm.IsFetching);
        Assert.Equal(2, vm.FlagsModel.Rows.Count);
        Assert.False(vm.FlagsModel.Loading);
        Assert.Single(vm.ChangesModel.Rows);
        Assert.False(vm.ChangesModel.Loading);
    }

    [Fact]
    public async Task LoadAsync_Empty_ReachesReadyState_WithEmptyModels()
    {
        using var vm = NewViewModel(); // the default Empty* feeds resolve to the empty data state

        await vm.LoadAsync();

        Assert.Equal(FeatureFlagsState.Ready, vm.State);
        Assert.Empty(vm.FlagsModel.Rows);
        Assert.False(vm.FlagsModel.Loading);
        Assert.Empty(vm.ChangesModel.Rows);
        Assert.False(vm.ChangesModel.Loading);
    }

    [Fact]
    public async Task LoadAsync_FlagsFailure_ReachesErrorState_ButKeepsTheTableVisibleEmpty()
    {
        using var vm = NewViewModel(flags: new ThrowingFlagsFeed());

        await vm.LoadAsync();

        Assert.Equal(FeatureFlagsState.Error, vm.State);
        Assert.True(vm.IsFlagsError);
        Assert.Empty(vm.FlagsModel.Rows);
        Assert.False(vm.FlagsModel.Loading);
    }

    [Fact]
    public async Task LoadAsync_ChangesFailure_KeepsFlagsReady()
    {
        using var vm = NewViewModel(
            flags: new FakeFlagsFeed(Flags(("feature.a", "true"))),
            changes: new ThrowingChangesFeed());

        await vm.LoadAsync();

        Assert.Equal(FeatureFlagsState.Ready, vm.State);
        Assert.Single(vm.FlagsModel.Rows);
        Assert.Empty(vm.ChangesModel.Rows);
        Assert.False(vm.ChangesModel.Loading);
    }

    // ── Save / delete flows (web handleSave / handleConfirmDelete) ───────────────────────────────────────────────

    [Fact]
    public async Task SaveFlagAsync_Success_WritesAndReloads_ReturnsTrue()
    {
        var write = new RecordingWriteService();
        using var vm = NewViewModel(
            flags: new FakeFlagsFeed(Flags(("feature.a", "true"))),
            write: write);

        bool ok = await vm.SaveFlagAsync("feature.a", Json("true"), "enable");

        Assert.True(ok);
        (string Key, string Reason) call = Assert.Single(write.SetCalls);
        Assert.Equal("feature.a", call.Key);
        Assert.Equal("enable", call.Reason);
        Assert.Equal(FeatureFlagsState.Ready, vm.State); // reloaded after the write
    }

    [Fact]
    public async Task SaveFlagAsync_Failure_ReturnsFalse_WithoutReload()
    {
        var write = new RecordingWriteService(shouldThrow: true);
        using var vm = NewViewModel(write: write);

        bool ok = await vm.SaveFlagAsync("feature.a", Json("true"), "enable");

        Assert.False(ok);
        Assert.Single(write.SetCalls);
    }

    [Fact]
    public async Task DeleteFlagAsync_Success_WritesAndReloads_ReturnsTrue()
    {
        var write = new RecordingWriteService();
        using var vm = NewViewModel(write: write);

        bool ok = await vm.DeleteFlagAsync("feature.a", "remove");

        Assert.True(ok);
        (string Key, string Reason) call = Assert.Single(write.DeleteCalls);
        Assert.Equal("feature.a", call.Key);
        Assert.Equal("remove", call.Reason);
    }

    [Fact]
    public async Task DeleteFlagAsync_Failure_ReturnsFalse()
    {
        var write = new RecordingWriteService(shouldThrow: true);
        using var vm = NewViewModel(write: write);

        bool ok = await vm.DeleteFlagAsync("feature.a", "remove");

        Assert.False(ok);
        Assert.Single(write.DeleteCalls);
    }

    // ── i18n: every visible literal resolves through the catalog (the 11 required keys) ──────────────────────────

    [Fact]
    public void Registration_ResolvesEveryRequiredCatalogKey()
    {
        var recorder = new RecordingLocalizer();

        _ = FeatureFlagsRegistration.Title(recorder);
        _ = FeatureFlagsRegistration.Subtitle(recorder);
        _ = FeatureFlagsRegistration.AddLabel(recorder);
        _ = FeatureFlagsRegistration.PanelRegistry(recorder);
        _ = FeatureFlagsRegistration.PanelChanges(recorder);
        _ = FeatureFlagsRegistration.DeleteTitle(recorder);
        _ = FeatureFlagsRegistration.DeleteMessage(recorder, "feature.a");
        _ = FeatureFlagsRegistration.DeleteReasonLabel(recorder);
        _ = FeatureFlagsRegistration.DeleteReasonPrompt(recorder);
        _ = FeatureFlagsRegistration.DeleteConfirmLabel(recorder);
        _ = FeatureFlagsRegistration.CancelLabel(recorder);

        string[] required =
        [
            "translation.admin.flags.pageTitle",
            "translation.admin.flags.subtitle",
            "translation.admin.flags.actions.add",
            "translation.admin.flags.panels.registry",
            "translation.admin.flags.panels.changes",
            "translation.admin.flags.delete.title",
            "translation.admin.flags.delete.message",
            "translation.admin.flags.delete.reasonLabel",
            "translation.admin.flags.delete.reasonPlaceholder", // parity:allow web i18n key kept verbatim for catalog parity
            "translation.admin.flags.delete.confirm",
            "translation.common.cancel",
        ];

        foreach (string key in required)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void DeleteMessage_InterpolatesTheFlagKey()
    {
        string message = FeatureFlagsRegistration.DeleteMessage(Localizer, "feature.dlq.replay_enabled");
        Assert.Contains("feature.dlq.replay_enabled", message, StringComparison.Ordinal);
        Assert.DoesNotContain("{0}", message, StringComparison.Ordinal);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

    private static FeatureFlagsPageViewModel NewViewModel(
        IFeatureFlagsFeed? flags = null,
        IFlagChangesFeed? changes = null,
        IFlagWriteService? write = null) =>
        new(
            flags ?? EmptyFeatureFlagsFeed.Instance,
            changes ?? EmptyFlagChangesFeed.Instance,
            write ?? NoopFlagWriteService.Instance,
            Localizer,
            () => DateTimeOffset.UnixEpoch);

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static FeatureFlagsSnapshot Flags(params (string Key, string Json)[] flags) =>
        new(flags.Select(f => new FeatureFlagEntry(f.Key, FeatureFlagsPageTests.Json(f.Json))).ToArray());

    private static FlagChangesSnapshot Changes(params FeatureFlagChangeRow[] rows) => new(rows);

    private static FeatureFlagChangeRow Change(string id, string operation) => new(
        Id: id,
        ChangedAt: "2026-06-06T12:00:00Z",
        Actor: "ops",
        FlagKey: "feature.a",
        Operation: operation,
        OldValueJson: null,
        NewValueJson: "true",
        Reason: "enable");

    private sealed class FakeFlagsFeed(FeatureFlagsSnapshot snapshot) : IFeatureFlagsFeed
    {
        public Task<FeatureFlagsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            Task.FromResult(snapshot);
    }

    private sealed class ThrowingFlagsFeed : IFeatureFlagsFeed
    {
        public Task<FeatureFlagsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("flags load failed", 500);
    }

    private sealed class FakeChangesFeed(FlagChangesSnapshot snapshot) : IFlagChangesFeed
    {
        public Task<FlagChangesSnapshot> FetchAsync(int limit, CancellationToken cancellationToken) =>
            Task.FromResult(snapshot);
    }

    private sealed class ThrowingChangesFeed : IFlagChangesFeed
    {
        public Task<FlagChangesSnapshot> FetchAsync(int limit, CancellationToken cancellationToken) =>
            throw new ApiException("changes load failed", 500);
    }

    private sealed class RecordingWriteService : IFlagWriteService
    {
        private readonly bool _shouldThrow;

        public RecordingWriteService(bool shouldThrow = false) => _shouldThrow = shouldThrow;

        public List<(string Key, string Reason)> SetCalls { get; } = [];

        public List<(string Key, string Reason)> DeleteCalls { get; } = [];

        public Task SetAsync(string key, JsonElement value, string reason, CancellationToken cancellationToken)
        {
            SetCalls.Add((key, reason));
            return _shouldThrow ? throw new ApiException("sudo required", 401) : Task.CompletedTask;
        }

        public Task DeleteAsync(string key, string reason, CancellationToken cancellationToken)
        {
            DeleteCalls.Add((key, reason));
            return _shouldThrow ? throw new ApiException("sudo required", 401) : Task.CompletedTask;
        }
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
