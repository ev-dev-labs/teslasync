using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SystemOps;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DataExportPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/DataExportPage.tsx), the stat-tile / wizard / column-picker / history / overview /
/// account sub-displays, the tolerant parsers, the registration catalog and the view-model's four-state matrix
/// (loading / empty / error / success) plus its submit / account / column mutators. The WinUI view is exercised by the
/// app build; its per-region visibility is driven entirely by the <see cref="DataExportDisplay"/> flags asserted here.
/// </summary>
public sealed class DataExportPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 59 i18n keys the manifest requires the page to resolve (22 bare + 37 dataExport.*).
    private static readonly string[] RequiredStringKeys =
    [
        "All Vehicles", "By Count", "Download", "Duration", "End", "Export Failed", "Export Failed Msg",
        "Export Started", "Export Started Msg", "Format", "Last Export", "Most Exported", "Records", "Size",
        "Start", "Start Export", "Status", "Time", "Total Exports", "Total Size", "Type", "Vehicle",
        "dataExport.account.allVehicles", "dataExport.account.endDate", "dataExport.account.start",
        "dataExport.account.startDate", "dataExport.account.subtitle", "dataExport.account.title",
        "dataExport.account.vehicle", "dataExport.account.warning", "dataExport.active", "dataExport.allVehicles",
        "dataExport.chargingSessions", "dataExport.columns.alwaysIncluded", "dataExport.columns.clear",
        "dataExport.columns.helperText", "dataExport.columns.selectAll", "dataExport.columns.title",
        "dataExport.csvDesc", "dataExport.csvPreview", "dataExport.customRange", "dataExport.dataOverview",
        "dataExport.drives", "dataExport.exportHistory", "dataExport.jsonDesc", "dataExport.jsonPreview",
        "dataExport.noExports", "dataExport.noExportsMessage", "dataExport.noJobs", "dataExport.refresh",
        "dataExport.scheduled.feature", "dataExport.subtitle", "dataExport.title", "dataExport.unavailable",
        "dataExport.wizard.step1", "dataExport.wizard.step2", "dataExport.wizard.step3", "dataExport.wizard.step4",
        "dataExport.wizardTitle",
    ];

    private static ExportJobSummary Job(
        string id,
        string type,
        string status,
        long? size = null,
        long? records = null,
        string created = "2026-06-12T10:00:00Z",
        long? duration = null,
        long? vehicleId = null,
        string? error = null) =>
        new(id, type, "csv", status, vehicleId, records, size, duration, error, created);

    private static DataExportModel RichModel() => DataExportModel.Initial with
    {
        JobsLoading = false,
        VehiclesLoading = false,
        Jobs =
        [
            Job("a", "drives", "ready", size: 2048, records: 120, created: "2026-06-12T11:30:00Z", duration: 4200, vehicleId: 7),
            Job("b", "drives", "processing", records: 30, created: "2026-06-12T09:00:00Z"),
            Job("c", "charging", "failed", created: "2026-06-11T09:00:00Z", error: "boom"),
        ],
        Vehicles = [new VehicleSummary(7, "Model 3", "VIN7"), new VehicleSummary(9, null, "VIN9")],
        Now = Now,
    };

    // ---- i18n key coverage (all 59 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = DataExportProjection.Project(RichModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = DataExportProjection.Project(DataExportModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_jobs_in_flight()
    {
        var display = DataExportProjection.Project(DataExportModel.Initial, Localizer);

        Assert.Equal(DataExportState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowSuccess);
        Assert.True(display.StatsLoading);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_jobs()
    {
        var model = DataExportModel.Initial with { JobsLoading = false, VehiclesLoading = false };
        var display = DataExportProjection.Project(model, Localizer);

        Assert.Equal(DataExportState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.True(display.History.ShowEmpty);
        Assert.Equal("No Exports Yet", display.History.EmptyTitle);
    }

    [Fact]
    public void State_error_when_jobs_failed()
    {
        var model = DataExportModel.Initial with { JobsLoading = false, HasError = true, ErrorDetail = "network down" };
        var display = DataExportProjection.Project(model, Localizer);

        Assert.Equal(DataExportState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
    }

    [Fact]
    public void State_success_when_jobs_present()
    {
        var display = DataExportProjection.Project(RichModel(), Localizer);

        Assert.Equal(DataExportState.Success, display.State);
        Assert.True(display.ShowSuccess);
        Assert.False(display.History.ShowEmpty);
        Assert.Equal(3, display.History.Rows.Count);
    }

    // ---- Panels: stat tiles (Total-Exports / Total-Size / Most-Exported / Last-Export) ----

    [Fact]
    public void StatTiles_format_values_like_the_web_helpers()
    {
        var display = DataExportProjection.Project(RichModel(), Localizer);

        Assert.Equal(4, display.StatTiles.Count);
        Assert.Equal("Total-Exports", display.StatTiles[0].Key);
        Assert.Equal("3", display.StatTiles[0].Value);
        Assert.Equal("Total-Size", display.StatTiles[1].Key);
        Assert.Equal("2.0 KB", display.StatTiles[1].Value); // 2048 bytes
        Assert.Equal("Most-Exported", display.StatTiles[2].Key);
        Assert.Equal("drives", display.StatTiles[2].Value); // 2 drives > 1 charging
        Assert.Equal("By Count", display.StatTiles[2].Sublabel);
        Assert.Equal("Last-Export", display.StatTiles[3].Key);
        Assert.NotEqual(DataExportProjection.EmDash, display.StatTiles[3].Value); // newest job is relative
    }

    [Fact]
    public void StatTiles_render_em_dash_when_no_jobs()
    {
        var model = DataExportModel.Initial with { JobsLoading = false };
        var display = DataExportProjection.Project(model, Localizer);

        Assert.Equal("0", display.StatTiles[0].Value);
        Assert.Equal(string.Empty, display.StatTiles[1].Value); // zeroAsEmpty
        Assert.Equal(DataExportProjection.EmDash, display.StatTiles[2].Value);
        Assert.Equal(DataExportProjection.EmDash, display.StatTiles[3].Value);
    }

    [Fact]
    public void Most_exported_underscore_token_is_spaced_like_web()
    {
        var model = DataExportModel.Initial with
        {
            JobsLoading = false,
            Jobs = [Job("a", "full_backup", "ready"), Job("b", "full_backup", "ready"), Job("c", "drives", "ready")],
            Now = Now,
        };
        var display = DataExportProjection.Project(model, Localizer);

        Assert.Equal("full backup", display.StatTiles[2].Value);
    }

    // ---- Panel: export wizard (GlassPanel9 / GlassPanel1) ---------------------------

    [Fact]
    public void Wizard_type_tiles_cover_the_seven_web_types_with_selection()
    {
        var display = DataExportProjection.Project(RichModel(), Localizer);
        var wizard = display.Wizard;

        Assert.Equal(7, wizard.Types.Count);
        Assert.Equal(["drives", "charging", "trips", "analytics", "full_backup", "maintenance", "energy"],
            wizard.Types.Select(t => t.Value).ToArray());
        Assert.True(wizard.Types[0].Selected);              // default type = drives
        Assert.All(wizard.Types.Skip(1), t => Assert.False(t.Selected));
    }

    [Fact]
    public void Wizard_format_options_reflect_selection()
    {
        var display = DataExportProjection.Project(RichModel(), Localizer);

        Assert.Equal(["csv", "json"], display.Wizard.Formats.Select(f => f.Value).ToArray());
        Assert.True(display.Wizard.Formats[0].Selected);    // default format = csv
        Assert.False(display.Wizard.Formats[1].Selected);
    }

    [Fact]
    public void Wizard_presets_default_to_last_30_days()
    {
        var display = DataExportProjection.Project(RichModel(), Localizer);
        var presets = display.Wizard.Presets;

        Assert.Equal(5, presets.Count);
        Assert.Equal([7, 30, 90, 365, 0], presets.Select(p => p.Days).ToArray());
        Assert.True(presets.Single(p => p.Days == 30).Selected);
    }

    [Fact]
    public void Wizard_column_picker_shows_for_a_selectable_catalog()
    {
        var catalog = new ExportColumnsCatalog("drives", true,
        [
            new ExportColumnInfo("id", "ID", true),
            new ExportColumnInfo("distance_m", "Distance", false),
        ]);
        var model = RichModel() with { Columns = new ColumnCatalogState("drives", false, false, catalog) };
        var display = DataExportProjection.Project(model, Localizer);

        Assert.True(display.Wizard.ShowColumnPicker);
        Assert.False(display.Wizard.ColumnsLoading);
        Assert.Equal(2, display.Wizard.ColumnRows.Count);
        Assert.True(display.Wizard.ColumnRows.Single(c => c.Name == "id").Required);
        Assert.True(display.Wizard.ColumnsAllSelected); // untouched selection = all
    }

    [Fact]
    public void Wizard_column_picker_hidden_for_types_without_a_catalog()
    {
        var model = RichModel() with { Wizard = WizardSelection.Default with { Type = "analytics" } };
        var display = DataExportProjection.Project(model, Localizer);

        Assert.False(display.Wizard.ShowColumnPicker);
        Assert.Empty(display.Wizard.ColumnRows);
    }

    [Fact]
    public void Wizard_vehicle_step_hidden_when_no_vehicles()
    {
        var model = DataExportModel.Initial with { JobsLoading = false, Vehicles = Array.Empty<VehicleSummary>() };
        var display = DataExportProjection.Project(model, Localizer);

        Assert.False(display.Wizard.ShowVehicleStep);
        Assert.Single(display.Wizard.VehicleOptions); // only the "All Vehicles" head
    }

    // ---- Panel: account export (GlassPanel12) --------------------------------------

    [Fact]
    public void Account_vehicle_options_lead_with_all_vehicles()
    {
        var display = DataExportProjection.Project(RichModel(), Localizer);
        var options = display.Account.VehicleOptions;

        Assert.Equal("all", options[0].Value);
        Assert.Equal("All vehicles", options[0].Label);
        Assert.Equal("7", options[1].Value);
        Assert.Equal("Model 3", options[1].Label);
        Assert.Equal("VIN9", options[2].Label); // display_name falls back to vin
    }

    // ---- Panels: format-preview cards (GlassPanel2 / GlassPanel3) -------------------

    [Fact]
    public void Format_info_cards_carry_titles_and_sample_lines()
    {
        var display = DataExportProjection.Project(RichModel(), Localizer);

        Assert.Equal("CSV Preview", display.CsvCard.Title);
        Assert.Equal(GlassGlowKind.Cyan, display.CsvCard.Glow);
        Assert.Equal(3, display.CsvCard.SampleLines.Count);
        Assert.Equal("JSON Preview", display.JsonCard.Title);
        Assert.Equal(GlassGlowKind.Purple, display.JsonCard.Glow);
        Assert.Equal(3, display.JsonCard.SampleLines.Count);
    }

    // ---- Panel: data overview (GlassPanel4) ----------------------------------------

    [Fact]
    public void Overview_sums_record_counts_per_type()
    {
        var display = DataExportProjection.Project(RichModel(), Localizer);

        Assert.False(display.Overview.Loading);
        Assert.True(display.Overview.HasData);
        Assert.Equal("150", display.Overview.DrivesValue);  // 120 + 30
        Assert.Equal("0", display.Overview.ChargingValue);
    }

    // ---- Panel: export history (GlassPanel10 / GlassPanel11) ------------------------

    [Fact]
    public void History_projects_rows_badges_and_download_affordance()
    {
        var display = DataExportProjection.Project(RichModel(), Localizer);
        var history = display.History;

        Assert.Equal(8, history.ColumnHeaders.Count);
        Assert.Equal(["Type", "Format", "Status", "Vehicle", "Records", "Size", "Duration", "Time"],
            history.ColumnHeaders.ToArray());
        Assert.True(history.ShowActiveBadge);       // one processing job
        Assert.Equal(1, history.ActiveCount);

        var ready = history.Rows.Single(r => r.Id == "a");
        Assert.Equal(StatusKind.Success, ready.StatusBadge);
        Assert.Equal("Model 3", ready.Vehicle);
        Assert.Equal("120", ready.Records);
        Assert.Equal("2.0 KB", ready.Size);
        Assert.Equal("4.2s", ready.Duration);       // 4200ms
        Assert.True(ready.CanDownload);
        Assert.Equal("/api/v1/export/jobs/a/download", ready.DownloadPath);

        var failed = history.Rows.Single(r => r.Id == "c");
        Assert.Equal(StatusKind.Danger, failed.StatusBadge);
        Assert.True(failed.HasError);
        Assert.Equal("boom", failed.ErrorMessage);
        Assert.False(failed.CanDownload);
    }

    [Fact]
    public void History_unknown_vehicle_falls_back_to_hash_id()
    {
        var model = DataExportModel.Initial with
        {
            JobsLoading = false,
            Jobs = [Job("a", "drives", "ready", vehicleId: 42)],
            Vehicles = Array.Empty<VehicleSummary>(),
            Now = Now,
        };
        var display = DataExportProjection.Project(model, Localizer);

        Assert.Equal("#42", display.History.Rows[0].Vehicle);
    }

    // ---- Registration catalog ------------------------------------------------------

    [Fact]
    public void Registration_pins_the_web_route_and_operations()
    {
        Assert.Equal("DataExport", DataExportRegistration.RouteName);
        Assert.Equal("DataExportPage", DataExportRegistration.Slug);
        Assert.Equal("/data-export", DataExportRegistration.WebRoute);
        Assert.Equal("get_api_v1_export_jobs", DataExportRegistration.JobsOperation);
        Assert.Equal("get_api_v1_vehicles", DataExportRegistration.VehiclesOperation);
        Assert.Equal("get_api_v1_exports_columns", DataExportRegistration.ColumnsOperation);
        Assert.Equal("post_api_v1_export_jobs", DataExportRegistration.SubmitOperation);
        Assert.Equal("post_api_v1_export_jobs_account", DataExportRegistration.AccountOperation);
    }

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData(0L, "")]
    [InlineData(512L, "512 B")]
    [InlineData(2048L, "2.0 KB")]
    public void FormatBytes_matches_web(long? bytes, string expected) =>
        Assert.Equal(expected, DataExportRegistration.FormatBytes(bytes));

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData(0L, "\u2014")]
    [InlineData(450L, "450ms")]
    [InlineData(4200L, "4.2s")]
    [InlineData(65000L, "1m 5s")]
    public void FormatDuration_matches_web(long? ms, string expected) =>
        Assert.Equal(expected, DataExportRegistration.FormatDuration(ms));

    [Fact]
    public void CatalogTypeFor_only_drives_and_charging_publish_a_catalog()
    {
        Assert.Equal("drives", DataExportRegistration.CatalogTypeFor("drives"));
        Assert.Equal("charging", DataExportRegistration.CatalogTypeFor("charging"));
        Assert.Equal(string.Empty, DataExportRegistration.CatalogTypeFor("analytics"));
        Assert.Equal(string.Empty, DataExportRegistration.CatalogTypeFor("full_backup"));
    }

    // ---- View-model: load / submit / account / columns -----------------------------

    [Fact]
    public async Task ViewModel_load_success_renders_history_rows()
    {
        var feed = new FakeDataExportFeed
        {
            Jobs = [Job("a", "drives", "ready", size: 2048)],
            Vehicles = [new VehicleSummary(7, "Model 3", "VIN7")],
        };
        using var vm = new DataExportPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataExportState.Success, vm.State);
        Assert.Single(vm.Display.History.Rows);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_load_error_sets_error_state()
    {
        var feed = new FakeDataExportFeed { ThrowOnJobs = true };
        using var vm = new DataExportPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(DataExportState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_submit_builds_the_web_payload_and_raises_a_toast()
    {
        var feed = new FakeDataExportFeed();
        using var vm = new DataExportPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        DataExportToast? toast = null;
        vm.ToastRequested += (_, t) => toast = t;

        await vm.SubmitAsync();

        var payload = Assert.Single(feed.Submits);
        Assert.Equal("drives", payload.Type);
        Assert.Equal("csv", payload.Format);
        Assert.Equal("2026-05-13", payload.Start); // Now - 30 days
        Assert.Equal("2026-06-12", payload.End);
        Assert.Null(payload.VehicleId);
        Assert.Null(payload.Columns);
        Assert.NotNull(toast);
        Assert.False(toast!.IsError);
        Assert.Equal("Export Started", toast.Title);
    }

    [Fact]
    public async Task ViewModel_account_export_omits_all_vehicles_scope()
    {
        var feed = new FakeDataExportFeed();
        using var vm = new DataExportPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.SetAccountStart("2026-01-01");
        await vm.RunAccountExportAsync();

        var payload = Assert.Single(feed.Accounts);
        Assert.Null(payload.VehicleId);            // "all" → omitted
        Assert.NotNull(payload.Start);
        Assert.Null(payload.End);
    }

    [Fact]
    public async Task ViewModel_toggle_column_drops_it_from_the_allowlist()
    {
        var feed = new FakeDataExportFeed
        {
            Catalog = new ExportColumnsCatalog("drives", true,
            [
                new ExportColumnInfo("id", "ID", true),
                new ExportColumnInfo("distance_m", "Distance", false),
                new ExportColumnInfo("speed_mps", "Speed", false),
            ]),
        };
        using var vm = new DataExportPageViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync(); // default type drives → fetches the catalog

        Assert.True(vm.Display.Wizard.ShowColumnPicker);
        Assert.True(vm.Display.Wizard.ColumnsAllSelected);

        vm.ToggleColumn("distance_m");

        var rows = vm.Display.Wizard.ColumnRows;
        Assert.False(rows.Single(r => r.Name == "distance_m").Checked);
        Assert.True(rows.Single(r => r.Name == "id").Checked);
        Assert.False(vm.Display.Wizard.ColumnsAllSelected);

        // A required column cannot be removed.
        vm.ToggleColumn("id");
        Assert.True(vm.Display.Wizard.ColumnRows.Single(r => r.Name == "id").Checked);
    }

    // ---- Test doubles --------------------------------------------------------------

    private sealed class FakeDataExportFeed : IDataExportFeed
    {
        public IReadOnlyList<ExportJobSummary> Jobs { get; set; } = Array.Empty<ExportJobSummary>();

        public IReadOnlyList<VehicleSummary> Vehicles { get; set; } = Array.Empty<VehicleSummary>();

        public ExportColumnsCatalog Catalog { get; set; } = ExportColumnsCatalog.Empty;

        public bool ThrowOnJobs { get; set; }

        public List<ExportSubmitPayload> Submits { get; } = new();

        public List<AccountExportPayload> Accounts { get; } = new();

        public Uri? DownloadBaseUri => null;

        public Task<ExportJobsSnapshot> FetchJobsAsync(CancellationToken cancellationToken) =>
            ThrowOnJobs
                ? Task.FromException<ExportJobsSnapshot>(new InvalidOperationException("boom"))
                : Task.FromResult(new ExportJobsSnapshot(true, Jobs));

        public Task<VehiclesSnapshot> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult(new VehiclesSnapshot(true, Vehicles));

        public Task<ExportColumnsCatalog> FetchColumnsAsync(string catalogType, CancellationToken cancellationToken) =>
            Task.FromResult(Catalog);

        public Task SubmitExportAsync(ExportSubmitPayload payload, CancellationToken cancellationToken)
        {
            Submits.Add(payload);
            return Task.CompletedTask;
        }

        public Task CreateAccountExportAsync(AccountExportPayload payload, CancellationToken cancellationToken)
        {
            Accounts.Add(payload);
            return Task.CompletedTask;
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
