using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Automations;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AutomationCard</c> feature surface's UI-thread-free logic — the per-branch
/// projection (active / disabled / auto-disabled status and its precedence, the toggle state, the re-enable
/// menu branch, the firing chip, the description, the scoped-vehicle vs all-vehicles label, the last-run vs
/// never-run split, the runs / fails / next-fire chips, the auto-disabled reason banner, the warning-vs-info
/// conflicts and the pin vs unpin affordance), the bespoke relative-time tiers, the delete-dialog name
/// interpolation, the i18n key resolution (passthrough fallback and the resw <c>translation.*</c> catalog
/// form), the composed accessible name, the glyph map and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/automations/pages/AutomationCard.tsx). The WinUI view itself (AutomationCard.cs) is
/// exercised by the app build.
/// </summary>
public sealed class AutomationCardTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AutomationConflictModel Conflict(
        string name = "Nightly charge",
        string reason = "both set charge limit",
        string severity = "warning") =>
        new(name, reason, severity);

    private static AutomationCardModel Model(
        long id = 7,
        string name = "Precondition at 7am",
        string? description = "Warm the cabin before the commute",
        bool enabled = true,
        bool autoDisabled = false,
        string? autoDisabledReason = null,
        DateTimeOffset? lastTriggeredAt = null,
        long executionCount = 12,
        long failureCount = 0,
        DateTimeOffset? nextFireTime = null,
        IReadOnlyList<AutomationConflictModel>? conflicts = null,
        bool isFiring = false,
        string? vehicleName = "Model 3",
        bool isPinned = false) =>
        new(id, name, description, enabled, autoDisabled, autoDisabledReason,
            lastTriggeredAt, executionCount, failureCount, nextFireTime,
            conflicts ?? Array.Empty<AutomationConflictModel>(), isFiring, vehicleName, isPinned);

    private static AutomationCardDisplay Project(AutomationCardModel model) =>
        AutomationCardProjection.Project(model, Localizer, Now);

    // ── Status branch (web getUIStatus precedence + statusStyles) ───────────────────────────────────────

    [Fact]
    public void Active_automation_uses_the_success_badge()
    {
        var display = Project(Model(enabled: true, autoDisabled: false));

        Assert.Equal(AutomationUiStatus.Active, display.UiStatus);
        Assert.Equal("Active", display.StatusLabel);
        Assert.Equal(StatusKind.Success, display.StatusBadgeKind);
        Assert.False(display.IsAutoDisabled);
    }

    [Fact]
    public void Disabled_automation_uses_the_neutral_badge()
    {
        var display = Project(Model(enabled: false, autoDisabled: false));

        Assert.Equal(AutomationUiStatus.Disabled, display.UiStatus);
        Assert.Equal("Disabled", display.StatusLabel);
        Assert.Equal(StatusKind.Neutral, display.StatusBadgeKind);
        Assert.False(display.IsAutoDisabled);
    }

    [Fact]
    public void Auto_disabled_automation_uses_the_danger_badge()
    {
        var display = Project(Model(autoDisabled: true));

        Assert.Equal(AutomationUiStatus.AutoDisabled, display.UiStatus);
        Assert.Equal("Auto-Disabled", display.StatusLabel);
        Assert.Equal(StatusKind.Danger, display.StatusBadgeKind);
        Assert.True(display.IsAutoDisabled);
    }

    [Fact]
    public void Auto_disabled_wins_over_an_enabled_flag()
    {
        // Web getUIStatus checks auto_disabled before enabled.
        Assert.Equal(AutomationUiStatus.AutoDisabled, AutomationCardProjection.ResolveStatus(Model(enabled: true, autoDisabled: true)));
    }

    [Theory]
    [InlineData(AutomationUiStatus.Active, StatusKind.Success)]
    [InlineData(AutomationUiStatus.Disabled, StatusKind.Neutral)]
    [InlineData(AutomationUiStatus.AutoDisabled, StatusKind.Danger)]
    public void Status_badge_kind_matches_the_web_variant(AutomationUiStatus status, StatusKind expected) =>
        Assert.Equal(expected, AutomationCardProjection.StatusBadgeKind(status));

    // ── Toggle state (web checked={auto_disabled ? false : enabled}) ────────────────────────────────────

    [Fact]
    public void Toggle_is_on_for_an_active_automation() =>
        Assert.True(Project(Model(enabled: true, autoDisabled: false)).ToggleIsOn);

    [Fact]
    public void Toggle_is_off_for_a_disabled_automation() =>
        Assert.False(Project(Model(enabled: false, autoDisabled: false)).ToggleIsOn);

    [Fact]
    public void Toggle_is_forced_off_when_auto_disabled_even_if_enabled() =>
        Assert.False(Project(Model(enabled: true, autoDisabled: true)).ToggleIsOn);

    [Fact]
    public void Re_enable_menu_item_shows_only_when_auto_disabled()
    {
        Assert.True(Project(Model(autoDisabled: true)).ShowReEnableMenuItem);
        Assert.False(Project(Model(autoDisabled: false)).ShowReEnableMenuItem);
    }

    // ── Firing chip (web isFiring) ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Firing_automation_marks_the_firing_branch()
    {
        var display = Project(Model(isFiring: true));

        Assert.True(display.IsFiring);
        Assert.Equal("Firing", display.FiringLabel);
    }

    [Fact]
    public void Idle_automation_is_not_firing() =>
        Assert.False(Project(Model(isFiring: false)).IsFiring);

    // ── Description (web a.description &&) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Description_present_is_shown()
    {
        var display = Project(Model(description: "Warm the cabin"));

        Assert.True(display.HasDescription);
        Assert.Equal("Warm the cabin", display.Description);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Description_absent_is_hidden(string? description) =>
        Assert.False(Project(Model(description: description)).HasDescription);

    // ── Vehicle scope (web vehicleName ?? 'All vehicles') ───────────────────────────────────────────────

    [Fact]
    public void Scoped_vehicle_shows_its_name()
    {
        var display = Project(Model(vehicleName: "Model Y"));

        Assert.True(display.HasVehicleName);
        Assert.Equal("Model Y", display.VehicleLabel);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Missing_vehicle_shows_all_vehicles(string? vehicleName)
    {
        var display = Project(Model(vehicleName: vehicleName));

        Assert.False(display.HasVehicleName);
        Assert.Equal("All vehicles", display.VehicleLabel);
    }

    // ── Last-run vs never-run (web a.last_triggered_at ?) ───────────────────────────────────────────────

    [Fact]
    public void Last_triggered_shows_the_relative_last_run()
    {
        var display = Project(Model(lastTriggeredAt: Now.AddMinutes(-5)));

        Assert.True(display.ShowLastRun);
        Assert.Equal("Last: 5m ago", display.LastRunText);
    }

    [Fact]
    public void Never_triggered_shows_never_run()
    {
        var display = Project(Model(lastTriggeredAt: null));

        Assert.False(display.ShowLastRun);
        Assert.Equal("Never run", display.NeverRunLabel);
    }

    // ── Runs + fails chips (web execution_count / failure_count) ────────────────────────────────────────

    [Fact]
    public void Runs_text_carries_the_execution_count() =>
        Assert.Equal("Runs: 12", Project(Model(executionCount: 12)).RunsText);

    [Fact]
    public void Failures_chip_shows_when_failures_exist()
    {
        var display = Project(Model(failureCount: 3));

        Assert.True(display.ShowFails);
        Assert.Equal("Fails: 3", display.FailsText);
    }

    [Fact]
    public void Failures_chip_hidden_when_no_failures()
    {
        var display = Project(Model(failureCount: 0));

        Assert.False(display.ShowFails);
        Assert.Equal(string.Empty, display.FailsText);
    }

    // ── Next-fire chip (web a.next_fire_time) ───────────────────────────────────────────────────────────

    [Fact]
    public void Next_fire_chip_shows_when_scheduled()
    {
        var display = Project(Model(nextFireTime: Now.AddHours(3)));

        Assert.True(display.ShowNextFire);
        Assert.StartsWith("Next: ", display.NextFireText, StringComparison.Ordinal);
        Assert.True(display.NextFireText.Length > "Next: ".Length);
    }

    [Fact]
    public void Next_fire_chip_hidden_when_unscheduled()
    {
        var display = Project(Model(nextFireTime: null));

        Assert.False(display.ShowNextFire);
        Assert.Equal(string.Empty, display.NextFireText);
    }

    // ── Auto-disabled reason banner (web a.auto_disabled && a.auto_disabled_reason) ─────────────────────

    [Fact]
    public void Auto_disabled_with_reason_shows_the_banner()
    {
        var display = Project(Model(autoDisabled: true, autoDisabledReason: "5 consecutive failures"));

        Assert.True(display.ShowAutoDisabledReason);
        Assert.Equal("5 consecutive failures", display.AutoDisabledReason);
    }

    [Fact]
    public void Auto_disabled_without_reason_hides_the_banner() =>
        Assert.False(Project(Model(autoDisabled: true, autoDisabledReason: null)).ShowAutoDisabledReason);

    [Fact]
    public void Reason_without_auto_disabled_hides_the_banner() =>
        Assert.False(Project(Model(autoDisabled: false, autoDisabledReason: "stale")).ShowAutoDisabledReason);

    // ── Conflicts (web conflicts + severity warning/info) ───────────────────────────────────────────────

    [Fact]
    public void No_conflicts_projects_an_empty_list() =>
        Assert.Empty(Project(Model(conflicts: Array.Empty<AutomationConflictModel>())).Conflicts);

    [Fact]
    public void Warning_conflict_is_flagged_as_warning()
    {
        var display = Project(Model(conflicts: new[] { Conflict(severity: "warning") }));

        var conflict = Assert.Single(display.Conflicts);
        Assert.True(conflict.IsWarning);
    }

    [Fact]
    public void Info_conflict_is_not_flagged_as_warning()
    {
        var display = Project(Model(conflicts: new[] { Conflict(severity: "info") }));

        var conflict = Assert.Single(display.Conflicts);
        Assert.False(conflict.IsWarning);
    }

    [Fact]
    public void Conflict_text_composes_prefix_name_and_reason()
    {
        var display = Project(Model(conflicts: new[] { Conflict(name: "Nightly charge", reason: "both cap SoC") }));

        var conflict = Assert.Single(display.Conflicts);
        Assert.Equal("Conflict with \"Nightly charge\" — both cap SoC", conflict.Text);
    }

    [Fact]
    public void Multiple_conflicts_are_all_projected()
    {
        var display = Project(Model(conflicts: new[]
        {
            Conflict(name: "A", severity: "warning"),
            Conflict(name: "B", severity: "info"),
        }));

        Assert.Equal(2, display.Conflicts.Count);
        Assert.True(display.Conflicts[0].IsWarning);
        Assert.False(display.Conflicts[1].IsWarning);
    }

    // ── Pin affordance (web PinButton isPinned) ─────────────────────────────────────────────────────────

    [Fact]
    public void Pinned_automation_offers_unpin()
    {
        var display = Project(Model(isPinned: true));

        Assert.True(display.IsPinned);
        Assert.Equal("Unpin", display.PinLabel);
    }

    [Fact]
    public void Unpinned_automation_offers_pin()
    {
        var display = Project(Model(isPinned: false));

        Assert.False(display.IsPinned);
        Assert.Equal("Pin", display.PinLabel);
    }

    [Fact]
    public void Pin_glyph_tracks_the_pinned_state()
    {
        Assert.Equal(AutomationCardRegistration.UnpinGlyph, AutomationCardRegistration.PinGlyphFor(true));
        Assert.Equal(AutomationCardRegistration.PinGlyph, AutomationCardRegistration.PinGlyphFor(false));
    }

    // ── Relative time (web bespoke timeAgo tiers) ───────────────────────────────────────────────────────

    [Fact]
    public void Time_ago_is_em_dash_for_null() =>
        Assert.Equal("\u2014", AutomationCardProjection.FormatTimeAgo(null, Now));

    [Fact]
    public void Time_ago_under_a_minute_is_just_now() =>
        Assert.Equal("just now", AutomationCardProjection.FormatTimeAgo(Now.AddSeconds(-30), Now));

    [Theory]
    [InlineData(1, "1m ago")]
    [InlineData(59, "59m ago")]
    public void Time_ago_under_an_hour_is_minutes(int minutesAgo, string expected) =>
        Assert.Equal(expected, AutomationCardProjection.FormatTimeAgo(Now.AddMinutes(-minutesAgo), Now));

    [Theory]
    [InlineData(60, "1h ago")]
    [InlineData(1439, "23h ago")]
    public void Time_ago_under_a_day_is_hours(int minutesAgo, string expected) =>
        Assert.Equal(expected, AutomationCardProjection.FormatTimeAgo(Now.AddMinutes(-minutesAgo), Now));

    [Theory]
    [InlineData(1, "1d ago")]
    [InlineData(9, "9d ago")]
    public void Time_ago_a_day_or_more_is_days(int daysAgo, string expected) =>
        Assert.Equal(expected, AutomationCardProjection.FormatTimeAgo(Now.AddDays(-daysAgo), Now));

    // ── Delete dialog (web ConfirmDialog name interpolation) ────────────────────────────────────────────

    [Fact]
    public void Delete_dialog_carries_the_web_copy()
    {
        var display = Project(Model(name: "Precondition"));

        Assert.Equal("Delete Automation", display.DeleteTitle);
        Assert.Equal("Delete", display.DeleteConfirmLabel);
        Assert.Equal("Cancel", display.CancelLabel);
        Assert.Equal("Are you sure you want to delete \"Precondition\"? This cannot be undone.", display.DeleteMessage);
    }

    // ── Labels resolve through the i18n facade to the web English fallbacks ─────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_english_fallbacks()
    {
        var display = Project(Model(autoDisabled: false));

        Assert.Equal("Firing", display.FiringLabel);
        Assert.Equal("Toggle automation", display.ToggleLabel);
        Assert.Equal("Actions menu", display.MenuLabel);
        Assert.Equal("Test Run", display.TestRunLabel);
        Assert.Equal("Re-enable", display.ReEnableLabel);
        Assert.Equal("Duplicate", display.DuplicateLabel);
        Assert.Equal("Export", display.ExportLabel);
        Assert.Equal("Delete", display.DeleteLabel);
    }

    [Fact]
    public void Labels_resolve_from_the_resw_catalog_keys()
    {
        // Production resolves the catalog's translation.* keys; the projection must feed those exact keys.
        var display = AutomationCardProjection.Project(
            Model(autoDisabled: true, autoDisabledReason: "stale", isPinned: true, vehicleName: null, lastTriggeredAt: null),
            new ReswLocalizer(),
            Now);

        Assert.Equal("Auto-Disabled", display.StatusLabel);
        Assert.Equal("All vehicles", display.VehicleLabel);
        Assert.Equal("Never run", display.NeverRunLabel);
        Assert.Equal("Unpin", display.PinLabel);
        Assert.Equal("Delete Automation", display.DeleteTitle);
        Assert.Equal("Cancel", display.CancelLabel);
    }

    // ── Accessibility: a single, meaningful composed Narrator name per card ─────────────────────────────

    [Fact]
    public void Automation_name_carries_name_status_vehicle_and_stats()
    {
        var display = Project(Model(
            name: "Precondition at 7am",
            enabled: true,
            autoDisabled: false,
            vehicleName: "Model 3",
            lastTriggeredAt: Now.AddMinutes(-5),
            executionCount: 12));

        Assert.Contains("Precondition at 7am", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Active", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Model 3", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Last: 5m ago", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Runs: 12", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Automation_name_includes_the_auto_disabled_reason()
    {
        var display = Project(Model(autoDisabled: true, autoDisabledReason: "5 consecutive failures"));

        Assert.Contains("Auto-Disabled", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5 consecutive failures", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Automation_name_includes_conflicts()
    {
        var display = Project(Model(conflicts: new[] { Conflict(name: "Nightly charge", reason: "both cap SoC") }));

        Assert.Contains("Conflict with \"Nightly charge\" — both cap SoC", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Automation_name_includes_never_run_when_never_triggered() =>
        Assert.Contains("Never run", Project(Model(lastTriggeredAt: null)).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Every_branch_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(Model(enabled: true, autoDisabled: false)),
                Project(Model(enabled: false)),
                Project(Model(autoDisabled: true, autoDisabledReason: "stale")),
                Project(Model(isFiring: true, failureCount: 2, nextFireTime: Now.AddHours(1))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    // ── Glyph map (web Lucide -> Segoe Fluent) ──────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_action_glyphs()
    {
        Assert.False(string.IsNullOrEmpty(AutomationCardRegistration.FiringGlyph));
        Assert.False(string.IsNullOrEmpty(AutomationCardRegistration.MenuGlyph));
        Assert.False(string.IsNullOrEmpty(AutomationCardRegistration.TestRunGlyph));
        Assert.False(string.IsNullOrEmpty(AutomationCardRegistration.ReEnableGlyph));
        Assert.False(string.IsNullOrEmpty(AutomationCardRegistration.DeleteGlyph));
        Assert.NotEqual(AutomationCardRegistration.PinGlyph, AutomationCardRegistration.UnpinGlyph);
    }

    // ── Diagnostics (P1/S11): view.opened slug=AutomationCard, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new AutomationCardDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AutomationCard", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_automation_content()
    {
        var captured = new List<string>();
        var diagnostics = new AutomationCardDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("Precondition", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Model 3", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("AutomationCard", AutomationCardRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => AutomationCardProjection.Project(null!, Localizer, Now));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => AutomationCardProjection.Project(Model(), null!, Now));

    /// <summary>
    /// An <see cref="ILocalizer"/> that resolves the card's <c>translation.*</c> keys to the
    /// <c>Strings/{lang}/Resources.resw</c> English catalog values (as production does), and the English
    /// fallback for every other key — proving the projection feeds the exact catalog keys.
    /// </summary>
    private sealed class ReswLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            AutomationCardProjection.StatusActiveKey => "Active",
            AutomationCardProjection.StatusDisabledKey => "Disabled",
            AutomationCardProjection.StatusAutoDisabledKey => "Auto-Disabled",
            AutomationCardProjection.AllVehiclesKey => "All vehicles",
            AutomationCardProjection.NeverRunKey => "Never run",
            AutomationCardProjection.UnpinKey => "Unpin",
            AutomationCardProjection.DeleteTitleKey => "Delete Automation",
            AutomationCardProjection.CancelKey => "Cancel",
            _ => fallback,
        };
    }
}
