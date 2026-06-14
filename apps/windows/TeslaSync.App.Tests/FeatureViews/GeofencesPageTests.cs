using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Maps;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>GeofencesPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/maps/pages/GeofencesPage.tsx), the tolerant snake_case parsers, the four-state matrix
/// (loading / empty / error / success), the client-side name filter + pin ordering, the form validator + write
/// payload (web zod schema + <c>toGeofencePayload</c>), the view-model's CRUD + toast flow, and the generated
/// client feed's request shaping. The WinUI view + create/edit modal are exercised by the app build; their
/// per-region visibility is driven by the <see cref="GeofencesDisplay"/> flags asserted here.
/// </summary>
public sealed class GeofencesPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Required i18n keys resolved by the headless projection / view-model (subset of the manifest's 66; the
    // modal / location keys are resolved by the WinUI view, exercised by the app build).
    private static readonly string[] ProjectionStringKeys =
    [
        "Geofences", "Define locations for contextual tracking and automation", "Add Geofence", "common.noData",
        "Total Geofences", "Active", "Inactive", "Entry Alerts", "Exit Alerts", "Entry & Exit", "Entry", "Exit",
        "None", "m", "editableText.rename.geofence", "geofences.selectGeofence", "geofences.searchPlaceholder",
        "geofences.filterLabel.search", "geofences.noMatches", "Clear search", "No geofences defined",
        "Add a geofence to track when your vehicle arrives or leaves a location.", "geofences.bulk.delete",
        "geofences.bulk.deleteConfirm.title", "geofences.bulk.deleteConfirm.body", "common.delete",
        "geofences.noun.one", "geofences.noun.other",
    ];

    private static Geofence Fence(
        long id = 1,
        string name = "Home",
        double lat = 37.7749,
        double lng = -122.4194,
        double radius = 150,
        bool entry = true,
        bool exit = true,
        bool enabled = true) =>
        new(id, name, lat, lng, radius, entry, exit, enabled, "2026-06-01T08:00:00Z");

    private static IReadOnlyList<Geofence> Sample() =>
    [
        Fence(1, "Home", 37.7749, -122.4194, 150, entry: true, exit: true, enabled: true),
        Fence(2, "Work", 37.33, -122.03, 200, entry: true, exit: false, enabled: false),
        Fence(3, "Gym", 40.0, -74.0, 100, entry: false, exit: true, enabled: true),
        Fence(4, "Cabin", 45.0, -120.0, 500, entry: false, exit: false, enabled: true),
    ];

    private static GeofencesModel Model(
        IReadOnlyList<Geofence>? items = null,
        bool loading = false,
        string? error = null,
        string search = "",
        IReadOnlyList<GeofencePin>? pins = null,
        IReadOnlyCollection<long>? selected = null) =>
        new(
            items ?? Sample(),
            pins ?? Array.Empty<GeofencePin>(),
            loading,
            error is not null,
            error,
            search,
            selected ?? Array.Empty<long>());

    private static GeofencesDisplay Project(GeofencesModel model) => GeofencesProjection.Project(model, Localizer);

    // ---- i18n key coverage ----------------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_projection_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = GeofencesProjection.Project(Model(), recorder);

        foreach (var key in ProjectionStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states -----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight_and_no_data()
    {
        var display = Project(Model(Array.Empty<Geofence>(), loading: true));

        Assert.Equal(GeofencesState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_geofences()
    {
        var display = Project(Model(Array.Empty<Geofence>()));

        Assert.Equal(GeofencesState.Empty, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ShowDefinedEmpty);
        Assert.Equal("No geofences defined", display.DefinedEmptyTitle);
        Assert.False(display.StatsHasData);
        Assert.Equal("No data available", display.StatsEmptyMessage);
    }

    [Fact]
    public void State_error_when_query_failed_and_no_data()
    {
        var display = Project(Model(Array.Empty<Geofence>(), error: "network down"));

        Assert.Equal(GeofencesState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_geofences_present()
    {
        var display = Project(Model());

        Assert.Equal(GeofencesState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ShowRows);
        Assert.Equal(4, display.Rows.Count);
    }

    // ---- Summary metric cards -------------------------------------------------------

    [Fact]
    public void Metric_cards_project_four_tiles_with_web_aggregations()
    {
        var display = Project(Model());

        Assert.Equal(4, display.Metrics.Count);
        Assert.Equal("Total Geofences", display.Metrics[0].Label);
        Assert.Equal("4", display.Metrics[0].Value);
        Assert.Equal("Active", display.Metrics[1].Label);
        Assert.Equal("3", display.Metrics[1].Value);   // Home, Gym, Cabin enabled
        Assert.Equal("Entry Alerts", display.Metrics[2].Label);
        Assert.Equal("2", display.Metrics[2].Value);   // Home, Work
        Assert.Equal("Exit Alerts", display.Metrics[3].Label);
        Assert.Equal("2", display.Metrics[3].Value);   // Home, Gym
    }

    // ---- Row projection -------------------------------------------------------------

    [Fact]
    public void Row_projects_badges_coordinates_and_radius()
    {
        var display = Project(Model(new[] { Fence(7, "Office", 12.5, -34.25, 250, entry: true, exit: false, enabled: false) }));
        var row = display.Rows[0];

        Assert.Equal("Office", row.Name);
        Assert.Equal("Inactive", row.EnabledLabel);
        Assert.Equal("Entry", row.AlertLabel);
        Assert.Equal("250m", row.RadiusText);
        Assert.Contains("12.5", row.Coordinates, StringComparison.Ordinal);
        Assert.Contains("-34.25", row.Coordinates, StringComparison.Ordinal);
        Assert.Contains("Office", row.SelectLabel, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(true, true, "Entry & Exit")]
    [InlineData(true, false, "Entry")]
    [InlineData(false, true, "Exit")]
    [InlineData(false, false, "None")]
    public void Alert_label_matches_web_getAlertType(bool entry, bool exit, string expected)
    {
        var kind = GeofenceAlerts.FromFlags(entry, exit);
        Assert.Equal(expected, GeofenceAlerts.BadgeLabel(kind, Localizer));
    }

    // ---- Search filter + pin ordering ----------------------------------------------

    [Fact]
    public void Search_filters_rows_by_name_case_insensitively()
    {
        var display = Project(Model(search: "gym"));

        Assert.Single(display.Rows);
        Assert.Equal("Gym", display.Rows[0].Name);
        Assert.True(display.ShowFilterChip);
    }

    [Fact]
    public void Search_with_no_match_shows_no_matches_state()
    {
        var display = Project(Model(search: "nothing-here"));

        Assert.True(display.ShowNoMatches);
        Assert.False(display.ShowRows);
        Assert.Equal("No geofences match your search.", display.NoMatchesMessage);
    }

    [Fact]
    public void Pins_float_geofences_to_the_top_in_position_order()
    {
        var pins = new[] { new GeofencePin("3", 0), new GeofencePin("1", 1) };
        var display = Project(Model(pins: pins));

        Assert.Equal(3, display.Rows[0].Id);   // pinned position 0
        Assert.Equal(1, display.Rows[1].Id);   // pinned position 1
    }

    // ---- Parsing (snake_case wire shape) -------------------------------------------

    [Fact]
    public void Geofence_parses_snake_case_wire_shape()
    {
        var json = Element("""
            [{ "id": 42, "name": "Depot", "latitude": 1.5, "longitude": 2.5, "radius": 320,
               "alert_on_entry": true, "alert_on_exit": false, "enabled": true, "created_at": "2026-01-01T00:00:00Z" }]
            """);

        var list = Geofence.ParseList(json);

        Assert.Single(list);
        Assert.Equal(42, list[0].Id);
        Assert.Equal("Depot", list[0].Name);
        Assert.Equal(320, list[0].Radius);
        Assert.Equal(GeofenceAlertKind.Entry, list[0].AlertKind);
    }

    [Fact]
    public void Vehicle_option_label_falls_back_to_vin()
    {
        var json = Element("""[{ "id": 5, "display_name": "", "vin": "5YJ" }, { "id": 6, "display_name": "Red", "vin": "X" }]""");

        var list = GeofenceVehicleOption.ParseList(json);

        Assert.Equal("5YJ", list[0].Label);
        Assert.Equal("Red", list[1].Label);
    }

    [Fact]
    public void Position_reads_first_fix_or_null()
    {
        Assert.Null(GeofencePosition.FirstFrom(Element("[]")));
        var pos = GeofencePosition.FirstFrom(Element("""[{ "latitude": 10.0, "longitude": 20.0 }]"""));
        Assert.NotNull(pos);
        Assert.Equal(10.0, pos!.Latitude);
    }

    // ---- Form validation (web zod schema) ------------------------------------------

    [Fact]
    public void Valid_form_passes_validation()
    {
        var form = new GeofenceFormState("Home", "37.7", "-122.4", "100", GeofenceAlertKind.Both, true);
        Assert.False(GeofenceFormValidator.Validate(form).HasAny);
    }

    [Fact]
    public void Out_of_range_form_fails_each_field()
    {
        var form = new GeofenceFormState("", "200", "400", "5", GeofenceAlertKind.None, false);
        var errors = GeofenceFormValidator.Validate(form);

        Assert.NotNull(errors.Name);
        Assert.NotNull(errors.Latitude);
        Assert.NotNull(errors.Longitude);
        Assert.NotNull(errors.Radius);
    }

    // ---- Write payload (web toGeofencePayload + costPerKwh:null) --------------------

    [Fact]
    public void Write_payload_expands_alert_kind_and_uses_camel_case_body()
    {
        var form = new GeofenceFormState("Home", "37.7", "-122.4", "150", GeofenceAlertKind.Exit, true);
        var write = GeofenceWrite.FromForm(form);

        Assert.False(write.AlertOnEntry);
        Assert.True(write.AlertOnExit);

        var body = write.ToBody();
        Assert.Equal("Home", body["name"]);
        Assert.Equal(150.0, body["radius"]);
        Assert.True(body.ContainsKey("alertOnEntry"));
        Assert.True(body.ContainsKey("alertOnExit"));
        Assert.Null(body["costPerKwh"]);
    }

    [Fact]
    public void Rename_write_preserves_existing_geometry_with_new_name()
    {
        var write = GeofenceWrite.FromRename(Fence(1, "Old", 1, 2, 99, entry: true, exit: false, enabled: true), "New");

        Assert.Equal("New", write.Name);
        Assert.Equal(99, write.Radius);
        Assert.True(write.AlertOnEntry);
        Assert.False(write.AlertOnExit);
    }

    // ---- View-model CRUD + toast flow ----------------------------------------------

    [Fact]
    public async Task Load_populates_items_and_reaches_success()
    {
        var feed = new FakeFeed { Geofences = Sample() };
        using var vm = new GeofencesPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(GeofencesState.Success, vm.State);
        Assert.Equal(4, vm.Display.Rows.Count);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task Load_failure_reaches_error_state()
    {
        var feed = new FakeFeed { FetchError = new InvalidOperationException("boom") };
        using var vm = new GeofencesPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(GeofencesState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task Create_writes_payload_and_raises_success_toast()
    {
        var recorder = new RecordingLocalizer();
        var feed = new FakeFeed { Geofences = Sample() };
        using var vm = new GeofencesPageViewModel(feed, recorder);
        await vm.LoadAsync();

        bool ok = await vm.CreateAsync(new GeofenceFormState("New", "1", "2", "100", GeofenceAlertKind.Both, true));

        Assert.True(ok);
        Assert.Single(feed.Writes);
        Assert.Contains("Geofence created", recorder.Keys);
        Assert.Equal("Geofence created", vm.ToastMessage);
        Assert.False(vm.ToastIsError);
    }

    [Fact]
    public async Task Toggle_failure_raises_error_toast()
    {
        var recorder = new RecordingLocalizer();
        var feed = new FakeFeed { Geofences = Sample(), ToggleError = new InvalidOperationException("nope") };
        using var vm = new GeofencesPageViewModel(feed, recorder);
        await vm.LoadAsync();

        bool ok = await vm.ToggleAsync(1, false);

        Assert.False(ok);
        Assert.Contains("Failed to toggle geofence", recorder.Keys);
        Assert.True(vm.ToastIsError);
    }

    [Fact]
    public async Task Bulk_delete_clears_selection_and_reloads()
    {
        var feed = new FakeFeed { Geofences = Sample() };
        using var vm = new GeofencesPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        vm.ToggleSelect(1);
        vm.ToggleSelect(2);
        Assert.Equal(2, vm.SelectedIds.Count);

        bool ok = await vm.BulkDeleteAsync(new long[] { 1, 2 });

        Assert.True(ok);
        Assert.Empty(vm.SelectedIds);
        Assert.Equal(new long[] { 1, 2 }, feed.BulkDeleted);
    }

    [Fact]
    public async Task Delete_raises_deleted_toast()
    {
        var recorder = new RecordingLocalizer();
        var feed = new FakeFeed { Geofences = Sample() };
        using var vm = new GeofencesPageViewModel(feed, recorder);
        await vm.LoadAsync();

        await vm.DeleteAsync(3);

        Assert.Contains("Geofence deleted", recorder.Keys);
        Assert.Contains(3L, feed.Deleted);
    }

    // ---- Generated client feed request shaping -------------------------------------

    [Fact]
    public async Task Client_feed_lists_via_geofences_operation()
    {
        var api = new FakeApiClient().ReturnsValue(Element("[]"));
        var feed = new GeofencesClientFeed(api);

        _ = await feed.FetchGeofencesAsync(CancellationToken.None);

        Assert.Equal("get_api_v1_geofences", api.Requests[0].OperationId);
    }

    [Fact]
    public async Task Client_feed_create_posts_camel_case_body()
    {
        var api = new FakeApiClient().ReturnsValue(Element("{}"));
        var feed = new GeofencesClientFeed(api);
        var write = GeofenceWrite.FromForm(new GeofenceFormState("Home", "1", "2", "100", GeofenceAlertKind.Both, true));

        await feed.CreateAsync(write, CancellationToken.None);

        Assert.Equal("post_api_v1_geofences", api.Requests[0].OperationId);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(api.Requests[0].Body);
        Assert.True(body.ContainsKey("alertOnEntry"));
        Assert.Null(body["costPerKwh"]);
    }

    [Fact]
    public async Task Client_feed_bulk_delete_sends_ids_and_op()
    {
        var api = new FakeApiClient().ReturnsValue(Element("{}"));
        var feed = new GeofencesClientFeed(api);

        await feed.BulkDeleteAsync(new long[] { 7, 8 }, CancellationToken.None);

        Assert.Equal("post_api_v1_geofences_bulk", api.Requests[0].OperationId);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(api.Requests[0].Body);
        Assert.Equal("delete", body["op"]);
    }

    [Fact]
    public async Task Client_feed_positions_scopes_to_vehicle_with_limit()
    {
        var api = new FakeApiClient().ReturnsValue(Element("[]"));
        var feed = new GeofencesClientFeed(api);

        _ = await feed.FetchLatestPositionAsync(99, CancellationToken.None);

        var request = api.Requests[0];
        Assert.Equal("get_api_v1_vehicles_vehicleID_positions", request.OperationId);
        Assert.Equal("99", request.PathParams!["vehicleID"]);
        Assert.Equal(1, request.Query!["limit"]);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_the_geofence_operation_ids()
    {
        Assert.Equal("Geofences", GeofencesRegistration.RouteName);
        Assert.Equal("post_api_v1_geofences", GeofencesRegistration.CreateOperation);
        Assert.Equal("put_api_v1_geofences_geofenceID", GeofencesRegistration.UpdateOperation);
        Assert.Equal("delete_api_v1_geofences_geofenceID", GeofencesRegistration.DeleteOperation);
        Assert.Equal("post_api_v1_geofences_bulk", GeofencesRegistration.BulkDeleteOperation);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new GeofencesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=GeofencesPage", Assert.Single(lines));
    }

    private static JsonElement Element(string json) => JsonSerializer.Deserialize<JsonElement>(json);

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed : IGeofencesFeed
    {
        public IReadOnlyList<Geofence> Geofences { get; set; } = Array.Empty<Geofence>();
        public IReadOnlyList<GeofenceVehicleOption> Vehicles { get; set; } = Array.Empty<GeofenceVehicleOption>();
        public IReadOnlyList<GeofencePin> Pins { get; set; } = Array.Empty<GeofencePin>();
        public Exception? FetchError { get; set; }
        public Exception? ToggleError { get; set; }
        public List<GeofenceWrite> Writes { get; } = new();
        public List<long> Deleted { get; } = new();
        public IReadOnlyList<long>? BulkDeleted { get; private set; }

        public Task<IReadOnlyList<Geofence>> FetchGeofencesAsync(CancellationToken cancellationToken)
        {
            if (FetchError is not null)
            {
                throw FetchError;
            }

            return Task.FromResult(Geofences);
        }

        public Task<IReadOnlyList<GeofenceVehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Vehicles);

        public Task<IReadOnlyList<GeofencePin>> FetchPinnedAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Pins);

        public Task<GeofencePosition?> FetchLatestPositionAsync(long vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult<GeofencePosition?>(new GeofencePosition(1, 2));

        public Task CreateAsync(GeofenceWrite write, CancellationToken cancellationToken)
        {
            Writes.Add(write);
            return Task.CompletedTask;
        }

        public Task UpdateAsync(long id, GeofenceWrite write, CancellationToken cancellationToken)
        {
            Writes.Add(write);
            return Task.CompletedTask;
        }

        public Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken)
        {
            if (ToggleError is not null)
            {
                throw ToggleError;
            }

            return Task.CompletedTask;
        }

        public Task DeleteAsync(long id, CancellationToken cancellationToken)
        {
            Deleted.Add(id);
            return Task.CompletedTask;
        }

        public Task BulkDeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken)
        {
            BulkDeleted = ids;
            return Task.CompletedTask;
        }
    }
}
