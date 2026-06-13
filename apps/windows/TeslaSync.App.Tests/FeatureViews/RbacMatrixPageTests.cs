using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>RbacMatrixPage</c> surface's Microsoft.UI-free logic — the two data ports
/// (web <c>useRbacMatrix</c> / <c>useUpsertRbacCells</c>), the generated-client feed's request shaping + tolerant
/// parsing + open-auth mapping, the view-model's five render branches (loading / open-auth / error / empty / ready),
/// the edit / save / diff flow (web <c>handleToggle</c> / <c>handleSave</c> / <c>diffMatrices</c>), and the i18n
/// catalog binding (the 23 required keys). The WinUI view is exercised by the app build; its per-region visibility is
/// driven entirely by the view-model state asserted here.
/// </summary>
public sealed class RbacMatrixPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string SessionJson =
        """
        {
          "mode": "session",
          "roles": [ { "id": "admin", "name": "admin" }, { "id": "user", "name": "user" } ],
          "permissions": [
            { "id": "fleet.read", "name": "Read fleet", "category": "fleet" },
            { "id": "cmd.send", "name": "Send command", "category": "commands" }
          ],
          "categories": [ "fleet", "commands" ],
          "matrix": { "admin": { "fleet.read": true, "cmd.send": true }, "user": { "fleet.read": true } },
          "effective_for_me": { "fleet.read": true },
          "my_roles": [ "user" ],
          "groups_header_name": "X-Forwarded-Groups"
        }
        """;

    // ── Generated-client binding (web hook → operation id) ───────────────────────────────────────────────────────

    [Fact]
    public void Operations_ResolveAgainstTheGeneratedEndpointTable()
    {
        string[] operations = [RbacMatrixRegistration.MatrixOperation, RbacMatrixRegistration.UpsertOperation];

        foreach (string op in operations)
        {
            Assert.Contains(GeneratedApi.ApiEndpoints.All, e => e.OperationId == op);
        }
    }

    [Fact]
    public async Task MatrixClientFeed_ShapesTheRequest_AndParsesTheSnapshot()
    {
        var api = new FakeApiClient().ReturnsValue(Json(SessionJson));
        var feed = new RbacMatrixClientFeed(api);

        RbacMatrixSnapshot snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.Equal(RbacMatrixRegistration.MatrixOperation, api.Requests[0].OperationId);
        Assert.False(snapshot.IsOpenMode);
        Assert.Equal(2, snapshot.Roles.Count);
        Assert.Equal("admin", snapshot.Roles[0].Id);
        Assert.Equal(2, snapshot.Permissions.Count);
        Assert.Equal("fleet", snapshot.Permissions[0].Category);
        Assert.Equal(new[] { "fleet", "commands" }, snapshot.Categories);
        Assert.True(snapshot.Matrix["admin"]["fleet.read"]);
        Assert.True(snapshot.Matrix["admin"]["cmd.send"]);
        Assert.True(snapshot.Matrix["user"]["fleet.read"]);
        Assert.False(snapshot.Matrix["user"].ContainsKey("cmd.send")); // "no opinion → deny"
        Assert.True(snapshot.EffectiveForMe["fleet.read"]);
        Assert.Equal(new[] { "user" }, snapshot.MyRoles);
        Assert.Equal("X-Forwarded-Groups", snapshot.GroupsHeaderName);
    }

    [Fact]
    public async Task MatrixClientFeed_MapsAuthModeOpenException_ToOpenSnapshot()
    {
        var api = new FakeApiClient().Throws(
            new ApiException("open", 501, errorCode: RbacMatrixRegistration.AuthModeOpenCode));
        var feed = new RbacMatrixClientFeed(api);

        RbacMatrixSnapshot snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.True(snapshot.IsOpenMode);
        Assert.True(RbacMatrix.IsRbacOpenMode(snapshot));
    }

    [Fact]
    public async Task MatrixClientFeed_MapsExplicitOpenEnvelope_ToOpenSnapshot()
    {
        var api = new FakeApiClient().ReturnsValue(Json("""{ "mode": "open" }"""));
        var feed = new RbacMatrixClientFeed(api);

        RbacMatrixSnapshot snapshot = await feed.FetchAsync(CancellationToken.None);

        Assert.True(snapshot.IsOpenMode);
    }

    [Fact]
    public async Task MatrixClientFeed_RethrowsOtherApiErrors()
    {
        var api = new FakeApiClient().Throws(new ApiException("boom", 500, errorCode: "INTERNAL"));
        var feed = new RbacMatrixClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(CancellationToken.None));
    }

    [Fact]
    public async Task UpsertClientService_ShapesThePutRequest_WithSnakeCaseCellsBody()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{}"));
        var service = new RbacUpsertClientService(api);

        await service.UpsertAsync([new RbacUpsertCell("user", "cmd.send", true)], CancellationToken.None);

        ApiRequest request = api.Requests[0];
        Assert.Equal(RbacMatrixRegistration.UpsertOperation, request.OperationId);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(request.Body);
        var cells = Assert.IsAssignableFrom<IEnumerable<Dictionary<string, object?>>>(body["cells"]);
        Dictionary<string, object?> cell = Assert.Single(cells);
        Assert.Equal("user", cell["role_id"]);
        Assert.Equal("cmd.send", cell["permission_id"]);
        Assert.Equal(true, cell["allowed"]);
    }

    // ── diffMatrices (web hook helper) ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void DiffMatrices_ReturnsOnlyChangedCells()
    {
        var baseMatrix = Matrix(("admin", "a", true));
        var draft = Matrix(("admin", "a", false), ("admin", "b", true));

        IReadOnlyList<RbacUpsertCell> cells = RbacMatrix.DiffMatrices(baseMatrix, draft);

        Assert.Equal(2, cells.Count);
        Assert.Contains(cells, c => c is { RoleId: "admin", PermissionId: "a", Allowed: false });
        Assert.Contains(cells, c => c is { RoleId: "admin", PermissionId: "b", Allowed: true });
    }

    [Fact]
    public void DiffMatrices_IdenticalMatrices_AreEmpty()
    {
        var baseMatrix = Matrix(("admin", "a", true));
        var draft = Matrix(("admin", "a", true));

        Assert.Empty(RbacMatrix.DiffMatrices(baseMatrix, draft));
    }

    // ── View-model render-branch matrix (the four required parity states + open-auth) ────────────────────────────

    [Fact]
    public void InitialState_IsLoading()
    {
        using var vm = NewViewModel();
        Assert.Equal(RbacMatrixState.Loading, vm.State);
    }

    [Fact]
    public async Task LoadAsync_OpenAuth_ReachesOpenModeState()
    {
        using var vm = NewViewModel(new FakeMatrixFeed(RbacMatrixSnapshot.Open));

        await vm.LoadAsync();

        Assert.Equal(RbacMatrixState.OpenMode, vm.State);
    }

    [Fact]
    public async Task LoadAsync_NoRoles_ReachesEmptyState()
    {
        using var vm = NewViewModel(new FakeMatrixFeed(RbacMatrixSnapshot.Empty));

        await vm.LoadAsync();

        Assert.Equal(RbacMatrixState.Empty, vm.State);
    }

    [Fact]
    public async Task LoadAsync_Session_ReachesReadyState_WithProjections()
    {
        using var vm = NewViewModel(new FakeMatrixFeed(Snapshot()));

        await vm.LoadAsync();

        Assert.Equal(RbacMatrixState.Ready, vm.State);
        Assert.False(vm.IsFetching);
        Assert.Equal(StatusKind.Info, vm.MyRolesStatus);          // my_roles non-empty
        Assert.Equal(StatusKind.Success, vm.EffectiveStatus);     // 1 effective permission
        Assert.True(vm.HasGroupsHeader);
        Assert.Equal(2, vm.GroupedPermissions().Count);           // fleet + commands bands
        Assert.True(vm.IsAllowed("admin", "cmd.send"));
        Assert.False(vm.IsAllowed("user", "cmd.send"));
    }

    [Fact]
    public async Task LoadAsync_Failure_ReachesErrorState_WithCode()
    {
        using var vm = NewViewModel(new ThrowingMatrixFeed(new ApiException("boom", 500, errorCode: "MATRIX_FAIL")));

        await vm.LoadAsync();

        Assert.Equal(RbacMatrixState.Error, vm.State);
        Assert.Equal("MATRIX_FAIL", vm.ErrorLoadMessage);
    }

    // ── Edit / save flow (web handleToggle / handleSave) ─────────────────────────────────────────────────────────

    [Fact]
    public async Task EnterEdit_Toggle_TracksDirtyCount()
    {
        using var vm = NewViewModel(new FakeMatrixFeed(Snapshot()));
        await vm.LoadAsync();

        vm.EnterEdit();
        Assert.True(vm.Editing);
        Assert.Equal(0, vm.DirtyCount);

        vm.Toggle("user", "cmd.send", true);
        Assert.Equal(1, vm.DirtyCount);

        vm.Toggle("user", "cmd.send", false); // back to the snapshot value
        Assert.Equal(0, vm.DirtyCount);
    }

    [Fact]
    public async Task SaveAsync_Success_WritesDiff_AndExitsEdit()
    {
        var write = new RecordingWriteService();
        using var vm = NewViewModel(new FakeMatrixFeed(Snapshot()), write);
        await vm.LoadAsync();

        vm.EnterEdit();
        vm.Toggle("user", "cmd.send", true);
        bool ok = await vm.SaveAsync();

        Assert.True(ok);
        Assert.False(vm.Editing);
        IReadOnlyList<RbacUpsertCell> sent = Assert.Single(write.Batches);
        RbacUpsertCell cell = Assert.Single(sent);
        Assert.Equal("user", cell.RoleId);
        Assert.Equal("cmd.send", cell.PermissionId);
        Assert.True(cell.Allowed);
    }

    [Fact]
    public async Task SaveAsync_NoChanges_ExitsEdit_WithoutWriting()
    {
        var write = new RecordingWriteService();
        using var vm = NewViewModel(new FakeMatrixFeed(Snapshot()), write);
        await vm.LoadAsync();

        vm.EnterEdit();
        bool ok = await vm.SaveAsync();

        Assert.True(ok);
        Assert.False(vm.Editing);
        Assert.Empty(write.Batches);
    }

    [Fact]
    public async Task SaveAsync_Failure_StaysInEdit_WithSubmitError()
    {
        var write = new RecordingWriteService(new ApiException("denied", 401, errorCode: "SUDO_REQUIRED"));
        using var vm = NewViewModel(new FakeMatrixFeed(Snapshot()), write);
        await vm.LoadAsync();

        vm.EnterEdit();
        vm.Toggle("user", "cmd.send", true);
        bool ok = await vm.SaveAsync();

        Assert.False(ok);
        Assert.True(vm.Editing);
        Assert.Equal("SUDO_REQUIRED", vm.SubmitError);
    }

    [Fact]
    public async Task CancelEdit_DiscardsDraftEdits()
    {
        using var vm = NewViewModel(new FakeMatrixFeed(Snapshot()));
        await vm.LoadAsync();

        vm.EnterEdit();
        vm.Toggle("user", "cmd.send", true);
        Assert.Equal(1, vm.DirtyCount);

        vm.CancelEdit();
        Assert.False(vm.Editing);
        Assert.Equal(0, vm.DirtyCount);
        Assert.False(vm.IsAllowed("user", "cmd.send"));
    }

    // ── i18n: every visible literal resolves through the catalog (the 23 required keys) ──────────────────────────

    [Fact]
    public void Registration_ResolvesEveryRequiredCatalogKey()
    {
        var recorder = new RecordingLocalizer();

        _ = RbacMatrixRegistration.Title(recorder);
        _ = RbacMatrixRegistration.Subtitle(recorder);
        _ = RbacMatrixRegistration.PermissionColumn(recorder);
        _ = RbacMatrixRegistration.OpenModeTitle(recorder);
        _ = RbacMatrixRegistration.OpenModeMessage(recorder);
        _ = RbacMatrixRegistration.EditLabel(recorder);
        _ = RbacMatrixRegistration.SaveLabel(recorder, 2);
        _ = RbacMatrixRegistration.SavingLabel(recorder);
        _ = RbacMatrixRegistration.CancelLabel(recorder);
        _ = RbacMatrixRegistration.RetryLabel(recorder);
        _ = RbacMatrixRegistration.CellAllowed(recorder);
        _ = RbacMatrixRegistration.CellDenied(recorder);
        _ = RbacMatrixRegistration.CellToggle(recorder, "admin", "fleet.read");
        _ = RbacMatrixRegistration.EffectiveCount(recorder, 1, 2);
        _ = RbacMatrixRegistration.EffectiveTooltip(recorder);
        _ = RbacMatrixRegistration.MyRolesLabel(recorder, "user");
        _ = RbacMatrixRegistration.MyRolesNone(recorder);
        _ = RbacMatrixRegistration.GroupsHeaderLabel(recorder, "X-Groups");
        _ = RbacMatrixRegistration.EmptyTitle(recorder);
        _ = RbacMatrixRegistration.EmptyMessage(recorder);
        _ = RbacMatrixRegistration.ErrorLoadTitle(recorder);
        _ = RbacMatrixRegistration.ErrorLoadGeneric(recorder);
        _ = RbacMatrixRegistration.ErrorSaveGeneric(recorder);

        string[] required =
        [
            "translation.rbac.title",
            "translation.rbac.subtitle",
            "translation.rbac.permissionColumn",
            "translation.rbac.openMode.title",
            "translation.rbac.openMode.message",
            "translation.rbac.actions.edit",
            "translation.rbac.actions.save",
            "translation.rbac.actions.saving",
            "translation.rbac.actions.cancel",
            "translation.rbac.actions.retry",
            "translation.rbac.cell.allowed",
            "translation.rbac.cell.denied",
            "translation.rbac.cell.toggle",
            "translation.rbac.effective.count",
            "translation.rbac.effective.tooltip",
            "translation.rbac.myRoles.label",
            "translation.rbac.myRoles.none",
            "translation.rbac.groupsHeader.label",
            "translation.rbac.empty.title",
            "translation.rbac.empty.message",
            "translation.rbac.errors.loadTitle",
            "translation.rbac.errors.loadGeneric",
            "translation.rbac.errors.saveGeneric",
        ];

        foreach (string key in required)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void ParameterizedStrings_Interpolate()
    {
        Assert.Contains("3", RbacMatrixRegistration.SaveLabel(Localizer, 3), StringComparison.Ordinal);
        Assert.Contains("admin", RbacMatrixRegistration.CellToggle(Localizer, "admin", "fleet.read"), StringComparison.Ordinal);
        Assert.Contains("fleet.read", RbacMatrixRegistration.CellToggle(Localizer, "admin", "fleet.read"), StringComparison.Ordinal);
        Assert.Contains("X-Groups", RbacMatrixRegistration.GroupsHeaderLabel(Localizer, "X-Groups"), StringComparison.Ordinal);

        string effective = RbacMatrixRegistration.EffectiveCount(Localizer, 1, 2);
        Assert.Contains("1", effective, StringComparison.Ordinal);
        Assert.Contains("2", effective, StringComparison.Ordinal);
        Assert.DoesNotContain("{0}", effective, StringComparison.Ordinal);
    }

    [Fact]
    public void CategoryLabel_FallsBackToTheRawCategory()
    {
        // No catalog entry for an unknown band → the raw category id, matching the web `t(key, cat)` default.
        Assert.Equal("custom", RbacMatrixRegistration.CategoryLabel(Localizer, "custom"));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────

    private static RbacMatrixPageViewModel NewViewModel(IRbacMatrixFeed? feed = null, IRbacWriteService? write = null) =>
        new(feed ?? OpenModeRbacMatrixFeed.Instance, write ?? NoopRbacWriteService.Instance, Localizer);

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static RbacMatrixSnapshot Snapshot() => RbacMatrixClientFeed.ParseSnapshot(Json(SessionJson));

    private static Dictionary<string, IReadOnlyDictionary<string, bool>> Matrix(
        params (string Role, string Perm, bool Allowed)[] cells)
    {
        var map = new Dictionary<string, Dictionary<string, bool>>(StringComparer.Ordinal);
        foreach ((string role, string perm, bool allowed) in cells)
        {
            if (!map.TryGetValue(role, out Dictionary<string, bool>? row))
            {
                row = new Dictionary<string, bool>(StringComparer.Ordinal);
                map[role] = row;
            }

            row[perm] = allowed;
        }

        var result = new Dictionary<string, IReadOnlyDictionary<string, bool>>(StringComparer.Ordinal);
        foreach ((string role, Dictionary<string, bool> row) in map)
        {
            result[role] = row;
        }

        return result;
    }

    private sealed class FakeMatrixFeed(RbacMatrixSnapshot snapshot) : IRbacMatrixFeed
    {
        public Task<RbacMatrixSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            Task.FromResult(snapshot);
    }

    private sealed class ThrowingMatrixFeed(ApiException exception) : IRbacMatrixFeed
    {
        public Task<RbacMatrixSnapshot> FetchAsync(CancellationToken cancellationToken) => throw exception;
    }

    private sealed class RecordingWriteService(ApiException? throwOnWrite = null) : IRbacWriteService
    {
        public List<IReadOnlyList<RbacUpsertCell>> Batches { get; } = [];

        public Task UpsertAsync(IReadOnlyList<RbacUpsertCell> cells, CancellationToken cancellationToken)
        {
            Batches.Add(cells);
            return throwOnWrite is null ? Task.CompletedTask : throw throwOnWrite;
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
