using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ResetSection's UI-thread-free logic — the <c>POST /settings/reset</c> receipt
/// parser (the web mutation adapter), the contract-client-backed source's request shape, the section / deny-list
/// / confirm-copy / success-detail projections, the state-holder view-model's per-section and danger-zone reset
/// flows (idle / confirming / busy / success / error and the typed-confirmation gate), the i18n key + fallback
/// contract, the Narrator-label sources, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/ResetSection.tsx + web/src/api/hooks/useSettingsReset.ts). The WinUI
/// view itself (ResetSection.cs) is exercised by the app build.
/// </summary>
public sealed class ResetSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Adapter: POST /settings/reset receipt parser (web SettingsResetResult) ───────────────────────────

    [Fact]
    public void Parse_reads_count_and_ordered_sections()
    {
        const string json = """
        {"reset":12,"sections":[{"section":"general","reset":4},{"section":"alert_rules","reset":8}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var result = SettingsResetResultParser.Parse(doc.RootElement);

        Assert.Equal(12, result.Reset);
        Assert.Equal(2, result.Sections.Count);
        Assert.Equal("general", result.Sections[0].Section);
        Assert.Equal(4, result.Sections[0].Reset);
        Assert.Equal("alert_rules", result.Sections[1].Section);
        Assert.Equal(8, result.Sections[1].Reset);
    }

    [Fact]
    public void Parse_empty_object_yields_zero_and_no_sections()
    {
        using var doc = JsonDocument.Parse("{}");
        var result = SettingsResetResultParser.Parse(doc.RootElement);

        Assert.Equal(0, result.Reset);
        Assert.Empty(result.Sections);
    }

    [Theory]
    [InlineData("5")]
    [InlineData("null")]
    [InlineData("\"x\"")]
    [InlineData("[]")]
    public void Parse_non_object_yields_empty(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var result = SettingsResetResultParser.Parse(doc.RootElement);

        Assert.Equal(0, result.Reset);
        Assert.Empty(result.Sections);
    }

    [Fact]
    public void Parse_is_tolerant_of_missing_and_mistyped_members()
    {
        const string json = """
        {"reset":"oops","sections":[{"reset":3},{"section":"geofences"},5,{"section":"automations","reset":2}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var result = SettingsResetResultParser.Parse(doc.RootElement);

        Assert.Equal(0, result.Reset);                  // non-numeric reset coalesces to 0
        Assert.Equal(3, result.Sections.Count);         // the bare "5" entry is skipped
        Assert.Equal(string.Empty, result.Sections[0].Section);
        Assert.Equal(3, result.Sections[0].Reset);
        Assert.Equal("geofences", result.Sections[1].Section);
        Assert.Equal(0, result.Sections[1].Reset);
        Assert.Equal("automations", result.Sections[2].Section);
        Assert.Equal(2, result.Sections[2].Reset);
    }

    // ── Source: request shape (web POST /settings/reset { section } / {}) ────────────────────────────────

    [Fact]
    public async Task ResetSectionAsync_posts_the_section_body_and_parses_the_receipt()
    {
        var api = new FakeApiClient { Response = """{"reset":3,"sections":[{"section":"alert_rules","reset":3}]}""" };
        var source = new SettingsResetSource(api);

        var result = await source.ResetSectionAsync("alert_rules");

        Assert.NotNull(api.Last);
        Assert.Equal("post_api_v1_settings_reset", api.Last!.OperationId);
        Assert.Equal("""{"section":"alert_rules"}""", Serialize(api.Last.Body));
        Assert.Equal(3, result.Reset);
        Assert.Single(result.Sections);
    }

    [Fact]
    public async Task ResetAllAsync_posts_an_empty_body()
    {
        var api = new FakeApiClient { Response = """{"reset":0,"sections":[]}""" };
        var source = new SettingsResetSource(api);

        await source.ResetAllAsync();

        Assert.NotNull(api.Last);
        Assert.Equal("post_api_v1_settings_reset", api.Last!.OperationId);
        Assert.Equal("{}", Serialize(api.Last.Body));
    }

    [Fact]
    public async Task ResetSectionAsync_rejects_a_blank_section()
    {
        var source = new SettingsResetSource(new FakeApiClient());
        await Assert.ThrowsAsync<ArgumentException>(() => source.ResetSectionAsync(string.Empty));
    }

    // ── Projection: section / deny-list rows + copy interpolation ────────────────────────────────────────

    [Fact]
    public void Sections_are_the_eight_whitelisted_rows_in_web_order()
    {
        var rows = ResetSectionProjection.Sections(Localizer);

        Assert.Equal(
            ["general", "appearance", "alert_rules", "geofences", "notification_channels", "dashboard_layout", "automations", "quiet_hours"],
            rows.Select(r => r.Id).ToArray());
        Assert.All(rows, r => Assert.False(string.IsNullOrWhiteSpace(r.Title)));
        Assert.All(rows, r => Assert.False(string.IsNullOrWhiteSpace(r.Description)));
        Assert.All(rows, r => Assert.False(string.IsNullOrWhiteSpace(r.Glyph)));
    }

    [Fact]
    public void DeniedRows_are_the_two_deny_list_rows()
    {
        var rows = ResetSectionProjection.DeniedRows(Localizer);

        Assert.Equal(["tariffs", "sound_prefs"], rows.Select(r => r.Id).ToArray());
        Assert.Equal("Charge cost tariffs", rows[0].Title);
        Assert.Equal("Notification sound preferences", rows[1].Title);
        Assert.All(rows, r => Assert.False(string.IsNullOrWhiteSpace(r.Reason)));
    }

    [Fact]
    public void SectionConfirmTitle_and_message_interpolate_the_row()
    {
        var row = new ResetSectionRow("alert_rules", "Alert rules", "Delete every alert rule you have authored.", "\uEA8F");

        Assert.Equal("Reset Alert rules?", ResetSectionProjection.SectionConfirmTitle(row, Localizer));
        Assert.Equal(
            "Delete every alert rule you have authored. This action is permanent.",
            ResetSectionProjection.SectionConfirmMessage(row, Localizer));
    }

    [Theory]
    [InlineData(12, 2, "12 item(s) reset across 2 section(s).")]
    [InlineData(0, 0, "0 item(s) reset across 0 section(s).")]
    [InlineData(1, 1, "1 item(s) reset across 1 section(s).")]
    public void SuccessDetail_interpolates_count_and_sections(int count, int sections, string expected) =>
        Assert.Equal(expected, ResetSectionProjection.SuccessDetail(count, sections, Localizer));

    [Theory]
    [InlineData("RESET", true)]
    [InlineData("reset", false)]
    [InlineData("Reset", false)]
    [InlineData(" RESET ", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsTypedConfirmationSatisfied_requires_exact_RESET(string? input, bool expected) =>
        Assert.Equal(expected, ResetSectionProjection.IsTypedConfirmationSatisfied(input));

    // ── View-model: initial (idle) state ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_renders_the_static_list_with_no_dialog_or_status()
    {
        using var vm = NewViewModel(new FakeResetSource());

        Assert.Equal(8, vm.Sections.Count);
        Assert.Equal(2, vm.DeniedRows.Count);
        Assert.Null(vm.PendingSection);
        Assert.False(vm.IsSectionConfirmOpen);
        Assert.False(vm.IsResetAllOpen);
        Assert.False(vm.IsBusy);
        Assert.Null(vm.StatusMessage);
    }

    // ── View-model: per-section confirm + reset flow ─────────────────────────────────────────────────────

    [Fact]
    public void RequestSectionReset_opens_the_dialog_without_calling_the_source()
    {
        var source = new FakeResetSource();
        using var vm = NewViewModel(source);

        vm.RequestSectionReset(vm.Sections[2]); // alert_rules

        Assert.True(vm.IsSectionConfirmOpen);
        Assert.Equal("alert_rules", vm.PendingSection?.Id);
        Assert.Equal("Reset Alert rules?", vm.SectionConfirmTitle);
        Assert.Empty(source.Calls);
    }

    [Fact]
    public void CancelSectionReset_closes_the_dialog_without_calling_the_source()
    {
        var source = new FakeResetSource();
        using var vm = NewViewModel(source);
        vm.RequestSectionReset(vm.Sections[2]);

        vm.CancelSectionReset();

        Assert.False(vm.IsSectionConfirmOpen);
        Assert.Null(vm.PendingSection);
        Assert.Empty(source.Calls);
    }

    [Fact]
    public async Task ConfirmSectionResetAsync_posts_the_section_and_announces_success()
    {
        var diagEvents = new List<string>();
        var source = new FakeResetSource
        {
            Result = new SettingsResetResult(3, [new SettingsResetSectionResult("alert_rules", 3)]),
        };
        using var vm = NewViewModel(source, new ResetSectionDiagnostics(diagEvents.Add));
        vm.RequestSectionReset(vm.Sections[2]);

        await vm.ConfirmSectionResetAsync();

        Assert.Equal(["alert_rules"], source.Calls);
        Assert.False(vm.IsSectionConfirmOpen);
        Assert.False(vm.IsSectionBusy);
        Assert.Null(vm.PendingSection);
        Assert.False(vm.StatusIsError);
        Assert.Equal("3 item(s) reset across 1 section(s).", vm.StatusMessage);
        Assert.Contains("settings.reset.section slug=ResetSection", diagEvents);
    }

    [Fact]
    public async Task ConfirmSectionResetAsync_posts_the_geofences_section()
    {
        var source = new FakeResetSource
        {
            Result = new SettingsResetResult(1, [new SettingsResetSectionResult("geofences", 1)]),
        };
        using var vm = NewViewModel(source);
        vm.RequestSectionReset(vm.Sections[3]); // geofences

        await vm.ConfirmSectionResetAsync();

        Assert.Equal(["geofences"], source.Calls);
    }

    [Fact]
    public async Task ConfirmSectionResetAsync_surfaces_an_error_line_on_failure()
    {
        var source = new FakeResetSource { Failure = new InvalidOperationException("boom") };
        using var vm = NewViewModel(source);
        vm.RequestSectionReset(vm.Sections[0]);

        await vm.ConfirmSectionResetAsync();

        Assert.True(vm.StatusIsError);
        Assert.Equal("Failed to reset section", vm.StatusMessage);
        Assert.False(vm.IsSectionBusy);
        Assert.Null(vm.PendingSection);
    }

    [Fact]
    public async Task ConfirmSectionResetAsync_swallows_a_cancellation()
    {
        var source = new FakeResetSource { Failure = new OperationCanceledException() };
        using var vm = NewViewModel(source);
        vm.RequestSectionReset(vm.Sections[0]);

        await vm.ConfirmSectionResetAsync();

        Assert.Null(vm.StatusMessage);
        Assert.False(vm.StatusIsError);
    }

    [Fact]
    public async Task ConfirmSectionResetAsync_without_a_pending_section_is_a_no_op()
    {
        var source = new FakeResetSource();
        using var vm = NewViewModel(source);

        await vm.ConfirmSectionResetAsync();

        Assert.Empty(source.Calls);
    }

    [Fact]
    public void IsBusyForSection_targets_only_the_pending_row()
    {
        var source = new FakeResetSource();
        using var vm = NewViewModel(source);
        vm.RequestSectionReset(vm.Sections[2]); // alert_rules

        // Not busy yet (dialog only open); once a reset is in flight the pending row reports busy.
        Assert.False(vm.IsBusyForSection(vm.Sections[2]));
        Assert.False(vm.IsBusyForSection(vm.Sections[0]));
    }

    // ── View-model: danger-zone flow ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void RequestResetAll_opens_the_typed_confirm_dialog()
    {
        using var vm = NewViewModel(new FakeResetSource());

        vm.RequestResetAll();

        Assert.True(vm.IsResetAllOpen);
    }

    [Fact]
    public async Task ConfirmResetAllAsync_posts_the_global_reset_and_announces_success()
    {
        var diagEvents = new List<string>();
        var source = new FakeResetSource
        {
            Result = new SettingsResetResult(12, [
                new SettingsResetSectionResult("general", 4),
                new SettingsResetSectionResult("alert_rules", 8),
            ]),
        };
        using var vm = NewViewModel(source, new ResetSectionDiagnostics(diagEvents.Add));
        vm.RequestResetAll();

        await vm.ConfirmResetAllAsync();

        Assert.Equal([null], source.Calls); // null marks the all-reset call
        Assert.False(vm.IsResetAllOpen);
        Assert.False(vm.IsResetAllBusy);
        Assert.False(vm.StatusIsError);
        Assert.Equal("12 item(s) reset across 2 section(s).", vm.StatusMessage);
        Assert.Contains("settings.reset.all slug=ResetSection", diagEvents);
    }

    [Fact]
    public async Task ConfirmResetAllAsync_surfaces_an_error_line_on_failure()
    {
        var source = new FakeResetSource { Failure = new InvalidOperationException("boom") };
        using var vm = NewViewModel(source);
        vm.RequestResetAll();

        await vm.ConfirmResetAllAsync();

        Assert.True(vm.StatusIsError);
        Assert.Equal("Failed to reset all settings", vm.StatusMessage);
    }

    [Fact]
    public void CancelResetAll_closes_the_dialog()
    {
        using var vm = NewViewModel(new FakeResetSource());
        vm.RequestResetAll();

        vm.CancelResetAll();

        Assert.False(vm.IsResetAllOpen);
    }

    // ── i18n key + fallback contract ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Every_surface_string_resolves_through_a_keyed_call()
    {
        var recorder = new RecordingLocalizer();

        _ = ResetSectionProjection.Sections(recorder);
        _ = ResetSectionProjection.DeniedRows(recorder);
        _ = ResetSectionRegistration.Title(recorder);
        _ = ResetSectionRegistration.Subtitle(recorder);
        _ = ResetSectionRegistration.DangerZoneCta(recorder);
        _ = ResetSectionRegistration.AllConfirmTitle(recorder);
        _ = ResetSectionRegistration.TypedConfirmationLabel(recorder);
        _ = ResetSectionRegistration.SuccessDetailTemplate(recorder);

        Assert.Contains("settingsReset.title", recorder.Keys);
        Assert.Contains("settingsReset.section.general.title", recorder.Keys);
        Assert.Contains("settingsReset.section.notificationChannels.desc", recorder.Keys);
        Assert.Contains("settingsReset.denied.soundPrefs.reason", recorder.Keys);
        Assert.Contains("settingsReset.dangerZone.cta", recorder.Keys);
        Assert.Contains("settingsReset.confirm.allTitle", recorder.Keys);
        Assert.Contains("settingsReset.confirm.typedLabel", recorder.Keys);
        Assert.Contains("settingsReset.toasts.successDetail", recorder.Keys);
        Assert.All(recorder.Keys, k => Assert.StartsWith("settingsReset.", k, StringComparison.Ordinal));
    }

    // ── Accessibility: every interactive element has a non-empty Narrator-name source ────────────────────

    [Fact]
    public void Every_interactive_label_source_is_non_empty()
    {
        using var vm = NewViewModel(new FakeResetSource());

        Assert.False(string.IsNullOrWhiteSpace(vm.ResetActionLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.DangerZoneCta));
        Assert.False(string.IsNullOrWhiteSpace(vm.ConfirmLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.CancelLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.AllConfirmLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.TypedConfirmationLabel));
        Assert.All(vm.Sections, r => Assert.False(string.IsNullOrWhiteSpace(r.Title)));
        Assert.All(vm.DeniedRows, r => Assert.False(string.IsNullOrWhiteSpace(r.Title)));
    }

    // ── Diagnostics (P1/S11 view.opened contract, PII-safe) ──────────────────────────────────────────────

    [Fact]
    public void RecordViewOpened_emits_the_slugged_view_opened_event()
    {
        var events = new List<string>();
        var diagnostics = new ResetSectionDiagnostics(events.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=ResetSection", events);
    }

    [Fact]
    public void NotifyOpened_records_a_view_open()
    {
        var events = new List<string>();
        using var vm = NewViewModel(new FakeResetSource(), new ResetSectionDiagnostics(events.Add));

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=ResetSection", events);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static ResetSectionViewModel NewViewModel(
        ISettingsResetSource source,
        ResetSectionDiagnostics? diagnostics = null) =>
        new(source, Localizer, diagnostics);

    private static string Serialize(object? body) => JsonSerializer.Serialize(body);

    private sealed class FakeResetSource : ISettingsResetSource
    {
        public List<string?> Calls { get; } = [];

        public SettingsResetResult Result { get; set; } = SettingsResetResult.Empty;

        public Exception? Failure { get; set; }

        public Task<SettingsResetResult> ResetSectionAsync(string section, CancellationToken cancellationToken = default)
        {
            Calls.Add(section);
            return Failure is { } error
                ? Task.FromException<SettingsResetResult>(error)
                : Task.FromResult(Result);
        }

        public Task<SettingsResetResult> ResetAllAsync(CancellationToken cancellationToken = default)
        {
            Calls.Add(null);
            return Failure is { } error
                ? Task.FromException<SettingsResetResult>(error)
                : Task.FromResult(Result);
        }
    }

    private sealed class FakeApiClient : IApiClient
    {
        public ApiRequest? Last { get; private set; }

        public string Response { get; set; } = "{}";

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException();

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            Last = request;
            using var doc = JsonDocument.Parse(Response);
            object element = doc.RootElement.Clone();
            return Task.FromResult((T)element);
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
