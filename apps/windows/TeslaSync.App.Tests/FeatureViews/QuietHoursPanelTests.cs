using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the QuietHoursPanel feature-view's UI-thread-free logic — the window-list adapter
/// (cache-then-network parsing of the <c>{ windows: [...] }</c> envelope and the create / update / delete write
/// shapes), the draft validation and timeline pure logic, the per-state projection (list rows, empty state and
/// the create/edit form), the i18n routing, the accessibility names, the cache-then-network state-holder
/// transitions (loading / loaded / empty / stale / offline / error), the optimistic save/delete feedback, and the
/// PII-safe diagnostics. Mirrors the web spec (web/src/features/settings/components/QuietHoursPanel.tsx). The
/// WinUI view itself is exercised by the app build.
/// </summary>
public sealed class QuietHoursPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTime MondayNoon = new(2026, 1, 5, 12, 0, 0, DateTimeKind.Local); // Monday

    // ---- Catalogs (web SEVERITY_CHOICES + WEEKDAYS) ----------------------------------------------------

    [Fact]
    public void Severity_catalog_matches_web_order_and_wire()
    {
        Assert.Equal(
            new[] { QuietHoursSeverity.Critical, QuietHoursSeverity.Warn, QuietHoursSeverity.Info },
            QuietHoursSeverityCatalog.Ordered);
        Assert.Equal("critical", QuietHoursSeverityCatalog.WireValue(QuietHoursSeverity.Critical));
        Assert.Equal("warn", QuietHoursSeverityCatalog.WireValue(QuietHoursSeverity.Warn));
        Assert.Equal("info", QuietHoursSeverityCatalog.WireValue(QuietHoursSeverity.Info));
        Assert.Equal("quietHours.severity.critical", QuietHoursSeverityCatalog.I18nKey(QuietHoursSeverity.Critical));
        Assert.Equal("Warning", QuietHoursSeverityCatalog.Fallback(QuietHoursSeverity.Warn));
        Assert.Equal(QuietHoursSeverity.Critical, QuietHoursSeverityCatalog.FromWire("critical"));
        Assert.Equal(QuietHoursSeverity.Info, QuietHoursSeverityCatalog.FromWire("unknown"));
    }

    [Fact]
    public void Weekday_catalog_has_seven_days_with_server_bit_positions()
    {
        Assert.Equal(7, QuietHoursWeekdayCatalog.Ordered.Count);
        Assert.Equal(127, QuietHoursWeekdayCatalog.AllWeekdays);
        Assert.Equal(1 << 0, QuietHoursWeekdayCatalog.Ordered[0].Bit);
        Assert.Equal(1 << 6, QuietHoursWeekdayCatalog.Ordered[6].Bit);
        Assert.Equal("Sun", QuietHoursWeekdayCatalog.Ordered[0].Fallback);
        Assert.Equal("Sat", QuietHoursWeekdayCatalog.Ordered[6].Fallback);
        Assert.True(QuietHoursWeekdayCatalog.IsOn(127, 1 << 3));
        Assert.False(QuietHoursWeekdayCatalog.IsOn(0, 1 << 3));
    }

    // ---- Window parsing (web safeArray(r?.windows)) ----------------------------------------------------

    [Fact]
    public void ListFromResponse_parses_windows_and_skips_malformed_rows()
    {
        var json = Json(
            """
            {"windows":[
              {"id":1,"user_id":"u","enabled":true,"start_local":"23:00","end_local":"07:00","timezone":"UTC","weekdays":127,"bypass_severities":["critical"]},
              42,
              {"id":2,"user_id":"u","enabled":false,"start_local":"08:00","end_local":"09:00","timezone":"Europe/London","weekdays":62,"bypass_severities":[]}
            ]}
            """);

        var windows = QuietHoursWindow.ListFromResponse(json);

        Assert.Equal(2, windows.Count);
        Assert.Equal(1, windows[0].Id);
        Assert.True(windows[0].Enabled);
        Assert.Equal("23:00 \u2192 07:00 (UTC)", windows[0].Summary);
        Assert.Equal(new[] { "critical" }, windows[0].BypassSeverities);
        Assert.False(windows[1].Enabled);
        Assert.Empty(windows[1].BypassSeverities);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"windows\":[]}")]
    [InlineData("null")]
    public void ListFromResponse_yields_empty_for_missing_or_empty_windows(string raw)
    {
        Assert.Empty(QuietHoursWindow.ListFromResponse(Json(raw)));
    }

    // ---- Validation (web validateDraft + submit message map) -------------------------------------------

    [Fact]
    public void Validate_accepts_a_well_formed_draft()
    {
        Assert.True(QuietHoursValidation.Validate(NewDraft()).Ok);
    }

    [Theory]
    [InlineData("9:00", "07:00", QuietHoursField.StartLocal, QuietHoursValidationReason.Invalid, "Start must be HH:MM (24-hour).")]
    [InlineData("23:00", "7:0", QuietHoursField.EndLocal, QuietHoursValidationReason.Invalid, "End must be HH:MM (24-hour).")]
    [InlineData("08:00", "08:00", QuietHoursField.EndLocal, QuietHoursValidationReason.Equal, "End must differ from start.")]
    public void Validate_flags_bad_times(string start, string end, QuietHoursField field, QuietHoursValidationReason reason, string fallback)
    {
        var result = QuietHoursValidation.Validate(NewDraft() with { StartLocal = start, EndLocal = end });

        Assert.False(result.Ok);
        Assert.Equal(field, result.Field);
        Assert.Equal(reason, result.Reason);
        Assert.Equal(fallback, QuietHoursValidation.MessageFallback(result));
    }

    [Fact]
    public void Validate_requires_a_timezone()
    {
        var result = QuietHoursValidation.Validate(NewDraft() with { Timezone = "" });
        Assert.Equal(QuietHoursField.Timezone, result.Field);
        Assert.Equal("quietHours.error.timezoneRequired", QuietHoursValidation.MessageKey(result));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(128)]
    public void Validate_requires_at_least_one_weekday(int weekdays)
    {
        var result = QuietHoursValidation.Validate(NewDraft() with { Weekdays = weekdays });
        Assert.Equal(QuietHoursField.Weekdays, result.Field);
        Assert.Equal("Pick at least one weekday.", QuietHoursValidation.MessageFallback(result));
    }

    // ---- Timeline (web nextWindowChangeLabel) ----------------------------------------------------------

    [Fact]
    public void NextChange_returns_none_for_disabled_or_off_day()
    {
        var disabled = NewWindow() with { Enabled = false };
        Assert.Equal(QuietHoursNextChangeKind.None, QuietHoursTimeline.NextChange(disabled, MondayNoon).Kind);

        var notMonday = NewWindow() with { Weekdays = 1 << 0 }; // Sunday only
        Assert.Equal(QuietHoursNextChangeKind.None, QuietHoursTimeline.NextChange(notMonday, MondayNoon).Kind);
    }

    [Fact]
    public void NextChange_handles_wrapping_window()
    {
        // 23:00 → 07:00 wraps midnight; at 12:00 it has not started and next starts at 23:00.
        var window = NewWindow() with { StartLocal = "23:00", EndLocal = "07:00" };
        var change = QuietHoursTimeline.NextChange(window, MondayNoon);
        Assert.Equal(QuietHoursNextChangeKind.StartsToday, change.Kind);
        Assert.Equal("23:00", change.Time);
    }

    [Fact]
    public void NextChange_handles_active_non_wrapping_window()
    {
        // 08:00 → 18:00; at 12:00 it is active and next ends at 18:00.
        var window = NewWindow() with { StartLocal = "08:00", EndLocal = "18:00" };
        var change = QuietHoursTimeline.NextChange(window, MondayNoon);
        Assert.Equal(QuietHoursNextChangeKind.EndsToday, change.Kind);
        Assert.Equal("18:00", change.Time);
    }

    // ---- Timezones (web listTimezones) -----------------------------------------------------------------

    [Fact]
    public void Timezone_options_prepend_current_when_outside_curated_list()
    {
        var options = QuietHoursTimezones.Options("Pacific/Auckland");
        Assert.Equal("Pacific/Auckland", options[0]);
        Assert.Contains("UTC", options);

        Assert.Equal(QuietHoursTimezones.Curated, QuietHoursTimezones.Options("UTC"));
        Assert.False(string.IsNullOrWhiteSpace(QuietHoursTimezones.ResolveLocal()));
    }

    // ---- Projection (web render) -----------------------------------------------------------------------

    [Fact]
    public void Project_renders_a_row_with_badge_summary_weekdays_and_a11y_names()
    {
        var window = NewWindow() with { StartLocal = "23:00", EndLocal = "07:00", BypassSeverities = new[] { "critical" } };
        var display = QuietHoursProjection.Project(new[] { window }, draft: null, validationError: null, MondayNoon, Localizer);

        var row = Assert.Single(display.Rows);
        Assert.Equal("Enabled", row.StatusLabel);
        Assert.Equal(Core.StatusKind.Success, row.StatusKind);
        Assert.Equal("23:00 \u2192 07:00 (UTC)", row.Summary);
        Assert.Equal(7, row.Weekdays.Count);
        Assert.All(row.Weekdays, chip => Assert.True(chip.IsOn));
        Assert.Equal(new[] { "critical" }, row.BypassSeverities);
        Assert.Contains(row.Summary, row.AutomationName);
        Assert.Contains("Edit", row.EditAutomationName);
        Assert.Contains("Delete", row.DeleteAutomationName);
        Assert.Null(display.Form);
        Assert.True(display.ShowAddButton);
    }

    [Fact]
    public void Project_localizes_the_next_change_hint()
    {
        var window = NewWindow() with { StartLocal = "08:00", EndLocal = "18:00" };
        var display = QuietHoursProjection.Project(new[] { window }, null, null, MondayNoon, Localizer);
        Assert.Equal("ends at 18:00", Assert.Single(display.Rows).NextChangeLabel);
    }

    [Fact]
    public void Project_disabled_window_has_neutral_badge_and_no_hint()
    {
        var window = NewWindow() with { Enabled = false };
        var row = Assert.Single(QuietHoursProjection.Project(new[] { window }, null, null, MondayNoon, Localizer).Rows);
        Assert.Equal("Disabled", row.StatusLabel);
        Assert.Equal(Core.StatusKind.Neutral, row.StatusKind);
        Assert.Null(row.NextChangeLabel);
    }

    [Fact]
    public void Project_create_form_uses_add_title_and_full_toggle_sets()
    {
        var draft = QuietHoursDraft.CreateDefault("UTC");
        var display = QuietHoursProjection.Project(Array.Empty<QuietHoursWindow>(), draft, null, MondayNoon, Localizer);

        Assert.False(display.ShowAddButton);
        var form = Assert.IsType<QuietHoursFormDisplay>(display.Form);
        Assert.False(form.IsEdit);
        Assert.Equal("New quiet-hours window", form.Title);
        Assert.Equal("Create", form.SubmitLabel);
        Assert.Equal(7, form.WeekdayToggles.Count);
        Assert.Equal(3, form.SeverityToggles.Count);
        Assert.All(form.WeekdayToggles, t => Assert.False(string.IsNullOrEmpty(t.AutomationName)));
        Assert.All(form.SeverityToggles, t => Assert.False(string.IsNullOrEmpty(t.AutomationName)));
        Assert.True(form.SeverityToggles[0].IsOn); // critical seeded on
    }

    [Fact]
    public void Project_edit_form_uses_update_title()
    {
        var draft = QuietHoursDraft.FromWindow(NewWindow());
        var form = Assert.IsType<QuietHoursFormDisplay>(
            QuietHoursProjection.Project(new[] { NewWindow() }, draft, null, MondayNoon, Localizer).Form);
        Assert.True(form.IsEdit);
        Assert.Equal("Edit window", form.Title);
        Assert.Equal("Update", form.SubmitLabel);
    }

    [Fact]
    public void Project_surfaces_validation_error_on_the_form()
    {
        var form = Assert.IsType<QuietHoursFormDisplay>(
            QuietHoursProjection.Project(
                Array.Empty<QuietHoursWindow>(),
                QuietHoursDraft.CreateDefault("UTC"),
                "Start must be HH:MM (24-hour).",
                MondayNoon,
                Localizer).Form);
        Assert.Equal("Start must be HH:MM (24-hour).", form.ValidationError);
    }

    // ---- Adapter: QuietHoursSource over the cache-then-network engine -----------------------------------

    [Fact]
    public async Task Source_streams_loading_then_loaded_with_parsed_windows()
    {
        var api = new FakeApiClient().ReturnsValue(Json(
            "{\"windows\":[{\"id\":7,\"user_id\":\"u\",\"enabled\":true,\"start_local\":\"22:00\",\"end_local\":\"06:00\",\"timezone\":\"UTC\",\"weekdays\":127,\"bypass_severities\":[\"critical\"]}]}"));
        var source = NewSource(api);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loading, results[0].Status);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(7, Assert.Single(results[^1].Value!).Id);
        Assert.Equal("get_api_v1_notifications_quiet_hours", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task Source_maps_an_empty_window_array_to_empty()
    {
        var source = NewSource(new FakeApiClient().ReturnsValue(Json("{\"windows\":[]}")));
        var results = await Drain(source);
        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_replays_cache_then_network_on_second_read()
    {
        var api = new FakeApiClient()
            .ReturnsValue(Json("{\"windows\":[{\"id\":1,\"user_id\":\"u\",\"enabled\":true,\"start_local\":\"22:00\",\"end_local\":\"06:00\",\"timezone\":\"UTC\",\"weekdays\":127,\"bypass_severities\":[]}]}"))
            .ReturnsValue(Json("{\"windows\":[{\"id\":2,\"user_id\":\"u\",\"enabled\":true,\"start_local\":\"23:30\",\"end_local\":\"05:30\",\"timezone\":\"UTC\",\"weekdays\":127,\"bypass_severities\":[]}]}"));
        var source = NewSource(api);

        await Drain(source);
        var second = await Drain(source);

        Assert.Equal(LoadStatus.Cached, second[1].Status);
        Assert.Equal(1, Assert.Single(second[1].Value!).Id);
        Assert.Equal(LoadStatus.Loaded, second[^1].Status);
        Assert.Equal(2, Assert.Single(second[^1].Value!).Id);
    }

    [Fact]
    public async Task Source_creates_with_post_and_updates_with_patch_path()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{}")).ReturnsValue(Json("{}"));
        var source = NewSource(api);

        await source.SaveAsync(NewDraft());
        await source.SaveAsync(NewDraft() with { Id = 9 });

        Assert.Equal("post_api_v1_notifications_quiet_hours", api.Requests[0].OperationId);
        Assert.Null(api.Requests[0].PathParams);
        Assert.Equal("patch_api_v1_notifications_quiet_hours_id", api.Requests[1].OperationId);
        Assert.Equal("9", api.Requests[1].PathParams!["id"]);
    }

    [Fact]
    public async Task Source_deletes_with_id_path()
    {
        var api = new FakeApiClient().ReturnsValue(Json("{}"));
        await NewSource(api).DeleteAsync(5);

        Assert.Equal("delete_api_v1_notifications_quiet_hours_id", Assert.Single(api.Requests).OperationId);
        Assert.Equal("5", api.Requests[0].PathParams!["id"]);
    }

    // ---- ViewModel: cache-then-network state matrix ----------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_windows_into_the_loaded_state()
    {
        using var vm = NewViewModel(new FakeQuietHoursSource(
            RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Loading(),
            RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Loaded(new[] { NewWindow() }, DateTimeOffset.UtcNow)));

        await vm.LoadAsync();

        Assert.Equal(QuietHoursState.Loaded, vm.State);
        Assert.Single(vm.Windows);
        Assert.Single(vm.Display.Rows);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ViewModel_resolves_empty_to_empty_state(bool viaEmptyStatus)
    {
        var terminal = viaEmptyStatus
            ? RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Empty(DateTimeOffset.UtcNow)
            : RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Loaded(Array.Empty<QuietHoursWindow>(), DateTimeOffset.UtcNow);
        using var vm = NewViewModel(new FakeQuietHoursSource(terminal));

        await vm.LoadAsync();

        Assert.Equal(QuietHoursState.Empty, vm.State);
        Assert.Empty(vm.Display.Rows);
    }

    [Fact]
    public async Task ViewModel_shows_stale_chip_on_a_stale_cache()
    {
        using var vm = NewViewModel(new FakeQuietHoursSource(
            RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Cached(new[] { NewWindow() }, DateTimeOffset.UtcNow, stale: true)));

        await vm.LoadAsync();

        Assert.Equal(QuietHoursState.Stale, vm.State);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_falls_back_to_offline_cache()
    {
        var error = new RepositoryError(RepositoryErrorKind.Network, "down");
        using var vm = NewViewModel(new FakeQuietHoursSource(
            RepositoryResult<IReadOnlyList<QuietHoursWindow>>.OfflineCached(new[] { NewWindow() }, DateTimeOffset.UtcNow, error)));

        await vm.LoadAsync();

        Assert.Equal(QuietHoursState.Offline, vm.State);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_surfaces_a_hard_error()
    {
        using var vm = NewViewModel(new FakeQuietHoursSource(
            RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))));

        await vm.LoadAsync();

        Assert.Equal(QuietHoursState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    // ---- ViewModel: draft lifecycle + writes -----------------------------------------------------------

    [Fact]
    public void ViewModel_start_create_opens_a_default_form()
    {
        using var vm = NewViewModel(new FakeQuietHoursSource());
        vm.StartCreate();

        Assert.True(vm.HasDraft);
        Assert.NotNull(vm.Display.Form);
        Assert.False(vm.Display.ShowAddButton);
        Assert.False(vm.Display.Form!.IsEdit);
    }

    [Fact]
    public async Task ViewModel_start_edit_loads_the_existing_window()
    {
        var window = NewWindow() with { Id = 3, StartLocal = "01:00", EndLocal = "02:00" };
        using var vm = NewViewModel(new FakeQuietHoursSource(
            RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Loaded(new[] { window }, DateTimeOffset.UtcNow)));
        await vm.LoadAsync();

        vm.StartEdit(3);

        Assert.Equal(3, vm.Draft!.Id);
        Assert.True(vm.Display.Form!.IsEdit);
        vm.Cancel();
        Assert.False(vm.HasDraft);
    }

    [Fact]
    public void ViewModel_mutators_update_the_draft()
    {
        using var vm = NewViewModel(new FakeQuietHoursSource());
        vm.StartCreate();

        vm.SetStart("21:30");
        vm.SetEnd("05:15");
        vm.SetTimezone("Europe/Paris");
        vm.SetEnabled(false);
        vm.ToggleWeekday(1 << 0);
        vm.ToggleSeverity("warn");

        Assert.Equal("21:30", vm.Draft!.StartLocal);
        Assert.Equal("05:15", vm.Draft.EndLocal);
        Assert.Equal("Europe/Paris", vm.Draft.Timezone);
        Assert.False(vm.Draft.Enabled);
        Assert.False(QuietHoursWeekdayCatalog.IsOn(vm.Draft.Weekdays, 1 << 0));
        Assert.Contains("warn", vm.Draft.BypassSeverities);
    }

    [Fact]
    public async Task ViewModel_submit_rejects_an_invalid_draft_without_saving()
    {
        var source = new FakeQuietHoursSource();
        using var vm = NewViewModel(source);
        vm.StartCreate();
        vm.SetStart("not-a-time");

        await vm.SubmitAsync();

        Assert.Empty(source.Saved);
        Assert.Equal("Start must be HH:MM (24-hour).", vm.Display.Form!.ValidationError);
        Assert.True(vm.HasDraft);
    }

    [Fact]
    public async Task ViewModel_submit_creates_and_surfaces_the_created_toast()
    {
        var source = new FakeQuietHoursSource(
            RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Loaded(Array.Empty<QuietHoursWindow>(), DateTimeOffset.UtcNow));
        using var vm = NewViewModel(source);
        vm.StartCreate();

        await vm.SubmitAsync();

        Assert.Single(source.Saved);
        Assert.Null(source.Saved[0].Id);
        Assert.False(vm.HasDraft);
        Assert.Equal("Quiet hours window created", vm.Feedback!.Message);
        Assert.False(vm.Feedback.IsError);
    }

    [Fact]
    public async Task ViewModel_submit_updates_and_surfaces_the_updated_toast()
    {
        var window = NewWindow() with { Id = 4 };
        var source = new FakeQuietHoursSource(
            RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Loaded(new[] { window }, DateTimeOffset.UtcNow));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();
        vm.StartEdit(4);

        await vm.SubmitAsync();

        Assert.Equal(4, Assert.Single(source.Saved).Id);
        Assert.Equal("Quiet hours window updated", vm.Feedback!.Message);
    }

    [Fact]
    public async Task ViewModel_submit_surfaces_a_save_failure()
    {
        var source = new FakeQuietHoursSource { SaveError = new InvalidOperationException("nope") };
        using var vm = NewViewModel(source);
        vm.StartCreate();

        await vm.SubmitAsync();

        Assert.Equal("Failed to save quiet hours window", vm.Feedback!.Message);
        Assert.True(vm.Feedback.IsError);
        Assert.True(vm.HasDraft);
    }

    [Fact]
    public async Task ViewModel_delete_removes_and_surfaces_the_removed_toast()
    {
        var source = new FakeQuietHoursSource(
            RepositoryResult<IReadOnlyList<QuietHoursWindow>>.Loaded(Array.Empty<QuietHoursWindow>(), DateTimeOffset.UtcNow));
        using var vm = NewViewModel(source);

        await vm.DeleteAsync(11);

        Assert.Equal(11, Assert.Single(source.Deleted));
        Assert.Equal("Quiet hours window removed", vm.Feedback!.Message);
        Assert.False(vm.Feedback.IsError);
    }

    [Fact]
    public async Task ViewModel_delete_surfaces_a_failure()
    {
        var source = new FakeQuietHoursSource { DeleteError = new InvalidOperationException("nope") };
        using var vm = NewViewModel(source);

        await vm.DeleteAsync(11);

        Assert.Equal("Failed to delete quiet hours window", vm.Feedback!.Message);
        Assert.True(vm.Feedback.IsError);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var source = new FakeQuietHoursSource();
        Assert.Throws<ArgumentNullException>(() => new QuietHoursPanelViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new QuietHoursPanelViewModel(source, null!));
    }

    // ---- Diagnostics + registration --------------------------------------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new QuietHoursDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=QuietHoursPanel", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_the_stable_crud_operation_ids()
    {
        Assert.Equal("QuietHoursPanel", QuietHoursRegistration.Slug);
        Assert.Equal("get_api_v1_notifications_quiet_hours", QuietHoursRegistration.ListOperation);
        Assert.Equal("post_api_v1_notifications_quiet_hours", QuietHoursRegistration.CreateOperation);
        Assert.Equal("patch_api_v1_notifications_quiet_hours_id", QuietHoursRegistration.UpdateOperation);
        Assert.Equal("delete_api_v1_notifications_quiet_hours_id", QuietHoursRegistration.DeleteOperation);
    }

    // ---- Helpers / test doubles ------------------------------------------------------------------------

    private static QuietHoursWindow NewWindow() => new(
        Id: 1,
        UserId: "user",
        Enabled: true,
        StartLocal: "23:00",
        EndLocal: "07:00",
        Timezone: "UTC",
        Weekdays: QuietHoursWeekdayCatalog.AllWeekdays,
        BypassSeverities: new[] { "critical" });

    private static QuietHoursDraft NewDraft() => QuietHoursDraft.CreateDefault("UTC");

    private static QuietHoursPanelViewModel NewViewModel(IQuietHoursSource source) =>
        new(source, Localizer, () => MondayNoon);

    private static QuietHoursSource NewSource(FakeApiClient api) =>
        new(api, new CacheThenNetworkEngine(new InMemoryCacheStore()), new ApiClientOptions());

    private static async Task<List<RepositoryResult<IReadOnlyList<QuietHoursWindow>>>> Drain(IQuietHoursSource source)
    {
        var results = new List<RepositoryResult<IReadOnlyList<QuietHoursWindow>>>();
        await foreach (var result in source.StreamAsync())
        {
            results.Add(result);
        }

        return results;
    }

    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    private sealed class FakeQuietHoursSource : IQuietHoursSource
    {
        private RepositoryResult<IReadOnlyList<QuietHoursWindow>>[] _emissions;

        public FakeQuietHoursSource(params RepositoryResult<IReadOnlyList<QuietHoursWindow>>[] emissions) =>
            _emissions = emissions;

        public List<QuietHoursDraft> Saved { get; } = new();

        public List<long> Deleted { get; } = new();

        public Exception? SaveError { get; init; }

        public Exception? DeleteError { get; init; }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<QuietHoursWindow>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public Task SaveAsync(QuietHoursDraft draft, CancellationToken cancellationToken = default)
        {
            if (SaveError is not null)
            {
                return Task.FromException(SaveError);
            }

            Saved.Add(draft);
            return Task.CompletedTask;
        }

        public Task DeleteAsync(long id, CancellationToken cancellationToken = default)
        {
            if (DeleteError is not null)
            {
                return Task.FromException(DeleteError);
            }

            Deleted.Add(id);
            return Task.CompletedTask;
        }
    }
}
