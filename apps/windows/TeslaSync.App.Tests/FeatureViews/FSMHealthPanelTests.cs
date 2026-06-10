using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Fsm;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>FSMHealthPanel</c> feature surface's UI-thread-free logic — the branch
/// projection (all-clear vs. alerts), the three detectors (flap / stuck / recovery), the web's alert ordering and
/// "first flapping FSM" count snapshot, the <c>computeFlapIds</c> union, the severity → status / glyph / token-key
/// mapping, the localized + interpolated copy, the accessible names, the catalog-key flow, and the diagnostics.
/// Mirrors the web spec (web/src/features/system/components/FSMHealthPanel.tsx). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class FSMHealthPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Fixed reference instant; the stuck-session age is measured against it.
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 0, 0, TimeSpan.Zero);

    private const string AllClearCopy =
        "All FSMs healthy \u2014 no flapping, stuck sessions, or recoveries detected";

    private static FsmHealthTransition Tr(
        long id = 1,
        long vehicleId = 1,
        string ts = "2026-06-08T12:00:00Z",
        string fsm = "vehicle",
        string toState = "online") =>
        new(id, vehicleId, ts, fsm, toState);

    private static FsmHealthPanelDisplay Project(params FsmHealthTransition[] transitions) =>
        FsmHealthPanelProjection.Project(new FsmHealthPanelModel(transitions), Localizer, Now);

    // Six same-FSM transitions inside one minute (web count > 5 ⇒ all flapped).
    private static FsmHealthTransition[] FlappingGroup(string fsm, long firstId) =>
    [
        Tr(firstId + 0, fsm: fsm, toState: "online", ts: "2026-06-08T12:00:00Z"),
        Tr(firstId + 1, fsm: fsm, toState: "online", ts: "2026-06-08T12:00:10Z"),
        Tr(firstId + 2, fsm: fsm, toState: "online", ts: "2026-06-08T12:00:20Z"),
        Tr(firstId + 3, fsm: fsm, toState: "online", ts: "2026-06-08T12:00:30Z"),
        Tr(firstId + 4, fsm: fsm, toState: "online", ts: "2026-06-08T12:00:40Z"),
        Tr(firstId + 5, fsm: fsm, toState: "online", ts: "2026-06-08T12:00:50Z"),
    ];

    // ── Branch: all-clear (web alerts.length === 0) vs. alerts ──────────────────────────────────────

    [Fact]
    public void AllClear_when_no_transitions()
    {
        var display = Project();

        Assert.Equal(FsmHealthPanelState.AllClear, display.State);
        Assert.Empty(display.Alerts);
        Assert.Equal(AllClearCopy, display.AllClearText);
    }

    [Fact]
    public void AllClear_when_transitions_but_no_alerts()
    {
        var display = Project(
            Tr(1, ts: "2026-06-08T11:00:00Z", toState: "online"),
            Tr(2, ts: "2026-06-08T11:30:00Z", toState: "asleep"),
            Tr(3, ts: "2026-06-08T11:59:00Z", toState: "online"));

        Assert.Equal(FsmHealthPanelState.AllClear, display.State);
        Assert.Empty(display.Alerts);
    }

    // ── Flap detection ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Flap_alert_when_more_than_five_same_fsm_transitions_within_a_minute()
    {
        var display = Project(FlappingGroup("vehicle", firstId: 1));

        Assert.Equal(FsmHealthPanelState.Alerts, display.State);
        var alert = Assert.Single(display.Alerts);
        Assert.Equal(FsmHealthAlertKind.Flap, alert.Kind);
        Assert.Equal(StatusKind.Warning, alert.Severity);
        Assert.Equal(NumberFormatting.Format(6, null, 0), alert.CountText);
    }

    [Fact]
    public void No_flap_with_exactly_five_in_a_window()
    {
        var display = Project(
            Tr(1, fsm: "vehicle", ts: "2026-06-08T12:00:00Z"),
            Tr(2, fsm: "vehicle", ts: "2026-06-08T12:00:10Z"),
            Tr(3, fsm: "vehicle", ts: "2026-06-08T12:00:20Z"),
            Tr(4, fsm: "vehicle", ts: "2026-06-08T12:00:30Z"),
            Tr(5, fsm: "vehicle", ts: "2026-06-08T12:00:40Z"));

        Assert.Equal(FsmHealthPanelState.AllClear, display.State);
    }

    [Fact]
    public void No_flap_when_transitions_are_spread_beyond_the_window()
    {
        var display = Project(
            Tr(1, fsm: "vehicle", ts: "2026-06-08T12:00:00Z"),
            Tr(2, fsm: "vehicle", ts: "2026-06-08T12:00:15Z"),
            Tr(3, fsm: "vehicle", ts: "2026-06-08T12:00:30Z"),
            Tr(4, fsm: "vehicle", ts: "2026-06-08T12:00:45Z"),
            Tr(5, fsm: "vehicle", ts: "2026-06-08T12:01:00Z"),
            Tr(6, fsm: "vehicle", ts: "2026-06-08T12:01:15Z"));

        Assert.Equal(FsmHealthPanelState.AllClear, display.State);
    }

    [Fact]
    public void Flap_count_is_captured_at_the_first_flapping_fsm_while_flap_ids_span_all_fsms()
    {
        // web: the flap alert is pushed inside the per-FSM loop, so its count is the flapped-set size at the first
        // flapping FSM (here 6); computeFlapIds returns the union across both FSMs (12).
        FsmHealthTransition[] transitions =
        [
            .. FlappingGroup("vehicle", firstId: 1),
            .. FlappingGroup("telemetry_connection", firstId: 100),
        ];

        var display = FsmHealthPanelProjection.Project(new FsmHealthPanelModel(transitions), Localizer, Now);
        var flap = Assert.Single(display.Alerts, a => a.Kind == FsmHealthAlertKind.Flap);
        Assert.Equal(NumberFormatting.Format(6, null, 0), flap.CountText);

        var flapIds = FsmHealthPanelProjection.ComputeFlapIds(transitions);
        Assert.Equal(12, flapIds.Count);
    }

    [Fact]
    public void ComputeFlapIds_is_empty_when_nothing_flaps()
    {
        Assert.Empty(FsmHealthPanelProjection.ComputeFlapIds(
        [
            Tr(1, fsm: "vehicle", ts: "2026-06-08T12:00:00Z"),
            Tr(2, fsm: "vehicle", ts: "2026-06-08T12:30:00Z"),
        ]));
    }

    // ── Stuck detection ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Stuck_alert_when_session_pending_or_active_for_over_four_hours()
    {
        var display = Project(
            Tr(1, vehicleId: 7, fsm: "drive_session", toState: "active", ts: "2026-06-08T06:00:00Z"));

        var alert = Assert.Single(display.Alerts);
        Assert.Equal(FsmHealthAlertKind.Stuck, alert.Kind);
        Assert.Equal(StatusKind.Warning, alert.Severity);
        Assert.Equal(NumberFormatting.Format(1, null, 0), alert.CountText);
    }

    [Fact]
    public void Not_stuck_when_session_is_recent()
    {
        var display = Project(
            Tr(1, vehicleId: 7, fsm: "charge_session", toState: "pending", ts: "2026-06-08T11:00:00Z"));

        Assert.Equal(FsmHealthPanelState.AllClear, display.State);
    }

    [Fact]
    public void Not_stuck_when_latest_state_is_terminal()
    {
        var display = Project(
            Tr(1, vehicleId: 7, fsm: "drive_session", toState: "completed", ts: "2026-06-08T06:00:00Z"));

        Assert.Equal(FsmHealthPanelState.AllClear, display.State);
    }

    [Fact]
    public void Stuck_uses_the_latest_transition_per_instance()
    {
        // The latest state for vehicle 7's drive session is "completed" (1h ago), so it is no longer stuck even
        // though it was "active" 6h ago.
        var display = Project(
            Tr(1, vehicleId: 7, fsm: "drive_session", toState: "active", ts: "2026-06-08T06:00:00Z"),
            Tr(2, vehicleId: 7, fsm: "drive_session", toState: "completed", ts: "2026-06-08T11:00:00Z"));

        Assert.Equal(FsmHealthPanelState.AllClear, display.State);
    }

    [Fact]
    public void Stuck_counts_one_per_vehicle_instance()
    {
        var display = Project(
            Tr(1, vehicleId: 7, fsm: "drive_session", toState: "active", ts: "2026-06-08T06:00:00Z"),
            Tr(2, vehicleId: 9, fsm: "charge_session", toState: "pending", ts: "2026-06-08T05:00:00Z"));

        var alert = Assert.Single(display.Alerts);
        Assert.Equal(FsmHealthAlertKind.Stuck, alert.Kind);
        Assert.Equal(NumberFormatting.Format(2, null, 0), alert.CountText);
    }

    // ── Recovery detection ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Recovery_alert_counts_every_recovered_transition()
    {
        var display = Project(
            Tr(1, fsm: "drive_session", toState: "recovered", ts: "2026-06-08T11:00:00Z"),
            Tr(2, fsm: "charge_session", toState: "recovered", ts: "2026-06-08T11:10:00Z"),
            Tr(3, fsm: "vehicle", toState: "recovered", ts: "2026-06-08T11:20:00Z"));

        var alert = Assert.Single(display.Alerts);
        Assert.Equal(FsmHealthAlertKind.Recovery, alert.Kind);
        Assert.Equal(StatusKind.Info, alert.Severity);
        Assert.Equal(NumberFormatting.Format(3, null, 0), alert.CountText);
    }

    // ── Composition: ordering, glyphs, accent token keys ────────────────────────────────────────────

    [Fact]
    public void Alerts_are_ordered_flap_then_stuck_then_recovery()
    {
        FsmHealthTransition[] transitions =
        [
            .. FlappingGroup("vehicle", firstId: 1),
            Tr(50, vehicleId: 7, fsm: "drive_session", toState: "active", ts: "2026-06-08T06:00:00Z"),
            Tr(60, fsm: "charge_session", toState: "recovered", ts: "2026-06-08T11:00:00Z"),
        ];

        var display = FsmHealthPanelProjection.Project(new FsmHealthPanelModel(transitions), Localizer, Now);

        Assert.Collection(
            display.Alerts,
            a => Assert.Equal(FsmHealthAlertKind.Flap, a.Kind),
            a => Assert.Equal(FsmHealthAlertKind.Stuck, a.Kind),
            a => Assert.Equal(FsmHealthAlertKind.Recovery, a.Kind));
    }

    [Fact]
    public void Each_alert_carries_its_segoe_fluent_glyph()
    {
        FsmHealthTransition[] transitions =
        [
            .. FlappingGroup("vehicle", firstId: 1),
            Tr(50, vehicleId: 7, fsm: "drive_session", toState: "active", ts: "2026-06-08T06:00:00Z"),
            Tr(60, fsm: "charge_session", toState: "recovered", ts: "2026-06-08T11:00:00Z"),
        ];

        var display = FsmHealthPanelProjection.Project(new FsmHealthPanelModel(transitions), Localizer, Now);

        Assert.Equal(FsmHealthPanelRegistration.FlapGlyph, display.Alerts[0].IconGlyph);
        Assert.Equal(FsmHealthPanelRegistration.StuckGlyph, display.Alerts[1].IconGlyph);
        Assert.Equal(FsmHealthPanelRegistration.RecoveryGlyph, display.Alerts[2].IconGlyph);
    }

    [Theory]
    [InlineData(FsmHealthAlertKind.Flap, "TsColorWarningBrush", "TsColorWarningColor")]
    [InlineData(FsmHealthAlertKind.Stuck, "TsColorWarningBrush", "TsColorWarningColor")]
    [InlineData(FsmHealthAlertKind.Recovery, "TsColorInfoBrush", "TsColorInfoColor")]
    public void Each_alert_resolves_the_expected_status_token_keys(
        FsmHealthAlertKind kind,
        string brushKey,
        string colorKey)
    {
        FsmHealthTransition[] transitions =
        [
            .. FlappingGroup("vehicle", firstId: 1),
            Tr(50, vehicleId: 7, fsm: "drive_session", toState: "active", ts: "2026-06-08T06:00:00Z"),
            Tr(60, fsm: "charge_session", toState: "recovered", ts: "2026-06-08T11:00:00Z"),
        ];

        var display = FsmHealthPanelProjection.Project(new FsmHealthPanelModel(transitions), Localizer, Now);
        var alert = Assert.Single(display.Alerts, a => a.Kind == kind);

        Assert.Equal(brushKey, alert.AccentBrushKey);
        Assert.Equal(colorKey, alert.AccentColorKey);
    }

    // ── Copy: localized titles + interpolated messages ──────────────────────────────────────────────

    [Fact]
    public void Flap_message_interpolates_the_count_and_leaves_no_token()
    {
        var alert = Assert.Single(Project(FlappingGroup("vehicle", firstId: 1)).Alerts);

        Assert.Equal("State Flapping", alert.Title);
        Assert.Equal("6 transitions flagged as state flapping (>5 same-FSM transitions/min)", alert.Message);
        Assert.DoesNotContain("{0}", alert.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Stuck_and_recovery_messages_render_their_localized_copy()
    {
        var stuck = Assert.Single(Project(
            Tr(1, vehicleId: 7, fsm: "drive_session", toState: "active", ts: "2026-06-08T06:00:00Z")).Alerts);
        Assert.Equal("Stuck Sessions", stuck.Title);
        Assert.Equal("1 session(s) stuck in pending/active for >4 hours", stuck.Message);

        var recovery = Assert.Single(Project(
            Tr(1, fsm: "drive_session", toState: "recovered", ts: "2026-06-08T11:00:00Z")).Alerts);
        Assert.Equal("Pod Recoveries", recovery.Title);
        Assert.Equal("1 session(s) recovered after pod restart", recovery.Message);
    }

    // ── i18n: every label resolves through its P1/S10 catalog key ───────────────────────────────────

    [Fact]
    public void Panel_labels_resolve_through_the_catalog_keys()
    {
        var display = FsmHealthPanelProjection.Project(FsmHealthPanelModel.Empty, new PrefixLocalizer(), Now);

        Assert.Equal("L:translation.fsm.health.title", display.Title);
        Assert.Equal("L:translation.fsm.health.allClear", display.AllClearText);
    }

    [Fact]
    public void Alert_labels_resolve_through_the_catalog_keys()
    {
        FsmHealthTransition[] transitions =
        [
            .. FlappingGroup("vehicle", firstId: 1),
            Tr(50, vehicleId: 7, fsm: "drive_session", toState: "active", ts: "2026-06-08T06:00:00Z"),
            Tr(60, fsm: "charge_session", toState: "recovered", ts: "2026-06-08T11:00:00Z"),
        ];

        var display = FsmHealthPanelProjection.Project(new FsmHealthPanelModel(transitions), new PrefixLocalizer(), Now);

        Assert.Equal("L:translation.fsm.health.flapTitle", display.Alerts[0].Title);
        Assert.Equal("L:translation.fsm.health.flapping", display.Alerts[0].Message);
        Assert.Equal("L:translation.fsm.health.stuckTitle", display.Alerts[1].Title);
        Assert.Equal("L:translation.fsm.health.stuck", display.Alerts[1].Message);
        Assert.Equal("L:translation.fsm.health.recoveryTitle", display.Alerts[2].Title);
        Assert.Equal("L:translation.fsm.health.recoveries", display.Alerts[2].Message);
    }

    // ── Accessibility: every state + every alert exposes a non-empty Narrator name ──────────────────

    [Fact]
    public void All_clear_automation_name_is_the_healthy_copy()
    {
        var display = Project();

        Assert.Equal(display.AllClearText, display.AutomationName);
        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
    }

    [Fact]
    public void Alerts_automation_name_carries_the_title_and_each_alert()
    {
        var display = Project(FlappingGroup("vehicle", firstId: 1));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.All(display.Alerts, a => Assert.Contains(a.AutomationName, display.AutomationName, StringComparison.Ordinal));
    }

    [Fact]
    public void Every_alert_exposes_a_descriptive_automation_name()
    {
        var alert = Assert.Single(Project(FlappingGroup("vehicle", firstId: 1)).Alerts);

        Assert.Contains(alert.Title, alert.AutomationName, StringComparison.Ordinal);
        Assert.Contains(alert.Message, alert.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=FSMHealthPanel, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new FsmHealthPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FSMHealthPanel", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("FSMHealthPanel", FsmHealthPanelRegistration.Slug);
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
