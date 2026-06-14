using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SafetyPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/settings/pages/SafetyPage.tsx), the single <c>success</c> state the parity manifest declares, the
/// deterministic seven-row safety listing (web <c>SAFETY_ROWS</c>) with each row's value formatted exactly as the web
/// <c>renderValue</c>, the six manifest i18n keys, the registration metadata and the view-model's defaults-merged load
/// flow. The WinUI view is exercised by the app build; its per-region content is driven entirely by the
/// <see cref="SafetyDisplay"/> asserted here.
/// </summary>
public sealed class SafetyPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The six i18n keys the parity manifest requires the page to resolve (the exact web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "safetySettings.listing.changeHint",
        "safetySettings.listing.docsLink",
        "safetySettings.listing.subtitle",
        "safetySettings.listing.title",
        "safetySettings.pageSubtitle",
        "safetySettings.pageTitle",
    ];

    // The seven rows' title/description keys (web SAFETY_ROWS), reproduced for full-listing fidelity.
    private static readonly string[] RowStringKeys =
    [
        "safetySettings.rows.quietHoursEnabled.title",
        "safetySettings.rows.quietHoursEnabled.description",
        "safetySettings.rows.quietHoursStart.title",
        "safetySettings.rows.quietHoursStart.description",
        "safetySettings.rows.quietHoursEnd.title",
        "safetySettings.rows.quietHoursEnd.description",
        "safetySettings.rows.alertDigestMode.title",
        "safetySettings.rows.alertDigestMode.description",
        "safetySettings.rows.criticalFlashEnabled.title",
        "safetySettings.rows.criticalFlashEnabled.description",
        "safetySettings.rows.tabBadgeEnabled.title",
        "safetySettings.rows.tabBadgeEnabled.description",
        "safetySettings.rows.apiSuspended.title",
        "safetySettings.rows.apiSuspended.description",
    ];

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_nav_name()
    {
        Assert.Equal("SafetySettingsPage", SafetyPageRegistration.RouteName);
        Assert.Equal("settings/safety", SafetyPageRegistration.Route);
        Assert.Equal("SafetyPage", SafetyPageRegistration.Slug);
        Assert.Equal("get_api_v1_settings", SafetyPageRegistration.GetOperation);
    }

    [Fact]
    public void Registration_resolves_the_page_strings_with_web_defaults()
    {
        Assert.Equal("Safety settings", SafetyPageRegistration.Title(Localizer));
        Assert.Equal(
            "Notification quiet hours, alert digest mode, critical-flash signalling, tab-badge signalling, and the "
                + "API kill-switch. Use the links below each row to change a value.",
            SafetyPageRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Registration_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => SafetyPageRegistration.Title(null!));
        Assert.Throws<ArgumentNullException>(() => SafetyPageRegistration.Subtitle(null!));
    }

    // ---- Projection: strings + state -----------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SafetyProjection.Project(SafetyModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_every_row_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SafetyProjection.Project(SafetyModel.Initial, recorder);

        foreach (var key in RowStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_is_always_in_the_success_state()
    {
        var display = SafetyProjection.Project(SafetyModel.Initial, Localizer);

        Assert.Equal(SafetyState.Success, display.State);
    }

    [Fact]
    public void Projection_carries_the_listing_header_and_change_hint()
    {
        var display = SafetyProjection.Project(SafetyModel.Initial, Localizer);

        Assert.Equal("Safety settings", display.Title);
        Assert.Equal("Your safety-related settings", display.ListingTitle);
        Assert.Equal(
            "Each row shows the current value on this install and links to the canonical Settings page where you can "
                + "change it.",
            display.ListingSubtitle);
        Assert.Equal(
            "To change a value, open the main Settings page. This page is read-only and never changes a setting on "
                + "its own.",
            display.ChangeHint);
    }

    // ---- Projection: the seven-row listing (GlassPanel1) ----------------------------

    [Fact]
    public void Projection_lists_all_seven_rows_in_web_order()
    {
        var display = SafetyProjection.Project(SafetyModel.Initial, Localizer);

        Assert.Collection(
            display.Rows,
            r => Assert.Equal("safetySettings.rows.quietHoursEnabled.title", r.Key),
            r => Assert.Equal("safetySettings.rows.quietHoursStart.title", r.Key),
            r => Assert.Equal("safetySettings.rows.quietHoursEnd.title", r.Key),
            r => Assert.Equal("safetySettings.rows.alertDigestMode.title", r.Key),
            r => Assert.Equal("safetySettings.rows.criticalFlashEnabled.title", r.Key),
            r => Assert.Equal("safetySettings.rows.tabBadgeEnabled.title", r.Key),
            r => Assert.Equal("safetySettings.rows.apiSuspended.title", r.Key));
    }

    [Fact]
    public void Projection_formats_each_default_row_value_like_the_web_renderValue()
    {
        var display = SafetyProjection.Project(SafetyModel.Initial, Localizer);

        Assert.Equal("Off", Value(display, "safetySettings.rows.quietHoursEnabled.title"));
        Assert.Equal("22:00", Value(display, "safetySettings.rows.quietHoursStart.title"));
        Assert.Equal("07:00", Value(display, "safetySettings.rows.quietHoursEnd.title"));
        Assert.Equal("instant", Value(display, "safetySettings.rows.alertDigestMode.title"));
        Assert.Equal("On", Value(display, "safetySettings.rows.criticalFlashEnabled.title"));
        Assert.Equal("On", Value(display, "safetySettings.rows.tabBadgeEnabled.title"));
        Assert.Equal("Active", Value(display, "safetySettings.rows.apiSuspended.title"));
    }

    [Fact]
    public void Projection_reflects_overridden_setting_values()
    {
        var snapshot = SafetySettingsSnapshot.Default with
        {
            QuietHoursEnabled = true,
            AlertDigestMode = "daily",
            ApiSuspended = true,
            TabBadgeEnabled = false,
        };

        var display = SafetyProjection.Project(new SafetyModel(snapshot), Localizer);

        Assert.Equal("On", Value(display, "safetySettings.rows.quietHoursEnabled.title"));
        Assert.Equal("daily", Value(display, "safetySettings.rows.alertDigestMode.title"));
        Assert.Equal("Off", Value(display, "safetySettings.rows.tabBadgeEnabled.title"));
        Assert.Equal("Suspended", Value(display, "safetySettings.rows.apiSuspended.title"));
    }

    [Fact]
    public void Projection_renders_an_em_dash_for_a_blank_quiet_hours_window()
    {
        var snapshot = SafetySettingsSnapshot.Default with { QuietHoursStart = " " };

        var display = SafetyProjection.Project(new SafetyModel(snapshot), Localizer);

        Assert.Equal("\u2014", Value(display, "safetySettings.rows.quietHoursStart.title"));
    }

    [Fact]
    public void Projection_builds_absolute_docs_links_for_every_row()
    {
        var display = SafetyProjection.Project(SafetyModel.Initial, Localizer);

        foreach (var row in display.Rows)
        {
            Assert.Equal("Docs", row.DocsLabel);
            Assert.True(Uri.TryCreate(row.DocsUri, UriKind.Absolute, out _), $"docs uri not absolute: {row.DocsUri}");
            Assert.StartsWith(SafetyPageRegistration.DocsBaseUrl, row.DocsUri);
        }
    }

    [Fact]
    public void Projection_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => SafetyProjection.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => SafetyProjection.Project(SafetyModel.Initial, null!));
    }

    // ---- Snapshot parser -----------------------------------------------------------

    [Fact]
    public void Snapshot_defaults_match_the_web_default_settings()
    {
        var d = SafetySettingsSnapshot.Default;

        Assert.False(d.QuietHoursEnabled);
        Assert.Equal("22:00", d.QuietHoursStart);
        Assert.Equal("07:00", d.QuietHoursEnd);
        Assert.Equal("instant", d.AlertDigestMode);
        Assert.True(d.CriticalFlashEnabled);
        Assert.True(d.TabBadgeEnabled);
        Assert.False(d.ApiSuspended);
    }

    [Fact]
    public void Snapshot_parser_reads_a_bare_object_and_overrides_present_fields()
    {
        var json = JsonDocument.Parse(
            "{\"quiet_hours_enabled\":true,\"alert_digest_mode\":\"hourly\",\"api_suspended\":true}").RootElement;

        var snapshot = SafetySettingsSnapshot.FromJson(json);

        Assert.True(snapshot.QuietHoursEnabled);
        Assert.Equal("hourly", snapshot.AlertDigestMode);
        Assert.True(snapshot.ApiSuspended);
        // Absent fields keep their web defaults.
        Assert.Equal("22:00", snapshot.QuietHoursStart);
        Assert.True(snapshot.CriticalFlashEnabled);
    }

    [Fact]
    public void Snapshot_parser_unwraps_the_data_envelope()
    {
        var json = JsonDocument.Parse("{\"data\":{\"tab_badge_enabled\":false}}").RootElement;

        var snapshot = SafetySettingsSnapshot.FromJson(json);

        Assert.False(snapshot.TabBadgeEnabled);
    }

    [Fact]
    public void Snapshot_parser_falls_back_to_defaults_for_a_non_object()
    {
        var snapshot = SafetySettingsSnapshot.FromJson(JsonDocument.Parse("null").RootElement);

        Assert.Equal(SafetySettingsSnapshot.Default, snapshot);
    }

    // ---- View-model ----------------------------------------------------------------

    [Fact]
    public void ViewModel_starts_in_success_with_the_default_listing()
    {
        using var viewModel = new SafetyPageViewModel(EmptySafetySettingsSource.Instance, Localizer);

        Assert.Equal(SafetyState.Success, viewModel.State);
        Assert.Equal(7, viewModel.Display.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_stays_in_success_after_load()
    {
        using var viewModel = new SafetyPageViewModel(EmptySafetySettingsSource.Instance, Localizer);

        await viewModel.LoadAsync();

        Assert.Equal(SafetyState.Success, viewModel.State);
        Assert.False(viewModel.IsFetching);
        Assert.Equal(7, viewModel.Display.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_reprojects_with_the_loaded_setting_values()
    {
        var snapshot = SafetySettingsSnapshot.Default with { ApiSuspended = true };
        using var viewModel = new SafetyPageViewModel(new StubSource(snapshot), Localizer);

        await viewModel.LoadAsync();

        Assert.Equal("Suspended", Value(viewModel.Display, "safetySettings.rows.apiSuspended.title"));
    }

    [Fact]
    public async Task ViewModel_falls_back_to_defaults_when_the_read_fails()
    {
        using var viewModel = new SafetyPageViewModel(new ThrowingSource(), Localizer);

        await viewModel.LoadAsync();

        Assert.Equal(SafetyState.Success, viewModel.State);
        Assert.Equal("Active", Value(viewModel.Display, "safetySettings.rows.apiSuspended.title"));
    }

    [Fact]
    public void ViewModel_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new SafetyPageViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new SafetyPageViewModel(EmptySafetySettingsSource.Instance, null!));
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        using var viewModel = new SafetyPageViewModel(
            EmptySafetySettingsSource.Instance,
            Localizer,
            new SafetyPageDiagnostics(lines.Add));

        viewModel.NotifyOpened();

        Assert.Equal("view.opened slug=SafetyPage", Assert.Single(lines));
    }

    // ---- Default source ------------------------------------------------------------

    [Fact]
    public async Task EmptySafetySettingsSource_yields_the_web_defaults()
    {
        var snapshot = await EmptySafetySettingsSource.Instance.FetchAsync(default);

        Assert.Equal(SafetySettingsSnapshot.Default, snapshot);
    }

    // ---- Helpers -------------------------------------------------------------------

    private static string Value(SafetyDisplay display, string key) =>
        display.Rows.Single(row => row.Key == key).Value;

    private sealed class StubSource(SafetySettingsSnapshot snapshot) : ISafetySettingsSource
    {
        public Task<SafetySettingsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            Task.FromResult(snapshot);
    }

    private sealed class ThrowingSource : ISafetySettingsSource
    {
        public Task<SafetySettingsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("read failed");
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
