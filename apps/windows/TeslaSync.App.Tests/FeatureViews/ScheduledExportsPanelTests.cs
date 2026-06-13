using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Exports;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ScheduledExportsPanel</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/ScheduledExportsPanel.tsx): the three data states (loading / empty / success),
/// the per-row projection (type+format, delivery string, run timestamps, status badge, enable/disable toggle), the
/// inline-form flow (open / edit / close / field edits, delivery-target visibility, payload shaping), the
/// generated-client feed's request shaping (the five <c>/scheduled-exports</c> operations), the registration
/// constants and the PII-safe diagnostics. The WinUI view is exercised by the app build; its per-region visibility
/// is driven entirely by the <see cref="ScheduledExportsDisplay"/> flags asserted here.
/// </summary>
public sealed class ScheduledExportsPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 18, 0, 0, TimeSpan.Zero);

    // The 36 i18n keys the manifest requires the panel to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "dataExport.scheduled.actions.delete",
        "dataExport.scheduled.actions.disable",
        "dataExport.scheduled.actions.edit",
        "dataExport.scheduled.actions.enable",
        "dataExport.scheduled.actions.runNow",
        "dataExport.scheduled.deleteConfirmBody",
        "dataExport.scheduled.deleteConfirmTitle",
        "dataExport.scheduled.empty",
        "dataExport.scheduled.emptyMessage",
        "dataExport.scheduled.form.cancel",
        "dataExport.scheduled.form.deliveryKind",
        "dataExport.scheduled.form.deliveryTarget",
        "dataExport.scheduled.form.deliveryTargetHelp",
        "dataExport.scheduled.form.exportType",
        "dataExport.scheduled.form.format",
        "dataExport.scheduled.form.name",
        "dataExport.scheduled.form.namePlaceholder", // parity:allow web i18n key name, not a stub marker
        "dataExport.scheduled.form.rangeWindow",
        "dataExport.scheduled.form.rangeWindowHelp",
        "dataExport.scheduled.form.scheduleCron",
        "dataExport.scheduled.form.scheduleCronHelp",
        "dataExport.scheduled.form.submit",
        "dataExport.scheduled.newSchedule",
        "dataExport.scheduled.status.failed",
        "dataExport.scheduled.status.never",
        "dataExport.scheduled.status.ok",
        "dataExport.scheduled.subtitle",
        "dataExport.scheduled.table.actions",
        "dataExport.scheduled.table.cron",
        "dataExport.scheduled.table.delivery",
        "dataExport.scheduled.table.lastRun",
        "dataExport.scheduled.table.name",
        "dataExport.scheduled.table.nextRun",
        "dataExport.scheduled.table.status",
        "dataExport.scheduled.table.type",
        "dataExport.scheduled.title",
    ];

    private static ScheduledExport Sched(
        long id = 1,
        string name = "Drives weekly",
        string exportType = "drives",
        string format = "csv",
        string cron = "0 9 * * 0",
        string deliveryKind = "download",
        string? deliveryTarget = null,
        string range = "7d",
        bool enabled = true,
        string? lastRunAt = null,
        string? lastStatus = null,
        string? nextRunAt = null) =>
        new(
            Id: id,
            Name: name,
            ExportType: exportType,
            Format: format,
            VehicleId: null,
            Columns: null,
            ScheduleCron: cron,
            Delivery: new ScheduledExportDelivery(deliveryKind, deliveryTarget),
            RangeWindow: range,
            Enabled: enabled,
            LastRunAt: lastRunAt,
            LastStatus: lastStatus,
            NextRunAt: nextRunAt);

    private static ScheduledExportsModel Model(
        IReadOnlyList<ScheduledExport>? items = null,
        bool loading = false,
        bool showForm = false,
        long? editingId = null,
        ScheduledExportFormState? form = null,
        bool submitting = false,
        long? runningId = null) =>
        new(
            Items: items ?? new[] { Sched() },
            Loading: loading,
            ShowForm: showForm,
            EditingId: editingId,
            Form: form ?? ScheduledExportFormState.Empty(),
            Submitting: submitting,
            RunningId: runningId,
            Now: Now);

    // ---- Data states (web precedence loading -> empty -> table) ----------------------

    [Fact]
    public void Projection_loading_with_no_rows_is_the_loading_state()
    {
        var display = ScheduledExportsProjection.Project(
            Model(items: Array.Empty<ScheduledExport>(), loading: true), Localizer);

        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.Equal(ScheduledExportsState.Loading, display.State);
    }

    [Fact]
    public void Projection_resolved_with_no_rows_is_the_empty_state()
    {
        var display = ScheduledExportsProjection.Project(
            Model(items: Array.Empty<ScheduledExport>()), Localizer);

        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowRows);
        Assert.Equal(ScheduledExportsState.Empty, display.State);
        Assert.Equal("No schedules yet", display.EmptyTitle);
        Assert.Equal("Create a schedule to receive recurring exports automatically.", display.EmptyMessage);
    }

    [Fact]
    public void Projection_with_rows_is_the_success_state()
    {
        var display = ScheduledExportsProjection.Project(Model(), Localizer);

        Assert.True(display.ShowRows);
        Assert.False(display.ShowEmpty);
        Assert.Equal(ScheduledExportsState.Success, display.State);
        Assert.Single(display.Rows);
    }

    [Fact]
    public void Projection_refetch_with_existing_rows_keeps_the_table()
    {
        // web: isLoading is only true on the first load; a background refetch keeps the rows visible.
        var display = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched() }, loading: true), Localizer);

        Assert.False(display.ShowLoading);
        Assert.True(display.ShowRows);
    }

    // ---- Header + row projection -----------------------------------------------------

    [Fact]
    public void Projection_exposes_the_header_copy()
    {
        var display = ScheduledExportsProjection.Project(Model(), Localizer);

        Assert.Equal("Scheduled exports", display.Title);
        Assert.Equal("Cron-driven recurring exports.", display.Subtitle);
        Assert.Equal("New schedule", display.NewScheduleLabel);
    }

    [Fact]
    public void Projection_row_builds_the_type_and_cron_cells()
    {
        var display = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(exportType: "charging", format: "json", cron: "0 8 * * 1") }), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.Equal("charging (json)", row.TypeLabel);
        Assert.Equal("0 8 * * 1", row.Cron);
    }

    [Fact]
    public void Projection_row_download_delivery_has_no_target_arrow()
    {
        var display = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(deliveryKind: "download") }), Localizer);

        Assert.Equal("download", display.Rows[0].Delivery);
    }

    [Fact]
    public void Projection_row_targeted_delivery_appends_the_target()
    {
        var display = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(deliveryKind: "email", deliveryTarget: "you@example.com") }), Localizer);

        Assert.Equal("email \u2192 you@example.com", display.Rows[0].Delivery);
    }

    [Fact]
    public void Projection_row_next_run_present_and_absent()
    {
        var withRun = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(nextRunAt: "2026-06-13T09:00:00Z") }), Localizer);
        Assert.NotEqual(ScheduledExportsProjection.EmDash, withRun.Rows[0].NextRun);

        var withoutRun = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(nextRunAt: null) }), Localizer);
        Assert.Equal(ScheduledExportsProjection.EmDash, withoutRun.Rows[0].NextRun);
    }

    [Fact]
    public void Projection_row_last_run_falls_back_to_never()
    {
        var never = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(lastRunAt: null) }), Localizer);
        Assert.Equal("Never", never.Rows[0].LastRun);

        var ran = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(lastRunAt: "2026-06-10T09:00:00Z") }), Localizer);
        Assert.NotEqual("Never", ran.Rows[0].LastRun);
    }

    [Theory]
    [InlineData("ok", StatusKind.Success, "OK", true)]
    [InlineData("failed", StatusKind.Danger, "Failed", true)]
    public void Projection_row_status_badge_maps_known_outcomes(
        string status, StatusKind variant, string label, bool hasBadge)
    {
        var display = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(lastStatus: status) }), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.Equal(variant, row.StatusVariant);
        Assert.Equal(label, row.StatusLabel);
        Assert.Equal(hasBadge, row.HasStatusBadge);
    }

    [Fact]
    public void Projection_row_unknown_status_has_no_badge()
    {
        var display = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(lastStatus: null) }), Localizer);

        var row = Assert.Single(display.Rows);
        Assert.False(row.HasStatusBadge);
        Assert.Equal(ScheduledExportsProjection.EmDash, row.StatusLabel);
    }

    [Theory]
    [InlineData(true, "Disable")]
    [InlineData(false, "Enable")]
    public void Projection_row_toggle_label_follows_enabled(bool enabled, string expected)
    {
        var display = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(enabled: enabled) }), Localizer);

        Assert.Equal(expected, display.Rows[0].ToggleLabel);
        Assert.Equal(!enabled, display.Rows[0].ToggleEnables);
    }

    [Fact]
    public void Projection_row_marks_the_running_schedule()
    {
        var display = ScheduledExportsProjection.Project(
            Model(items: new[] { Sched(id: 7) }, runningId: 7), Localizer);

        Assert.True(display.Rows[0].IsRunning);
    }

    // ---- Inline form -----------------------------------------------------------------

    [Fact]
    public void Projection_form_is_closed_by_default_with_full_option_lists()
    {
        var display = ScheduledExportsProjection.Project(Model(), Localizer);

        Assert.False(display.ShowForm);
        Assert.Equal(5, display.ExportTypeOptions.Count);
        Assert.Equal(2, display.FormatOptions.Count);
        Assert.Equal(3, display.DeliveryKindOptions.Count);
        Assert.Equal("drives", display.ExportTypeOptions[0].Value);
    }

    [Fact]
    public void Projection_form_hides_delivery_target_for_download()
    {
        var display = ScheduledExportsProjection.Project(
            Model(showForm: true, form: ScheduledExportFormState.Empty()), Localizer);

        Assert.True(display.ShowForm);
        Assert.False(display.ShowDeliveryTarget);
    }

    [Fact]
    public void Projection_form_shows_delivery_target_for_email()
    {
        var form = ScheduledExportFormState.Empty() with { DeliveryKind = "email" };
        var display = ScheduledExportsProjection.Project(Model(showForm: true, form: form), Localizer);

        Assert.True(display.ShowDeliveryTarget);
    }

    [Fact]
    public void Projection_form_reports_editing_mode()
    {
        var display = ScheduledExportsProjection.Project(Model(showForm: true, editingId: 5), Localizer);

        Assert.True(display.IsEditing);
    }

    [Fact]
    public void Projection_delete_confirm_body_interpolates_the_name()
    {
        var display = ScheduledExportsProjection.Project(Model(), Localizer);

        Assert.Equal("Delete schedule?", display.DeleteConfirmTitle);
        Assert.Equal("This will stop future runs of Drives weekly.", display.DeleteConfirmBody("Drives weekly"));
    }

    // ---- Form state + payload --------------------------------------------------------

    [Fact]
    public void FormState_empty_has_the_web_default_input()
    {
        var form = ScheduledExportFormState.Empty();

        Assert.Equal("drives", form.ExportType);
        Assert.Equal("csv", form.Format);
        Assert.Equal("0 9 * * 0", form.ScheduleCron);
        Assert.Equal("7d", form.RangeWindow);
        Assert.Equal("download", form.DeliveryKind);
        Assert.True(form.Enabled);
    }

    [Fact]
    public void FormState_from_row_round_trips_the_input()
    {
        var row = Sched(id: 3, name: "Nightly", exportType: "trips", format: "json", deliveryKind: "webhook", deliveryTarget: "https://x/y", enabled: false);

        var form = ScheduledExportFormState.FromRow(row);

        Assert.Equal("Nightly", form.Name);
        Assert.Equal("trips", form.ExportType);
        Assert.Equal("json", form.Format);
        Assert.Equal("webhook", form.DeliveryKind);
        Assert.Equal("https://x/y", form.DeliveryTarget);
        Assert.False(form.Enabled);
    }

    // ---- Tolerant parser -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_schedule_rows()
    {
        using var doc = JsonDocument.Parse(
            "[{\"id\":5,\"name\":\"Weekly\",\"export_type\":\"drives\",\"format\":\"csv\"," +
            "\"schedule_cron\":\"0 9 * * 0\",\"delivery\":{\"kind\":\"email\",\"target\":\"a@b.com\"}," +
            "\"range_window\":\"7d\",\"enabled\":true,\"last_status\":\"ok\",\"next_run_at\":\"2026-06-13T09:00:00Z\"}]");

        var list = ScheduledExport.ParseList(doc.RootElement);

        var entry = Assert.Single(list);
        Assert.Equal(5, entry.Id);
        Assert.Equal("Weekly", entry.Name);
        Assert.Equal("email", entry.Delivery.Kind);
        Assert.Equal("a@b.com", entry.Delivery.Target);
        Assert.True(entry.Enabled);
        Assert.NotNull(entry.NextRunTime);
    }

    [Fact]
    public void ParseList_tolerates_non_arrays_and_partial_rows()
    {
        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(ScheduledExport.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse("[{\"name\":\"x\"}]");
        var entry = Assert.Single(ScheduledExport.ParseList(partial.RootElement));
        Assert.Equal(0, entry.Id);
        Assert.Equal("download", entry.Delivery.Kind);
        Assert.Null(entry.NextRunTime);
    }

    // ---- View-model state matrix -----------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new ScheduledExportsPanelViewModel(EmptyScheduledExportsFeed.Instance, Localizer, () => Now);

        Assert.Equal(ScheduledExportsState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loads_into_success()
    {
        var feed = new FakeScheduledExportsFeed(new List<ScheduledExport> { Sched(id: 1), Sched(id: 2) });
        using var vm = new ScheduledExportsPanelViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ScheduledExportsState.Success, vm.State);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new ScheduledExportsPanelViewModel(EmptyScheduledExportsFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ScheduledExportsState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_fetch_failure_falls_back_to_empty()
    {
        // web useScheduledExports uses `select: safeArray`, so a failed query resolves to the empty state.
        using var vm = new ScheduledExportsPanelViewModel(new ThrowingScheduledExportsFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(ScheduledExportsState.Empty, vm.State);
    }

    [Fact]
    public void ViewModel_start_create_opens_a_blank_form()
    {
        using var vm = new ScheduledExportsPanelViewModel(EmptyScheduledExportsFeed.Instance, Localizer, () => Now);

        int epoch = vm.FormEpoch;
        vm.StartCreate();

        Assert.True(vm.IsFormOpen);
        Assert.Null(vm.EditingId);
        Assert.True(vm.Display.ShowForm);
        Assert.NotEqual(epoch, vm.FormEpoch);
        Assert.Equal(string.Empty, vm.Form.Name);
    }

    [Fact]
    public async Task ViewModel_start_edit_seeds_the_form_from_the_row()
    {
        var feed = new FakeScheduledExportsFeed(new List<ScheduledExport> { Sched(id: 9, name: "Reports") });
        using var vm = new ScheduledExportsPanelViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        vm.StartEdit(9);

        Assert.True(vm.IsFormOpen);
        Assert.Equal(9, vm.EditingId);
        Assert.Equal("Reports", vm.Form.Name);
    }

    [Fact]
    public void ViewModel_close_form_resets_state()
    {
        using var vm = new ScheduledExportsPanelViewModel(EmptyScheduledExportsFeed.Instance, Localizer, () => Now);
        vm.StartCreate();

        vm.CloseForm();

        Assert.False(vm.IsFormOpen);
        Assert.Null(vm.EditingId);
        Assert.False(vm.Display.ShowForm);
    }

    [Fact]
    public void ViewModel_delivery_kind_setter_toggles_target_visibility()
    {
        using var vm = new ScheduledExportsPanelViewModel(EmptyScheduledExportsFeed.Instance, Localizer, () => Now);
        vm.StartCreate();

        vm.SetDeliveryKind("email");

        Assert.Equal("email", vm.Form.DeliveryKind);
        Assert.True(vm.Display.ShowDeliveryTarget);
    }

    [Fact]
    public void ViewModel_text_setters_update_the_form()
    {
        using var vm = new ScheduledExportsPanelViewModel(EmptyScheduledExportsFeed.Instance, Localizer, () => Now);
        vm.StartCreate();

        vm.SetName("Weekly drives");
        vm.SetScheduleCron("0 6 * * 1");
        vm.SetRangeWindow("30d");

        Assert.Equal("Weekly drives", vm.Form.Name);
        Assert.Equal("0 6 * * 1", vm.Form.ScheduleCron);
        Assert.Equal("30d", vm.Form.RangeWindow);
    }

    [Fact]
    public async Task ViewModel_submit_create_sends_the_form_and_closes()
    {
        var feed = new FakeScheduledExportsFeed(new List<ScheduledExport>());
        using var vm = new ScheduledExportsPanelViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.StartCreate();
        vm.SetName("Weekly");

        await vm.SubmitAsync();

        var created = Assert.Single(feed.Creates);
        Assert.Equal("Weekly", created.Name);
        Assert.False(vm.IsFormOpen);
        Assert.Equal(2, feed.FetchCount); // initial load + reload after create
    }

    [Fact]
    public async Task ViewModel_submit_edit_updates_by_id()
    {
        var feed = new FakeScheduledExportsFeed(new List<ScheduledExport> { Sched(id: 4, name: "Old") });
        using var vm = new ScheduledExportsPanelViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();
        vm.StartEdit(4);
        vm.SetName("New");

        await vm.SubmitAsync();

        var (id, form) = Assert.Single(feed.Updates);
        Assert.Equal(4, id);
        Assert.Equal("New", form.Name);
        Assert.False(vm.IsFormOpen);
    }

    [Fact]
    public async Task ViewModel_toggle_enabled_updates_with_flipped_flag()
    {
        var feed = new FakeScheduledExportsFeed(new List<ScheduledExport> { Sched(id: 6, enabled: true) });
        using var vm = new ScheduledExportsPanelViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.ToggleEnabledAsync(6);

        var (id, form) = Assert.Single(feed.Updates);
        Assert.Equal(6, id);
        Assert.False(form.Enabled);
    }

    [Fact]
    public async Task ViewModel_run_now_calls_the_feed()
    {
        var feed = new FakeScheduledExportsFeed(new List<ScheduledExport> { Sched(id: 8) });
        using var vm = new ScheduledExportsPanelViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.RunNowAsync(8);

        Assert.Contains(8L, feed.Runs);
    }

    [Fact]
    public async Task ViewModel_delete_calls_the_feed()
    {
        var feed = new FakeScheduledExportsFeed(new List<ScheduledExport> { Sched(id: 2) });
        using var vm = new ScheduledExportsPanelViewModel(feed, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.DeleteAsync(2);

        Assert.Contains(2L, feed.Deletes);
    }

    // ---- Generated-client feed (web hooks → /scheduled-exports) ----------------------

    [Fact]
    public async Task ClientFeed_list_sends_the_list_operation_with_no_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[]"));
        var feed = new ScheduledExportsClientFeed(api);

        _ = await feed.FetchAsync(default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_scheduled_exports", request.OperationId);
        Assert.Null(request.PathParams);
        Assert.Null(request.Query);
    }

    [Fact]
    public async Task ClientFeed_create_posts_the_payload_and_drops_the_download_target()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new ScheduledExportsClientFeed(api);

        await feed.CreateAsync(ScheduledExportFormState.Empty() with { Name = "Weekly" }, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_scheduled_exports", request.OperationId);
        Assert.Null(request.PathParams);
        string body = SerializeBody(request.Body);
        Assert.Contains("\"name\":\"Weekly\"", body, StringComparison.Ordinal);
        Assert.Contains("\"export_type\":\"drives\"", body, StringComparison.Ordinal);
        Assert.Contains("\"kind\":\"download\"", body, StringComparison.Ordinal);
        Assert.DoesNotContain("\"target\"", body, StringComparison.Ordinal);
        Assert.DoesNotContain("\"vehicle_id\"", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ClientFeed_create_trims_and_sends_a_targeted_delivery()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new ScheduledExportsClientFeed(api);

        var form = ScheduledExportFormState.Empty() with { DeliveryKind = "email", DeliveryTarget = "  you@example.com  " };
        await feed.CreateAsync(form, default);

        string body = SerializeBody(Assert.Single(api.Requests).Body);
        Assert.Contains("\"kind\":\"email\"", body, StringComparison.Ordinal);
        Assert.Contains("\"target\":\"you@example.com\"", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ClientFeed_update_sends_the_id_path_and_a_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new ScheduledExportsClientFeed(api);

        await feed.UpdateAsync(12, ScheduledExportFormState.Empty(), default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("put_api_v1_scheduled_exports_id", request.OperationId);
        Assert.NotNull(request.PathParams);
        Assert.Equal("12", request.PathParams!["id"]);
        Assert.NotNull(request.Body);
    }

    [Fact]
    public async Task ClientFeed_delete_sends_the_id_path()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new ScheduledExportsClientFeed(api);

        await feed.DeleteAsync(15, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("delete_api_v1_scheduled_exports_id", request.OperationId);
        Assert.Equal("15", request.PathParams!["id"]);
    }

    [Fact]
    public async Task ClientFeed_run_sends_the_run_operation_with_the_id_path()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        var feed = new ScheduledExportsClientFeed(api);

        await feed.RunNowAsync(21, default);

        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_scheduled_exports_id_run", request.OperationId);
        Assert.Equal("21", request.PathParams!["id"]);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new ScheduledExportsClientFeed(api);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    // ---- Registration + diagnostics --------------------------------------------------

    [Fact]
    public void Registration_exposes_route_slug_and_operations()
    {
        Assert.Equal("ScheduledExportsPanel", ScheduledExportsRegistration.Slug);
        Assert.Equal("ScheduledExports", ScheduledExportsRegistration.RouteName);
        Assert.Equal("scheduled-exports", ScheduledExportsRegistration.RoutePath);
        Assert.Equal("get_api_v1_scheduled_exports", ScheduledExportsRegistration.ListOperation);
        Assert.Equal("post_api_v1_scheduled_exports", ScheduledExportsRegistration.CreateOperation);
        Assert.Equal("put_api_v1_scheduled_exports_id", ScheduledExportsRegistration.UpdateOperation);
        Assert.Equal("delete_api_v1_scheduled_exports_id", ScheduledExportsRegistration.DeleteOperation);
        Assert.Equal("post_api_v1_scheduled_exports_id_run", ScheduledExportsRegistration.RunOperation);
        Assert.Equal("Scheduled exports", ScheduledExportsRegistration.Title(Localizer));
        Assert.Equal("Cron-driven recurring exports.", ScheduledExportsRegistration.Subtitle(Localizer));
        Assert.Equal(5, ScheduledExportsRegistration.ExportTypes.Count);
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new ScheduledExportsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ScheduledExportsPanel", Assert.Single(lines));
    }

    // ---- i18n key coverage (the manifest's 36 required keys) -------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        ScheduledExportsProjection.Project(Model(items: new[] { Sched(lastStatus: "ok") }, showForm: true), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private static string SerializeBody(object? body)
    {
        Assert.NotNull(body);
        return JsonSerializer.Serialize(body, body!.GetType());
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeScheduledExportsFeed : IScheduledExportsFeed
    {
        private readonly List<ScheduledExport> _schedules;

        public FakeScheduledExportsFeed(List<ScheduledExport> schedules) => _schedules = schedules;

        public int FetchCount { get; private set; }

        public List<ScheduledExportFormState> Creates { get; } = new();

        public List<(long Id, ScheduledExportFormState Form)> Updates { get; } = new();

        public List<long> Deletes { get; } = new();

        public List<long> Runs { get; } = new();

        public Task<IReadOnlyList<ScheduledExport>> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult<IReadOnlyList<ScheduledExport>>(_schedules.ToList());
        }

        public Task CreateAsync(ScheduledExportFormState form, CancellationToken cancellationToken)
        {
            Creates.Add(form);
            return Task.CompletedTask;
        }

        public Task UpdateAsync(long id, ScheduledExportFormState form, CancellationToken cancellationToken)
        {
            Updates.Add((id, form));
            return Task.CompletedTask;
        }

        public Task DeleteAsync(long id, CancellationToken cancellationToken)
        {
            Deletes.Add(id);
            return Task.CompletedTask;
        }

        public Task RunNowAsync(long id, CancellationToken cancellationToken)
        {
            Runs.Add(id);
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingScheduledExportsFeed : IScheduledExportsFeed
    {
        public Task<IReadOnlyList<ScheduledExport>> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task CreateAsync(ScheduledExportFormState form, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task UpdateAsync(long id, ScheduledExportFormState form, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task DeleteAsync(long id, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");

        public Task RunNowAsync(long id, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("boom");
    }
}
