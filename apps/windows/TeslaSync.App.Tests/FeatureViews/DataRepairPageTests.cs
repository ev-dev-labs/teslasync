using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SystemOps;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DataRepairPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/DataRepairPage.tsx), the stat tiles / tab counts / subtitle / per-row header + inline
/// edit form, the tolerant parsers, the registration catalog and the view-model's four-state matrix (loading / empty /
/// error / success) plus its tab / expand / mutation flows. The WinUI view is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="DataRepairDisplay"/> flags asserted here.
/// </summary>
public sealed class DataRepairPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 14, 12, 0, 0, TimeSpan.Zero);

    // The 41 i18n keys the manifest requires the page to resolve (verbatim web keys).
    private static readonly string[] RequiredStringKeys =
    [
        "All sessions are complete", "Cancel", "Charger Power (kW)", "Charging Sessions", "Clean", "Close Drive",
        "Close Session", "Cost ($)", "Data Repair", "Discard", "Distance (m)", "Drive closed", "Drive discarded",
        "Drive updated", "Drives", "Duration (min)", "Duration (s)", "End Battery %", "End Date (ISO)",
        "Energy Added (kWh)", "Failed to close drive", "Failed to close session", "Failed to discard drive",
        "Failed to discard session", "Failed to update drive", "Failed to update session",
        "Fix incomplete or stale sessions", "Max Speed (m/s)", "Needs Repair", "Open", "Save", "Session closed",
        "Session discarded", "Session updated", "Stale Charging", "Stale Drives", "Status", "Total Stale", "Vehicle",
        "found", "incomplete session",
    ];

    private static StaleChargingSession Charging(long id, long vehicle = 7, string start = "2026-06-14T06:00:00Z", double battery = 42) =>
        new(id, vehicle, start, battery, null, 1234, 11000, 18, 4.2);

    private static StaleDrive Drive(long id, long vehicle = 9, string start = "2026-06-13T06:00:00Z", double? battery = 55) =>
        new(id, vehicle, start, battery, null, 1500, 600, 27.5);

    private static DataRepairModel Resolved(
        IReadOnlyList<StaleChargingSession>? charging = null,
        IReadOnlyList<StaleDrive>? drives = null,
        RepairTab tab = RepairTab.Charging,
        long? expandedId = null) =>
        DataRepairModel.Initial with
        {
            Loading = false,
            StaleCharging = charging ?? Array.Empty<StaleChargingSession>(),
            StaleDrives = drives ?? Array.Empty<StaleDrive>(),
            Tab = tab,
            ExpandedId = expandedId,
            Now = Now,
        };

    // ---- i18n key coverage (all 41 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = DataRepairProjection.Project(Resolved([Charging(1)]), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = DataRepairProjection.Project(DataRepairModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_on_first_paint()
    {
        var display = DataRepairProjection.Project(DataRepairModel.Initial, Localizer);

        Assert.Equal(DataRepairState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSuccess);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_records_in_tab()
    {
        var display = DataRepairProjection.Project(Resolved(), Localizer);

        Assert.Equal(DataRepairState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("All sessions are complete", display.EmptyTitle);
        Assert.Equal("No stale charging sessions found.", display.EmptyMessage);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = DataRepairModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = DataRepairProjection.Project(model, Localizer);

        Assert.Equal(DataRepairState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
    }

    [Fact]
    public void State_success_when_records_present()
    {
        var display = DataRepairProjection.Project(Resolved([Charging(1), Charging(2)]), Localizer);

        Assert.Equal(DataRepairState.Success, display.State);
        Assert.True(display.ShowSuccess);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Empty_message_follows_the_active_tab()
    {
        var display = DataRepairProjection.Project(Resolved(tab: RepairTab.Drives), Localizer);

        Assert.Equal(DataRepairState.Empty, display.State);
        Assert.Equal("No stale drives found.", display.EmptyMessage);
    }

    // ---- Stat tiles + subtitle -----------------------------------------------------

    [Fact]
    public void Stat_tiles_count_each_bucket_and_flag_needs_repair()
    {
        var display = DataRepairProjection.Project(
            Resolved([Charging(1), Charging(2)], [Drive(3)]), Localizer);

        Assert.Equal("3", display.TotalStale.Value);
        Assert.Equal("2", display.StaleCharging.Value);
        Assert.Equal("1", display.StaleDrives.Value);
        Assert.Equal("Needs Repair", display.StatusCard.Value);
        Assert.Equal(DataRepairRegistration.RedAccentKey, display.StatusCard.AccentBrushKey);
    }

    [Fact]
    public void Status_tile_is_clean_when_no_stale_records()
    {
        var display = DataRepairProjection.Project(Resolved(), Localizer);

        Assert.Equal("Clean", display.StatusCard.Value);
        Assert.Equal(DataRepairRegistration.GreenAccentKey, display.StatusCard.AccentBrushKey);
        Assert.Equal("0", display.TotalStale.Value);
    }

    [Theory]
    [InlineData(0, "Fix incomplete or stale sessions")]
    [InlineData(1, "1 incomplete session found")]
    [InlineData(3, "3 incomplete sessions found")]
    public void Subtitle_pluralizes_like_web(int chargingCount, string expected)
    {
        var charging = Enumerable.Range(1, chargingCount).Select(i => Charging(i)).ToList();
        var display = DataRepairProjection.Project(Resolved(charging), Localizer);

        Assert.Equal(expected, display.Subtitle);
    }

    // ---- Tabs ----------------------------------------------------------------------

    [Fact]
    public void Tabs_carry_counts_and_selection()
    {
        var display = DataRepairProjection.Project(
            Resolved([Charging(1)], [Drive(2), Drive(3)]), Localizer);

        Assert.Equal("Charging Sessions", display.ChargingTabLabel);
        Assert.Equal(1, display.ChargingCount);
        Assert.True(display.ChargingSelected);
        Assert.Equal("Drives", display.DrivesTabLabel);
        Assert.Equal(2, display.DrivesCount);
        Assert.False(display.DrivesSelected);
        Assert.True(display.IsChargingTab);
    }

    // ---- Rows + inline edit forms --------------------------------------------------

    [Fact]
    public void Charging_row_header_is_formatted()
    {
        var display = DataRepairProjection.Project(Resolved([Charging(7)]), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.Equal("#7", row.IdLabel);
        Assert.Equal("42%", row.BatteryLabel);
        Assert.Equal("Vehicle 7", row.VehicleLabel);
        Assert.Equal("6h", row.HoursOpenLabel);
        Assert.Null(row.ChargingForm);
        Assert.Null(row.DriveForm);
    }

    [Fact]
    public void Expanded_charging_row_carries_the_prefilled_form()
    {
        var model = Resolved([Charging(7)], expandedId: 7) with
        {
            ChargingForm = ChargingFormState.FromSession(Charging(7)),
        };
        var display = DataRepairProjection.Project(model, Localizer);

        var row = Assert.Single(display.Rows);
        Assert.True(row.Expanded);
        Assert.NotNull(row.ChargingForm);
        Assert.Equal("11000", row.ChargingForm!.PeakPowerW);
        Assert.Equal("18", row.ChargingForm.DurationMin);
        Assert.Equal(string.Empty, row.ChargingForm.EndTs);
    }

    [Fact]
    public void Expanded_drive_row_carries_the_prefilled_form()
    {
        var model = Resolved(drives: [Drive(5)], tab: RepairTab.Drives, expandedId: 5) with
        {
            DriveForm = DriveFormState.FromDrive(Drive(5)),
        };
        var display = DataRepairProjection.Project(model, Localizer);

        var row = Assert.Single(display.Rows);
        Assert.True(row.Expanded);
        Assert.NotNull(row.DriveForm);
        Assert.Equal("1500", row.DriveForm!.DistanceM);
        Assert.Equal("600", row.DriveForm.DurationS);
        Assert.Equal("27.5", row.DriveForm.MaxSpeedMps);
    }

    [Fact]
    public void Drive_row_battery_shows_dash_when_absent()
    {
        var display = DataRepairProjection.Project(
            Resolved(drives: [Drive(5, battery: null)], tab: RepairTab.Drives), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.Equal("\u2014", row.BatteryLabel);
    }

    [Fact]
    public void Form_labels_match_the_web_verbatim()
    {
        var labels = DataRepairProjection.Project(Resolved([Charging(1)]), Localizer).FormLabels;

        Assert.Equal("End Date (ISO)", labels.EndDateIso);
        Assert.Equal("Energy Added (kWh)", labels.EnergyAddedKwh);
        Assert.Equal("Charger Power (kW)", labels.ChargerPowerKw);
        Assert.Equal("Duration (min)", labels.DurationMin);
        Assert.Equal("Cost ($)", labels.CostDollar);
        Assert.Equal("Distance (m)", labels.DistanceM);
        Assert.Equal("Duration (s)", labels.DurationS);
        Assert.Equal("Max Speed (m/s)", labels.MaxSpeedMps);
        Assert.Equal("Close Session", labels.CloseSession);
        Assert.Equal("Close Drive", labels.CloseDrive);
    }

    // ---- Tolerant parser -----------------------------------------------------------

    [Fact]
    public void Snapshot_parses_both_buckets()
    {
        const string json = """
        {"stale_charging":[{"id":1,"vehicle_id":7,"start_ts":"2026-06-14T06:00:00Z","start_battery_pct":40,"peak_power_w":11000}],
         "stale_drives":[{"id":2,"vehicle_id":9,"distance_m":1500,"max_speed_mps":27.5}]}
        """;
        using var doc = System.Text.Json.JsonDocument.Parse(json);

        var snapshot = StaleSessionsSnapshot.FromJson(doc.RootElement);

        Assert.Single(snapshot.StaleCharging);
        Assert.Equal(11000, snapshot.StaleCharging[0].PeakPowerW);
        Assert.Single(snapshot.StaleDrives);
        Assert.Equal(27.5, snapshot.StaleDrives[0].MaxSpeedMps);
    }

    [Fact]
    public void Snapshot_unwraps_the_data_envelope_and_tolerates_missing_fields()
    {
        const string json = """{"data":{"stale_charging":[{"id":3}]}}""";
        using var doc = System.Text.Json.JsonDocument.Parse(json);

        var snapshot = StaleSessionsSnapshot.FromJson(doc.RootElement);

        Assert.Single(snapshot.StaleCharging);
        Assert.Equal(3, snapshot.StaleCharging[0].Id);
        Assert.Null(snapshot.StaleCharging[0].PeakPowerW);
        Assert.Empty(snapshot.StaleDrives);
    }

    // ---- Registration catalog ------------------------------------------------------

    [Fact]
    public void Registration_pins_the_web_route_and_operations()
    {
        Assert.Equal("DataRepair", DataRepairRegistration.RouteName);
        Assert.Equal("DataRepairPage", DataRepairRegistration.Slug);
        Assert.Equal("/data-repair", DataRepairRegistration.WebRoute);
        Assert.Equal("get_api_v1_data_repair_stale_sessions", DataRepairRegistration.StaleSessionsOperation);
        Assert.Equal("put_api_v1_data_repair_charging_id", DataRepairRegistration.ChargingUpdateOperation);
        Assert.Equal("post_api_v1_data_repair_charging_id_close", DataRepairRegistration.ChargingCloseOperation);
        Assert.Equal("delete_api_v1_data_repair_charging_id", DataRepairRegistration.ChargingDiscardOperation);
        Assert.Equal("put_api_v1_data_repair_drive_id", DataRepairRegistration.DriveUpdateOperation);
        Assert.Equal("post_api_v1_data_repair_drive_id_close", DataRepairRegistration.DriveCloseOperation);
        Assert.Equal("delete_api_v1_data_repair_drive_id", DataRepairRegistration.DriveDiscardOperation);
    }

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData(42.0, "42%")]
    [InlineData(55.5, "55.5%")]
    public void Percent_matches_web(double? value, string expected) =>
        Assert.Equal(expected, DataRepairRegistration.Percent(value));

    [Fact]
    public void HoursOpen_formats_under_and_over_a_day()
    {
        Assert.Equal("6h", DataRepairRegistration.HoursOpen("2026-06-14T06:00:00Z", Now));
        Assert.Equal("1d 12h", DataRepairRegistration.HoursOpen("2026-06-13T00:00:00Z", Now));
        Assert.Equal("0h", DataRepairRegistration.HoursOpen(null, Now));
    }

    // ---- View-model: load / tab / expand / mutate ----------------------------------

    [Fact]
    public async Task ViewModel_load_success_renders_rows()
    {
        var feed = new FakeDataRepairFeed { Snapshot = new StaleSessionsSnapshot([Charging(1)], [Drive(2)]) };
        using var vm = new DataRepairPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataRepairState.Success, vm.State);
        Assert.Single(vm.Display.Rows);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_load_error_sets_error_state()
    {
        var feed = new FakeDataRepairFeed { ThrowOnFetch = true };
        using var vm = new DataRepairPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataRepairState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_select_tab_switches_and_collapses()
    {
        var feed = new FakeDataRepairFeed { Snapshot = new StaleSessionsSnapshot([Charging(1)], [Drive(2)]) };
        using var vm = new DataRepairPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.ToggleExpanded(1);
        Assert.NotNull(vm.Display.Rows[0].ChargingForm);

        vm.SelectTab(RepairTab.Drives);

        Assert.False(vm.Display.IsChargingTab);
        Assert.Single(vm.Display.Rows);
        Assert.False(vm.Display.Rows[0].Expanded);
    }

    [Fact]
    public async Task ViewModel_toggle_expands_and_prefills_form()
    {
        var feed = new FakeDataRepairFeed { Snapshot = new StaleSessionsSnapshot([Charging(1)], Array.Empty<StaleDrive>()) };
        using var vm = new DataRepairPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.ToggleExpanded(1);

        Assert.True(vm.Display.Rows[0].Expanded);
        Assert.Equal("11000", vm.Display.Rows[0].ChargingForm!.PeakPowerW);

        vm.ToggleExpanded(1);
        Assert.False(vm.Display.Rows[0].Expanded);
    }

    [Fact]
    public async Task ViewModel_update_charging_sends_only_edited_fields_and_reloads()
    {
        var feed = new FakeDataRepairFeed { Snapshot = new StaleSessionsSnapshot([Charging(1)], Array.Empty<StaleDrive>()) };
        DataRepairToast? toast = null;
        using var vm = new DataRepairPageViewModel(feed, Localizer, () => Now);
        vm.ToastRequested += (_, t) => toast = t;
        await vm.LoadAsync();
        vm.ToggleExpanded(1);

        vm.SetChargingCost("9.50");
        vm.SetChargingEndTs("2026-06-14T08:00:00Z");
        await vm.UpdateChargingAsync(1);

        var payload = Assert.Single(feed.ChargingUpdates);
        Assert.Equal("2026-06-14T08:00:00Z", payload.EndTs);
        Assert.Equal(9.5, payload.Cost);
        Assert.NotNull(toast);
        Assert.False(toast!.IsError);
        Assert.Equal("Session updated", toast.Message);
        Assert.False(vm.Display.Rows[0].Expanded);
    }

    [Fact]
    public async Task ViewModel_discard_drive_calls_feed_and_toasts()
    {
        var feed = new FakeDataRepairFeed { Snapshot = new StaleSessionsSnapshot(Array.Empty<StaleChargingSession>(), [Drive(4)]) };
        DataRepairToast? toast = null;
        using var vm = new DataRepairPageViewModel(feed, Localizer, () => Now);
        vm.ToastRequested += (_, t) => toast = t;
        await vm.LoadAsync();
        vm.SelectTab(RepairTab.Drives);

        await vm.DiscardDriveAsync(4);

        Assert.Contains("drive.discard.4", feed.Calls);
        Assert.Equal("Drive discarded", toast!.Message);
    }

    [Fact]
    public async Task ViewModel_mutation_failure_raises_error_toast_and_keeps_row()
    {
        var feed = new FakeDataRepairFeed
        {
            Snapshot = new StaleSessionsSnapshot([Charging(1)], Array.Empty<StaleDrive>()),
            ThrowOnMutation = true,
        };
        DataRepairToast? toast = null;
        using var vm = new DataRepairPageViewModel(feed, Localizer, () => Now);
        vm.ToastRequested += (_, t) => toast = t;
        await vm.LoadAsync();
        vm.ToggleExpanded(1);

        await vm.CloseChargingAsync(1);

        Assert.NotNull(toast);
        Assert.True(toast!.IsError);
        Assert.Equal("Failed to close session", toast.Message);
        Assert.True(vm.Display.Rows[0].Expanded);
    }

    // ---- Test doubles --------------------------------------------------------------

    private sealed class FakeDataRepairFeed : IDataRepairFeed
    {
        public StaleSessionsSnapshot Snapshot { get; set; } = StaleSessionsSnapshot.Empty;

        public bool ThrowOnFetch { get; set; }

        public bool ThrowOnMutation { get; set; }

        public List<string> Calls { get; } = new();

        public List<ChargingRepairPayload> ChargingUpdates { get; } = new();

        public List<DriveRepairPayload> DriveUpdates { get; } = new();

        public Task<StaleSessionsSnapshot> FetchStaleAsync(CancellationToken cancellationToken) =>
            ThrowOnFetch
                ? Task.FromException<StaleSessionsSnapshot>(new InvalidOperationException("boom"))
                : Task.FromResult(Snapshot);

        public Task UpdateChargingAsync(long id, ChargingRepairPayload payload, CancellationToken cancellationToken)
        {
            Calls.Add($"charging.update.{id}");
            ChargingUpdates.Add(payload);
            return Maybe();
        }

        public Task CloseChargingAsync(long id, CancellationToken cancellationToken)
        {
            Calls.Add($"charging.close.{id}");
            return Maybe();
        }

        public Task DiscardChargingAsync(long id, CancellationToken cancellationToken)
        {
            Calls.Add($"charging.discard.{id}");
            return Maybe();
        }

        public Task UpdateDriveAsync(long id, DriveRepairPayload payload, CancellationToken cancellationToken)
        {
            Calls.Add($"drive.update.{id}");
            DriveUpdates.Add(payload);
            return Maybe();
        }

        public Task CloseDriveAsync(long id, CancellationToken cancellationToken)
        {
            Calls.Add($"drive.close.{id}");
            return Maybe();
        }

        public Task DiscardDriveAsync(long id, CancellationToken cancellationToken)
        {
            Calls.Add($"drive.discard.{id}");
            return Maybe();
        }

        private Task Maybe() =>
            ThrowOnMutation ? Task.FromException(new InvalidOperationException("mutation boom")) : Task.CompletedTask;
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
