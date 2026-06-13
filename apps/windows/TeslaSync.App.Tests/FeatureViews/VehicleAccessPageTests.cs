using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Vehicles;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>VehicleAccessPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/vehicles/pages/VehicleAccessPage.tsx), the per-panel four-state matrix
/// (loading / empty / error / success), the status-badge map, the tolerant parsers, the driver / invitation row
/// projections, the view-model's load + refresh + create + remove + revoke flows, and the generated-client feed's
/// request shaping (web <c>useVehicle</c> / <c>useVehicleDrivers</c> / <c>useVehicleInvitations</c> /
/// <c>useRefreshVehicleDrivers</c> / <c>useRefreshVehicleInvitations</c> / <c>useRemoveVehicleDriver</c> /
/// <c>useCreateVehicleInvitation</c> / <c>useRevokeVehicleInvitation</c>). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="VehicleAccessDisplay"/> flags asserted
/// here.
/// </summary>
public sealed class VehicleAccessPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 27 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "vehicleAccess.drivers.email", "vehicleAccess.drivers.empty", "vehicleAccess.drivers.name",
        "vehicleAccess.drivers.refresh", "vehicleAccess.drivers.remove", "vehicleAccess.drivers.removeConfirm",
        "vehicleAccess.drivers.removeMessage", "vehicleAccess.drivers.removeTitle", "vehicleAccess.drivers.role",
        "vehicleAccess.drivers.title", "vehicleAccess.invitations.copyLink", "vehicleAccess.invitations.create",
        "vehicleAccess.invitations.createBtn", "vehicleAccess.invitations.createdBy", "vehicleAccess.invitations.empty",
        "vehicleAccess.invitations.expires", "vehicleAccess.invitations.link", "vehicleAccess.invitations.refresh",
        "vehicleAccess.invitations.revoke", "vehicleAccess.invitations.revokeConfirm",
        "vehicleAccess.invitations.revokeMessage", "vehicleAccess.invitations.revokeTitle",
        "vehicleAccess.invitations.status", "vehicleAccess.invitations.title", "vehicleAccess.refresh",
        "vehicleAccess.subtitle", "vehicleAccess.title",
    ];

    private static VehicleDriver Driver(
        long id = 1,
        long? shareUserId = 100,
        string? name = "Alice",
        string? email = "alice@example.com",
        string? role = "driver") =>
        new(id, shareUserId, email, name, role);

    private static VehicleInvitation Invitation(
        long id = 1,
        string invitationId = "inv-1",
        string? url = "https://tesla.example/i/abc",
        string status = "pending",
        string? createdBy = "owner@example.com") =>
        new(id, invitationId, url, status, DateTimeOffset.Parse("2030-01-01T00:00:00Z", System.Globalization.CultureInfo.InvariantCulture), createdBy);

    // One driver + one invitation so the row projections run and every keyed label site is exercised.
    private static VehicleAccessModel RichModel() => new(
        Drivers: [Driver()],
        DriversLoading: false,
        DriversError: false,
        DriversErrorDetail: null,
        DriversRefreshing: false,
        Invitations: [Invitation()],
        InvitationsLoading: false,
        InvitationsError: false,
        InvitationsErrorDetail: null,
        InvitationsRefreshing: false,
        Creating: false);

    // ---- i18n key coverage (all 27 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = VehicleAccessProjection.Project(RichModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Drivers panel: four data states -------------------------------------------

    [Fact]
    public void Drivers_state_loading_when_query_in_flight()
    {
        var display = VehicleAccessProjection.Project(VehicleAccessModel.Initial, Localizer).Drivers;

        Assert.Equal(VehicleAccessSectionState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void Drivers_state_empty_when_resolved_with_no_rows()
    {
        var model = VehicleAccessModel.Initial with { DriversLoading = false };
        var display = VehicleAccessProjection.Project(model, Localizer).Drivers;

        Assert.Equal(VehicleAccessSectionState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.Equal("No drivers found. Refresh to sync from Tesla.", display.EmptyMessage);
    }

    [Fact]
    public void Drivers_state_error_shows_message_with_detail()
    {
        var model = VehicleAccessModel.Initial with
        {
            DriversLoading = false,
            DriversError = true,
            DriversErrorDetail = "network down",
        };
        var display = VehicleAccessProjection.Project(model, Localizer).Drivers;

        Assert.Equal(VehicleAccessSectionState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void Drivers_state_success_when_rows_present()
    {
        var display = VehicleAccessProjection.Project(RichModel(), Localizer).Drivers;

        Assert.Equal(VehicleAccessSectionState.Success, display.State);
        Assert.True(display.ShowRows);
        Assert.Single(display.Rows);
        Assert.Equal(1, display.Count);
        Assert.True(display.ShowCount);
    }

    // ---- Invitations panel: four data states ---------------------------------------

    [Fact]
    public void Invitations_state_loading_empty_error_success()
    {
        Assert.Equal(
            VehicleAccessSectionState.Loading,
            VehicleAccessProjection.Project(VehicleAccessModel.Initial, Localizer).Invitations.State);

        var empty = VehicleAccessModel.Initial with { InvitationsLoading = false };
        Assert.Equal(
            VehicleAccessSectionState.Empty,
            VehicleAccessProjection.Project(empty, Localizer).Invitations.State);

        var error = empty with { InvitationsError = true, InvitationsErrorDetail = "boom" };
        Assert.Equal(
            VehicleAccessSectionState.Error,
            VehicleAccessProjection.Project(error, Localizer).Invitations.State);

        Assert.Equal(
            VehicleAccessSectionState.Success,
            VehicleAccessProjection.Project(RichModel(), Localizer).Invitations.State);
    }

    [Fact]
    public void Invitations_empty_message_matches_web()
    {
        var model = VehicleAccessModel.Initial with { InvitationsLoading = false };
        var display = VehicleAccessProjection.Project(model, Localizer).Invitations;

        Assert.Equal("No invitations yet. Create one to share vehicle access.", display.EmptyMessage);
    }

    // ---- Chrome strings ------------------------------------------------------------

    [Fact]
    public void Chrome_strings_match_web()
    {
        var display = VehicleAccessProjection.Project(RichModel(), Localizer);

        Assert.Equal("Vehicle Access", display.Title);
        Assert.Equal("Manage drivers and share invitations", display.Subtitle);

        Assert.Equal("Drivers", display.Drivers.Title);
        Assert.Equal("Refresh", display.Drivers.RefreshLabel);
        Assert.Equal("Refresh drivers", display.Drivers.RefreshAriaLabel);
        Assert.Equal("Name", display.Drivers.Columns.Name);
        Assert.Equal("Email", display.Drivers.Columns.Email);
        Assert.Equal("Role", display.Drivers.Columns.Role);
        Assert.Equal("Remove Driver", display.Drivers.RemoveTitle);
        Assert.Equal("Are you sure you want to remove this driver's access? This action cannot be undone.", display.Drivers.RemoveMessage);
        Assert.Equal("Remove", display.Drivers.RemoveConfirm);

        Assert.Equal("Share Invitations", display.Invitations.Title);
        Assert.Equal("Invite Driver", display.Invitations.CreateLabel);
        Assert.Equal("Create invitation", display.Invitations.CreateAriaLabel);
        Assert.Equal("Refresh invitations", display.Invitations.RefreshAriaLabel);
        Assert.Equal("Status", display.Invitations.Columns.Status);
        Assert.Equal("Created By", display.Invitations.Columns.CreatedBy);
        Assert.Equal("Expires", display.Invitations.Columns.Expires);
        Assert.Equal("Link", display.Invitations.Columns.Link);
        Assert.Equal("Copy invite link", display.Invitations.CopyLinkLabel);
        Assert.Equal("Revoke Invitation", display.Invitations.RevokeTitle);
        Assert.Equal("Are you sure you want to revoke this invitation? The invite link will no longer work.", display.Invitations.RevokeMessage);
        Assert.Equal("Revoke", display.Invitations.RevokeConfirm);
    }

    // ---- Driver row projection -----------------------------------------------------

    [Fact]
    public void Driver_row_projects_cells_and_remove_gate()
    {
        var row = Assert.Single(VehicleAccessProjection.Project(RichModel(), Localizer).Drivers.Rows);

        Assert.Equal("Alice", row.Name);
        Assert.Equal("alice@example.com", row.Email);
        Assert.Equal("driver", row.Role);
        Assert.True(row.HasRole);
        Assert.True(row.CanRemove);
        Assert.Equal(100, row.ShareUserId);
        Assert.Equal("Remove driver", row.RemoveLabel);
    }

    [Fact]
    public void Driver_row_em_dashes_blanks_and_hides_remove_without_share_id()
    {
        var driver = Driver(shareUserId: null, name: null, email: null, role: null);

        var row = VehicleAccessProjection.ProjectDriverRow(driver, Localizer);

        Assert.Equal(VehicleAccessProjection.EmDash, row.Name);
        Assert.Equal(VehicleAccessProjection.EmDash, row.Email);
        Assert.Equal(VehicleAccessProjection.EmDash, row.Role);
        Assert.False(row.HasRole);
        Assert.False(row.CanRemove);
    }

    // ---- Invitation row projection -------------------------------------------------

    [Fact]
    public void Invitation_row_projects_status_link_and_revoke_gate()
    {
        var row = Assert.Single(VehicleAccessProjection.Project(RichModel(), Localizer).Invitations.Rows);

        Assert.Equal("inv-1", row.InvitationId);
        Assert.Equal("online", row.StatusWord);
        Assert.Equal("TsColorSuccessBrush", row.StatusAccentBrushKey);
        Assert.Equal("owner@example.com", row.CreatedBy);
        Assert.True(row.HasLink);
        Assert.Equal("https://tesla.example/i/abc", row.InviteUrl);
        Assert.True(row.CanRevoke);
        Assert.Equal("Copy invite link", row.CopyLinkLabel);
        Assert.Equal("Revoke invitation", row.RevokeLabel);
    }

    [Fact]
    public void Invitation_row_hides_link_and_revoke_when_absent_or_not_pending()
    {
        var revoked = Invitation(url: null, status: "revoked", createdBy: null);

        var row = VehicleAccessProjection.ProjectInvitationRow(revoked, Localizer);

        Assert.False(row.HasLink);
        Assert.Equal(string.Empty, row.InviteUrl);
        Assert.False(row.CanRevoke);
        Assert.Equal(VehicleAccessProjection.EmDash, row.CreatedBy);
        Assert.Equal("offline", row.StatusWord);
    }

    [Theory]
    [InlineData("pending", "online", "TsColorSuccessBrush")]
    [InlineData("revoked", "offline", "TsColorDangerBrush")]
    [InlineData("accepted", "asleep", "TsChartPowerBrush")]
    [InlineData("", "asleep", "TsChartPowerBrush")]
    public void StatusBadge_map_matches_web(string status, string expectedWord, string expectedKey)
    {
        var (word, key) = VehicleAccessProjection.StatusBadge(status);

        Assert.Equal(expectedWord, word);
        Assert.Equal(expectedKey, key);
    }

    // ---- Tolerant parsing ----------------------------------------------------------

    [Fact]
    public void Drivers_ParseList_is_tolerant_of_partial_and_non_array_input()
    {
        using var notArray = JsonDocument.Parse("{\"x\":1}");
        Assert.Empty(VehicleDriver.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse(
            "[{\"id\":5,\"share_user_id\":7,\"driver_name\":\"Bob\",\"driver_email\":\"b@x.io\",\"role\":\"owner\"},{}]");
        var drivers = VehicleDriver.ParseList(partial.RootElement);
        Assert.Equal(2, drivers.Count);
        Assert.Equal(5, drivers[0].Id);
        Assert.Equal(7, drivers[0].ShareUserId);
        Assert.Equal("Bob", drivers[0].DriverName);
        Assert.Equal(0, drivers[1].Id);
        Assert.Null(drivers[1].ShareUserId);
    }

    [Fact]
    public void Invitations_ParseList_reads_status_url_and_expiry()
    {
        using var doc = JsonDocument.Parse(
            "[{\"id\":9,\"invitation_id\":\"abc\",\"invite_url\":\"https://x/y\",\"status\":\"pending\",\"expires_at\":\"2031-06-01T12:00:00Z\",\"created_by\":\"me\"},{}]");
        var invitations = VehicleInvitation.ParseList(doc.RootElement);

        Assert.Equal(2, invitations.Count);
        Assert.Equal("abc", invitations[0].InvitationId);
        Assert.Equal("https://x/y", invitations[0].InviteUrl);
        Assert.Equal("pending", invitations[0].Status);
        Assert.NotNull(invitations[0].ExpiresAt);
        Assert.Equal(2031, invitations[0].ExpiresAt!.Value.Year);
        Assert.Equal(string.Empty, invitations[1].InvitationId);
        Assert.Null(invitations[1].ExpiresAt);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_both_lists_into_success()
    {
        var feed = new FakeVehicleAccessFeed([Driver()], [Invitation()]);
        using var vm = new VehicleAccessPageViewModel(feed, Localizer, "1");

        await vm.LoadAsync();

        Assert.Equal(VehicleAccessSectionState.Success, vm.Display.Drivers.State);
        Assert.Equal(VehicleAccessSectionState.Success, vm.Display.Invitations.State);
        Assert.Equal("My Tesla", vm.VehicleName);
        Assert.Equal(1, feed.DriversFetchCount);
        Assert.Equal(1, feed.InvitationsFetchCount);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new VehicleAccessPageViewModel(EmptyVehicleAccessFeed.Instance, Localizer, "1");

        await vm.LoadAsync();

        Assert.Equal(VehicleAccessSectionState.Empty, vm.Display.Drivers.State);
        Assert.Equal(VehicleAccessSectionState.Empty, vm.Display.Invitations.State);
    }

    [Fact]
    public async Task ViewModel_disabled_without_vehicle_id_skips_fetch()
    {
        var feed = new FakeVehicleAccessFeed([Driver()], [Invitation()]);
        using var vm = new VehicleAccessPageViewModel(feed, Localizer, null);

        await vm.LoadAsync();

        Assert.Equal(VehicleAccessSectionState.Empty, vm.Display.Drivers.State);
        Assert.Equal(0, feed.DriversFetchCount);
        Assert.Equal(0, feed.InvitationsFetchCount);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        var feed = new ThrowingVehicleAccessFeed();
        using var vm = new VehicleAccessPageViewModel(feed, Localizer, "1");

        await vm.LoadAsync();

        Assert.Equal(VehicleAccessSectionState.Error, vm.Display.Drivers.State);
        Assert.Equal(VehicleAccessSectionState.Error, vm.Display.Invitations.State);
        Assert.Contains("Failed to load data", vm.Display.Drivers.ErrorText);
    }

    [Fact]
    public async Task ViewModel_refresh_drivers_calls_feed_then_reloads()
    {
        var feed = new FakeVehicleAccessFeed([Driver()], []);
        using var vm = new VehicleAccessPageViewModel(feed, Localizer, "1");
        await vm.LoadAsync();

        await vm.RefreshDriversAsync();

        Assert.True(feed.RefreshedDrivers);
        Assert.Equal(2, feed.DriversFetchCount); // initial + reload
        Assert.False(vm.Display.Drivers.Refreshing);
    }

    [Fact]
    public async Task ViewModel_refresh_invitations_calls_feed_then_reloads()
    {
        var feed = new FakeVehicleAccessFeed([], [Invitation()]);
        using var vm = new VehicleAccessPageViewModel(feed, Localizer, "1");
        await vm.LoadAsync();

        await vm.RefreshInvitationsAsync();

        Assert.True(feed.RefreshedInvitations);
        Assert.Equal(2, feed.InvitationsFetchCount);
    }

    [Fact]
    public async Task ViewModel_create_invitation_calls_feed_then_reloads_invitations()
    {
        var feed = new FakeVehicleAccessFeed([], [Invitation()]);
        using var vm = new VehicleAccessPageViewModel(feed, Localizer, "1");
        await vm.LoadAsync();

        await vm.CreateInvitationAsync();

        Assert.True(feed.Created);
        Assert.Equal(2, feed.InvitationsFetchCount);
    }

    [Fact]
    public async Task ViewModel_remove_driver_passes_share_user_id_then_reloads()
    {
        var feed = new FakeVehicleAccessFeed([Driver(shareUserId: 555)], []);
        using var vm = new VehicleAccessPageViewModel(feed, Localizer, "1");
        await vm.LoadAsync();

        await vm.RemoveDriverAsync(555);

        Assert.Equal(555, feed.RemovedShareUserId);
        Assert.Equal(2, feed.DriversFetchCount);
    }

    [Fact]
    public async Task ViewModel_revoke_invitation_passes_invitation_id_then_reloads()
    {
        var feed = new FakeVehicleAccessFeed([], [Invitation(invitationId: "to-revoke")]);
        using var vm = new VehicleAccessPageViewModel(feed, Localizer, "1");
        await vm.LoadAsync();

        await vm.RevokeInvitationAsync("to-revoke");

        Assert.Equal("to-revoke", feed.RevokedInvitationId);
        Assert.Equal(2, feed.InvitationsFetchCount);
    }

    // ---- Generated-client feed (web hooks → /vehicles/{id}/… endpoints) -------------

    [Fact]
    public async Task ClientFeed_drivers_sends_get_with_vehicle_path()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"driver_name\":\"A\"}]"));
        var feed = new VehicleAccessClientFeed(api, "42");

        var drivers = await feed.FetchDriversAsync(default);

        Assert.Single(drivers);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_drivers", request.OperationId);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task ClientFeed_invitations_sends_get_with_vehicle_path()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":1,\"invitation_id\":\"x\",\"status\":\"pending\"}]"));
        var feed = new VehicleAccessClientFeed(api, "42");

        var invitations = await feed.FetchInvitationsAsync(default);

        Assert.Single(invitations);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_invitations", request.OperationId);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task ClientFeed_vehicle_name_reads_display_name()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"id\":42,\"display_name\":\"Model 3\"}"));
        var feed = new VehicleAccessClientFeed(api, "42");

        var name = await feed.FetchVehicleNameAsync(default);

        Assert.Equal("Model 3", name);
        Assert.Equal("get_api_v1_vehicles_vehicleID", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_refresh_drivers_and_invitations_post()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[]")).ReturnsValue(Json("[]"));
        var feed = new VehicleAccessClientFeed(api, "42");

        await feed.RefreshDriversAsync(default);
        await feed.RefreshInvitationsAsync(default);

        Assert.Equal("post_api_v1_vehicles_vehicleID_drivers_refresh", api.Requests[0].OperationId);
        Assert.Equal("post_api_v1_vehicles_vehicleID_invitations_refresh", api.Requests[1].OperationId);
    }

    [Fact]
    public async Task ClientFeed_remove_driver_deletes_with_share_user_id_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new VehicleAccessClientFeed(api, "42");

        await feed.RemoveDriverAsync(555, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("delete_api_v1_vehicles_vehicleID_drivers", request.OperationId);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(request.Body);
        Assert.Equal(555L, body["share_user_id"]);
    }

    [Fact]
    public async Task ClientFeed_create_invitation_posts()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"id\":1}"));
        var feed = new VehicleAccessClientFeed(api, "42");

        await feed.CreateInvitationAsync(default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_vehicles_vehicleID_invitations", request.OperationId);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task ClientFeed_revoke_posts_with_vehicle_and_invitation_path()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new VehicleAccessClientFeed(api, "42");

        await feed.RevokeInvitationAsync("inv-9", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_vehicles_vehicleID_invitations_invitationID_revoke", request.OperationId);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
        Assert.Equal("inv-9", request.PathParams!["invitationID"]);
    }

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    // ── recording / fake doubles ───────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeVehicleAccessFeed : IVehicleAccessFeed
    {
        private readonly IReadOnlyList<VehicleDriver> _drivers;
        private readonly IReadOnlyList<VehicleInvitation> _invitations;
        private readonly string? _name;

        public FakeVehicleAccessFeed(
            IReadOnlyList<VehicleDriver> drivers,
            IReadOnlyList<VehicleInvitation> invitations,
            string? name = "My Tesla")
        {
            _drivers = drivers;
            _invitations = invitations;
            _name = name;
        }

        public int DriversFetchCount { get; private set; }

        public int InvitationsFetchCount { get; private set; }

        public bool RefreshedDrivers { get; private set; }

        public bool RefreshedInvitations { get; private set; }

        public bool Created { get; private set; }

        public long? RemovedShareUserId { get; private set; }

        public string? RevokedInvitationId { get; private set; }

        public Task<string?> FetchVehicleNameAsync(CancellationToken cancellationToken) => Task.FromResult(_name);

        public Task<IReadOnlyList<VehicleDriver>> FetchDriversAsync(CancellationToken cancellationToken)
        {
            DriversFetchCount++;
            return Task.FromResult(_drivers);
        }

        public Task<IReadOnlyList<VehicleInvitation>> FetchInvitationsAsync(CancellationToken cancellationToken)
        {
            InvitationsFetchCount++;
            return Task.FromResult(_invitations);
        }

        public Task RefreshDriversAsync(CancellationToken cancellationToken)
        {
            RefreshedDrivers = true;
            return Task.CompletedTask;
        }

        public Task RefreshInvitationsAsync(CancellationToken cancellationToken)
        {
            RefreshedInvitations = true;
            return Task.CompletedTask;
        }

        public Task RemoveDriverAsync(long shareUserId, CancellationToken cancellationToken)
        {
            RemovedShareUserId = shareUserId;
            return Task.CompletedTask;
        }

        public Task CreateInvitationAsync(CancellationToken cancellationToken)
        {
            Created = true;
            return Task.CompletedTask;
        }

        public Task RevokeInvitationAsync(string invitationId, CancellationToken cancellationToken)
        {
            RevokedInvitationId = invitationId;
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingVehicleAccessFeed : IVehicleAccessFeed
    {
        public Task<string?> FetchVehicleNameAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task<IReadOnlyList<VehicleDriver>> FetchDriversAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task<IReadOnlyList<VehicleInvitation>> FetchInvitationsAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task RefreshDriversAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task RefreshInvitationsAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task RemoveDriverAsync(long shareUserId, CancellationToken cancellationToken) => Task.CompletedTask;

        public Task CreateInvitationAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public Task RevokeInvitationAsync(string invitationId, CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
