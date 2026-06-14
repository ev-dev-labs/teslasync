using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Telemetry;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SignalDiffPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/telemetry/pages/SignalDiffPage.tsx), the three mandated data-states across the
/// <c>useSignalDiffServer</c> source, the four diff stat-card values, the five panels, the 15 manifest i18n keys, the
/// view-model's vehicles + diff + pin + bulk + filter flows, and the generated-client feed's request shaping (the
/// vehicles / available / diff / pinned reads and the pin / unpin writes). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="SignalDiffPageDisplay"/> flags asserted here.
/// </summary>
public sealed class SignalDiffPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 17, 0, 0, TimeSpan.Zero);

    // The 15 i18n keys the manifest (page:telemetry/SignalDiff) requires the page to resolve.
    private static readonly string[] ManifestStringKeys =
    [
        "signalDiff.bulk.addAlert", "signalDiff.bulk.csv", "signalDiff.bulk.pin", "signalDiff.bulk.unpin",
        "signalDiff.error", "signalDiff.noChanges", "signalDiff.pinnedCount", "signalDiff.pinnedLabel",
        "signalDiff.share", "signalDiff.subtitle", "signalDiff.title", "signalDiff.totalChanged",
        "signalDiff.vehicle", "signalDiff.visible", "signalDiff.windowSpan",
    ];

    private static SignalDiffRow Diff(string name) => new(name, "1", "2", 1, 2, null, null, null, null, true);

    private static SignalDiffPageModel Model(
        long vehicleId = 7,
        IReadOnlyList<SignalDiffVehicle>? vehicles = null,
        SignalsWorkspaceDataState diff = SignalsWorkspaceDataState.Success,
        IReadOnlyList<SignalDiffRow>? diffRows = null,
        string search = "",
        string? category = null,
        IReadOnlySet<string>? pinned = null,
        IReadOnlyList<string>? selected = null,
        bool windows = true) =>
        new(
            vehicleId,
            vehicles ?? [new SignalDiffVehicle(7, "Car 7", "VIN7")],
            diff,
            diffRows ?? [],
            search,
            category,
            pinned ?? new HashSet<string>(),
            selected ?? [],
            windows ? Now.AddHours(-1) : null,
            windows ? Now : null);

    // ---- i18n key coverage (15 manifest strings) -----------------------------------

    [Fact]
    public void Projection_resolves_all_15_manifest_string_keys_in_one_pass()
    {
        var recorder = new RecordingLocalizer();

        _ = SignalDiffPageProjection.Project(Model(), recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Manifest_string_key_list_has_the_required_count()
    {
        Assert.Equal(15, ManifestStringKeys.Length);
        Assert.Equal(ManifestStringKeys.Length, ManifestStringKeys.Distinct().Count());
    }

    [Fact]
    public void Projection_resolves_all_keys_even_while_loading()
    {
        var recorder = new RecordingLocalizer();

        _ = SignalDiffPageProjection.Project(Model(diff: SignalsWorkspaceDataState.Loading), recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Page_title_and_subtitle_and_share_carry_their_copy()
    {
        var display = SignalDiffPageProjection.Project(Model(), Localizer);

        Assert.Equal("Signal Diff", display.Title);
        Assert.Equal("Compare signal values between two snapshots in time", display.Subtitle);
        Assert.Equal("Share", display.ShareLabel);
        Assert.Equal("Vehicle", display.VehicleLabel);
    }

    // ---- 5 panels: the 4 stat-card values + the GlassPanel5 diff region ---------------

    [Fact]
    public void Stat_cards_count_changed_visible_pinned_and_window_span()
    {
        var rows = new[] { Diff("speed"), Diff("soc"), Diff("power") };
        var display = SignalDiffPageProjection.Project(
            Model(diffRows: rows, search: "s", pinned: new HashSet<string> { "speed" }),
            Localizer);

        Assert.Equal("Changed signals", display.ChangedSignalsLabel);
        Assert.Equal("3", display.ChangedSignalsValue);
        Assert.Equal("Visible after filter", display.VisibleLabel);
        Assert.Equal("2", display.VisibleValue); // "s" matches speed + soc, not power
        Assert.Equal("Pinned", display.PinnedLabel);
        Assert.Equal("1", display.PinnedValue);
        Assert.Equal("Window span", display.WindowSpanLabel);
        Assert.Equal("3600 s", display.WindowSpanValue);
    }

    [Fact]
    public void Stat_cards_are_em_dash_while_the_diff_loads()
    {
        var display = SignalDiffPageProjection.Project(Model(diff: SignalsWorkspaceDataState.Loading), Localizer);

        Assert.Equal("\u2014", display.ChangedSignalsValue);
        Assert.Equal("\u2014", display.VisibleValue);
    }

    [Fact]
    public void Window_span_is_the_em_dash_when_a_window_is_unset()
    {
        var display = SignalDiffPageProjection.Project(Model(windows: false), Localizer);

        Assert.Equal("\u2014", display.WindowSpanValue);
    }

    [Fact]
    public void GlassPanel5_carries_the_diff_copy_and_bulk_labels()
    {
        var display = SignalDiffPageProjection.Project(Model(), Localizer);

        Assert.Equal("No signals changed between the two snapshots", display.NoChangesMessage);
        Assert.Equal("Failed to load diff", display.ErrorMessage);
        Assert.Equal("Pinned:", display.PinnedChipsLabel);
        Assert.NotNull(display.DiffDisplay);

        Assert.Equal("Pin selected", display.BulkPinLabel);
        Assert.Equal("Unpin selected", display.BulkUnpinLabel);
        Assert.Equal("Copy CSV", display.BulkCsvLabel);
        Assert.Equal("Add as alert rule", display.BulkAddAlertLabel);
    }

    // ---- 3 data states (loading / empty / success) + the error banner ----------------

    [Fact]
    public void State_loading_drives_the_skeleton()
    {
        var display = SignalDiffPageProjection.Project(Model(diff: SignalsWorkspaceDataState.Loading), Localizer);

        Assert.True(display.ShowDiffLoading);
        Assert.False(display.ShowDiffEmpty);
        Assert.False(display.ShowDiffRows);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_empty_shows_the_no_changes_panel_when_nothing_changed_and_no_filter()
    {
        var display = SignalDiffPageProjection.Project(
            Model(diff: SignalsWorkspaceDataState.Success, diffRows: []),
            Localizer);

        Assert.True(display.ShowDiffEmpty);
        Assert.False(display.ShowDiffLoading);
        Assert.False(display.ShowDiffRows);
    }

    [Fact]
    public void State_success_shows_the_rows_when_signals_changed()
    {
        var display = SignalDiffPageProjection.Project(
            Model(diff: SignalsWorkspaceDataState.Success, diffRows: [Diff("speed"), Diff("soc")]),
            Localizer);

        Assert.True(display.ShowDiffRows);
        Assert.False(display.ShowDiffEmpty);
        Assert.Equal(2, display.DiffDisplay.Rows.Count);
    }

    [Fact]
    public void State_error_surfaces_the_failed_to_load_banner()
    {
        var display = SignalDiffPageProjection.Project(Model(diff: SignalsWorkspaceDataState.Error), Localizer);

        Assert.True(display.ShowError);
        Assert.False(display.ShowDiffLoading);
        Assert.False(display.ShowDiffEmpty);
    }

    [Fact]
    public void Filtered_to_zero_rows_stays_in_the_rows_branch_not_the_no_changes_empty()
    {
        // web: filterActive suppresses the "no changes" empty so the table renders its own "no matches" copy.
        var display = SignalDiffPageProjection.Project(
            Model(diff: SignalsWorkspaceDataState.Success, diffRows: [Diff("speed")], search: "zzz"),
            Localizer);

        Assert.True(display.FilterActive);
        Assert.False(display.ShowDiffEmpty);
        Assert.True(display.ShowDiffRows);
        Assert.Empty(display.DiffDisplay.Rows);
    }

    // ---- Category + search filtering (web filteredRows) ------------------------------

    [Fact]
    public void Category_filter_narrows_the_visible_rows()
    {
        var rows = new[] { Diff("drive_speed"), Diff("battery_soc"), Diff("climate_temp") };
        var display = SignalDiffPageProjection.Project(
            Model(diffRows: rows, category: "drive"),
            Localizer);

        Assert.Equal("3", display.ChangedSignalsValue);
        Assert.Equal("1", display.VisibleValue); // only drive_speed matches the "drive" category
        Assert.True(display.FilterActive);
    }

    [Fact]
    public void Unknown_category_passes_every_row_through()
    {
        var rows = new[] { Diff("speed"), Diff("soc") };
        var result = SignalDiffPageProjection.FilterByCategory(rows, "not-a-category");

        Assert.Equal(2, result.Count);
    }

    // ---- Pinned chips + selection ----------------------------------------------------

    [Fact]
    public void Pinned_chips_are_sorted_and_shown_only_when_present()
    {
        var none = SignalDiffPageProjection.Project(Model(), Localizer);
        Assert.False(none.ShowPinnedChips);
        Assert.Empty(none.PinnedChips);

        var some = SignalDiffPageProjection.Project(
            Model(pinned: new HashSet<string> { "soc", "battery" }),
            Localizer);
        Assert.True(some.ShowPinnedChips);
        Assert.Equal(new[] { "battery", "soc" }, some.PinnedChips);
    }

    [Fact]
    public void Selected_count_flows_to_the_display()
    {
        var display = SignalDiffPageProjection.Project(Model(selected: ["a", "b", "c"]), Localizer);

        Assert.Equal(3, display.SelectedCount);
    }

    // ---- Vehicle picker --------------------------------------------------------------

    [Fact]
    public void Vehicle_options_use_display_name_then_vin_and_mark_the_selection()
    {
        var display = SignalDiffPageProjection.Project(
            Model(
                vehicleId: 9,
                vehicles:
                [
                    new SignalDiffVehicle(7, "Roadster", "VIN7"),
                    new SignalDiffVehicle(9, string.Empty, "VIN9"),
                ]),
            Localizer);

        Assert.Equal(2, display.VehicleOptions.Count);
        Assert.Equal("7", display.VehicleOptions[0].Value);
        Assert.Equal("Roadster", display.VehicleOptions[0].Label);
        Assert.Equal("VIN9", display.VehicleOptions[1].Label); // display_name blank -> VIN fallback
        Assert.Equal("9", display.SelectedVehicleValue);
    }

    [Fact]
    public void Selected_vehicle_value_is_blank_when_none_is_chosen()
    {
        var display = SignalDiffPageProjection.Project(Model(vehicleId: 0, vehicles: []), Localizer);

        Assert.Equal(string.Empty, display.SelectedVehicleValue);
    }

    // ---- SignalDiffVehicle.ParseList -------------------------------------------------

    [Fact]
    public void Vehicle_parse_reads_a_bare_array_and_an_envelope_and_the_label_fallback()
    {
        var bare = SignalDiffVehicle.ParseList(Json("[{\"id\":7,\"display_name\":\"A\",\"vin\":\"V7\"}]"));
        Assert.Equal(7, Assert.Single(bare).Id);
        Assert.Equal("A", bare[0].Label);

        var envelope = SignalDiffVehicle.ParseList(Json("{\"data\":[{\"id\":9,\"vin\":\"V9\"}]}"));
        Assert.Equal("V9", Assert.Single(envelope).Label); // no display_name -> VIN

        Assert.Empty(SignalDiffVehicle.ParseList(Json("\"oops\"")));
    }

    // ---- View-model state machine ----------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_vehicles_auto_picks_the_first_and_fetches_the_diff()
    {
        var feed = new FakeSignalDiffFeed
        {
            Vehicles = [new SignalDiffVehicle(7, "Car 7", "V7"), new SignalDiffVehicle(9, "Car 9", "V9")],
            Diff = [Diff("speed")],
        };
        using var vm = new SignalDiffPageViewModel(feed, Localizer, vehicleId: 0);

        await vm.LoadAsync();

        Assert.Equal(7, vm.VehicleId);
        Assert.Equal(1, feed.VehiclesCount);
        Assert.Equal(1, feed.DiffCount);
        Assert.True(vm.Display.ShowDiffRows);
        Assert.Single(vm.Display.DiffDisplay.Rows);
    }

    [Fact]
    public async Task ViewModel_no_vehicles_skips_the_diff_fetch()
    {
        var feed = new FakeSignalDiffFeed { Vehicles = [] };
        using var vm = new SignalDiffPageViewModel(feed, Localizer, vehicleId: 0);

        await vm.LoadAsync();

        Assert.Equal(0, vm.VehicleId);
        Assert.Equal(0, feed.DiffCount);
    }

    [Fact]
    public async Task ViewModel_diff_failure_is_the_error_state()
    {
        var feed = new FakeSignalDiffFeed { Vehicles = [new SignalDiffVehicle(7, "Car", "V")], DiffThrows = true };
        using var vm = new SignalDiffPageViewModel(feed, Localizer, vehicleId: 7);

        await vm.LoadAsync();

        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_toggle_pin_calls_the_feed_and_reloads_pins()
    {
        var feed = new FakeSignalDiffFeed { Vehicles = [new SignalDiffVehicle(7, "Car", "V")], Diff = [Diff("speed")] };
        using var vm = new SignalDiffPageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();

        await vm.TogglePinAsync("speed", pin: true);

        Assert.Equal(1, feed.PinCount);
        Assert.Equal("signal:speed", feed.LastPinItemId);
        Assert.Equal(2, feed.PinnedCount); // initial load + reload after the pin
    }

    [Fact]
    public async Task ViewModel_unpin_deletes_by_the_existing_pin_id()
    {
        var feed = new FakeSignalDiffFeed
        {
            Vehicles = [new SignalDiffVehicle(7, "Car", "V")],
            Pinned = [new PinnedSignal("42", "speed")],
        };
        using var vm = new SignalDiffPageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();

        await vm.TogglePinAsync("speed", pin: false);

        Assert.Equal(1, feed.UnpinCount);
        Assert.Equal("42", feed.LastUnpinId);
    }

    [Fact]
    public async Task ViewModel_bulk_pin_pins_every_selected_signal_once()
    {
        var feed = new FakeSignalDiffFeed
        {
            Vehicles = [new SignalDiffVehicle(7, "Car", "V")],
            Diff = [Diff("speed"), Diff("soc")],
        };
        using var vm = new SignalDiffPageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();
        vm.SetSelection(["speed", "soc"]);

        await vm.BulkTogglePinAsync(pin: true);

        Assert.Equal(2, feed.PinCount);
    }

    [Fact]
    public async Task ViewModel_set_vehicle_reloads_the_diff_for_the_new_car()
    {
        var feed = new FakeSignalDiffFeed
        {
            Vehicles = [new SignalDiffVehicle(7, "Car 7", "V7"), new SignalDiffVehicle(9, "Car 9", "V9")],
            Diff = [Diff("speed")],
        };
        using var vm = new SignalDiffPageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();
        int before = feed.DiffCount;

        await vm.SetVehicleAsync(9);

        Assert.Equal(9, vm.VehicleId);
        Assert.Equal(before + 1, feed.DiffCount);
    }

    [Fact]
    public async Task ViewModel_search_reprojects_the_visible_count_without_refetching()
    {
        var feed = new FakeSignalDiffFeed
        {
            Vehicles = [new SignalDiffVehicle(7, "Car", "V")],
            Diff = [Diff("speed"), Diff("soc"), Diff("power")],
        };
        using var vm = new SignalDiffPageViewModel(feed, Localizer, vehicleId: 7);
        await vm.LoadAsync();
        int diffCalls = feed.DiffCount;

        vm.SetSearch("po");

        Assert.Equal("3", vm.Display.ChangedSignalsValue);
        Assert.Equal("1", vm.Display.VisibleValue); // only "power" contains "po"
        Assert.Equal(diffCalls, feed.DiffCount); // pure client-side re-projection
    }

    // ---- Generated-client feed (web hooks) -------------------------------------------

    [Fact]
    public async Task ClientFeed_vehicles_sends_the_op_and_parses_the_list()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":7,\"display_name\":\"Car\",\"vin\":\"V7\"}]"));
        var feed = new SignalDiffPageClientFeed(api);

        var result = await feed.FetchVehiclesAsync(default);

        Assert.Equal(7, Assert.Single(result).Id);
        Assert.Equal("get_api_v1_vehicles", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_available_sends_the_op_and_parses_strings_and_objects()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"signals\":[\"speed\",{\"name\":\"soc\"},{\"nope\":1}]}"));
        var feed = new SignalDiffPageClientFeed(api);

        var result = await feed.FetchAvailableAsync(7, default);

        Assert.Equal(new[] { "speed", "soc" }, result);
        Assert.Equal("get_api_v1_signals_vehicleID_available", Assert.Single(api.Requests).OperationId);
        Assert.Equal("7", Assert.Single(api.Requests).PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task ClientFeed_diff_sends_the_op_and_parses_rows()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"data\":[{\"name\":\"speed\",\"value_a\":1,\"value_b\":2,\"changed\":true}]}"));
        var feed = new SignalDiffPageClientFeed(api);

        var result = await feed.FetchDiffAsync(7, default);

        Assert.Equal("speed", Assert.Single(result).Name);
        Assert.Equal("get_api_v1_signals_vehicleID_diff", Assert.Single(api.Requests).OperationId);
        Assert.Equal("7", Assert.Single(api.Requests).PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task ClientFeed_pinned_sends_the_op_and_keeps_only_signal_rows()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":3,\"item_id\":\"signal:speed\"},{\"id\":4,\"item_id\":\"widget:foo\"}]"));
        var feed = new SignalDiffPageClientFeed(api);

        var result = await feed.FetchPinnedAsync(7, default);

        var pin = Assert.Single(result);
        Assert.Equal("3", pin.Id);
        Assert.Equal("speed", pin.Name);
        Assert.Equal("get_api_v1_pinned", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task ClientFeed_pin_posts_the_item_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new SignalDiffPageClientFeed(api);

        await feed.PinAsync("signal:speed", "signal-diff:vehicle:7", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_pinned", request.OperationId);
        var body = Assert.IsType<Dictionary<string, object?>>(request.Body);
        Assert.Equal("signal:speed", body["item_id"]);
        Assert.Equal("widget", body["item_type"]);
        Assert.Equal("signal-diff:vehicle:7", body["context"]);
    }

    [Fact]
    public async Task ClientFeed_unpin_deletes_by_id_path_parameter()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new SignalDiffPageClientFeed(api);

        await feed.UnpinAsync("9", default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("delete_api_v1_pinned_id", request.OperationId);
        Assert.Equal("9", request.PathParams!["id"]);
    }

    // ---- Registration + diagnostics --------------------------------------------------

    [Fact]
    public void Registration_exposes_route_slug_and_operations()
    {
        Assert.Equal("SignalDiff", SignalDiffPageRegistration.RouteName);
        Assert.Equal("SignalDiffPage", SignalDiffPageRegistration.Slug);
        Assert.Equal("get_api_v1_vehicles", SignalDiffPageRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_signals_vehicleID_available", SignalDiffPageRegistration.AvailableOperation);
        Assert.Equal("get_api_v1_signals_vehicleID_diff", SignalDiffPageRegistration.DiffOperation);
        Assert.Equal("get_api_v1_pinned", SignalDiffPageRegistration.PinnedListOperation);
        Assert.Equal("post_api_v1_pinned", SignalDiffPageRegistration.PinCreateOperation);
        Assert.Equal("delete_api_v1_pinned_id", SignalDiffPageRegistration.PinDeleteOperation);
        Assert.Equal("signal-diff:vehicle:7", SignalDiffPageRegistration.PinContext(7));
    }

    [Fact]
    public void Every_registered_operation_resolves_against_the_generated_table()
    {
        var api = new FakeApiClient();
        foreach (var op in new[]
        {
            SignalDiffPageRegistration.VehiclesOperation,
            SignalDiffPageRegistration.AvailableOperation,
            SignalDiffPageRegistration.DiffOperation,
            SignalDiffPageRegistration.PinnedListOperation,
            SignalDiffPageRegistration.PinCreateOperation,
            SignalDiffPageRegistration.PinDeleteOperation,
        })
        {
            Assert.Equal(op, api.ResolveEndpoint(op).OperationId);
        }
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SignalDiffPageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("SignalDiffPage:view.opened", Assert.Single(lines));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
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

    private sealed class FakeSignalDiffFeed : ISignalDiffPageFeed
    {
        public IReadOnlyList<SignalDiffVehicle> Vehicles { get; set; } = [];

        public IReadOnlyList<string> Available { get; set; } = [];

        public IReadOnlyList<SignalDiffRow> Diff { get; set; } = [];

        public IReadOnlyList<PinnedSignal> Pinned { get; set; } = [];

        public bool DiffThrows { get; set; }

        public int VehiclesCount { get; private set; }

        public int AvailableCount { get; private set; }

        public int DiffCount { get; private set; }

        public int PinnedCount { get; private set; }

        public int PinCount { get; private set; }

        public int UnpinCount { get; private set; }

        public string? LastPinItemId { get; private set; }

        public string? LastUnpinId { get; private set; }

        public Task<IReadOnlyList<SignalDiffVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehiclesCount++;
            return Task.FromResult(Vehicles);
        }

        public Task<IReadOnlyList<string>> FetchAvailableAsync(long vehicleId, CancellationToken cancellationToken)
        {
            AvailableCount++;
            return Task.FromResult(Available);
        }

        public Task<IReadOnlyList<SignalDiffRow>> FetchDiffAsync(long vehicleId, CancellationToken cancellationToken)
        {
            DiffCount++;
            if (DiffThrows)
            {
                throw new InvalidOperationException("boom");
            }

            return Task.FromResult(Diff);
        }

        public Task<IReadOnlyList<PinnedSignal>> FetchPinnedAsync(long vehicleId, CancellationToken cancellationToken)
        {
            PinnedCount++;
            return Task.FromResult(Pinned);
        }

        public Task PinAsync(string itemId, string context, CancellationToken cancellationToken)
        {
            PinCount++;
            LastPinItemId = itemId;
            return Task.CompletedTask;
        }

        public Task UnpinAsync(string existingId, CancellationToken cancellationToken)
        {
            UnpinCount++;
            LastUnpinId = existingId;
            return Task.CompletedTask;
        }
    }
}
