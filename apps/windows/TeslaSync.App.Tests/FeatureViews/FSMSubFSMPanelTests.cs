using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>FSMSubFSMPanel</c> feature surface's UI-thread-free logic — the
/// vehicle-view gate, the hidden / empty / populated branch projection, the ported per-state colour table
/// (web <c>DRIVE_SESSION_STATE_ENTRIES</c> / <c>CHARGE_SESSION_STATE_ENTRIES</c> via <c>getStateColor</c>), the
/// terminal-vs-active sets, the per-row label / icon / state badge / relative timestamp projection, the i18n
/// keys, the composed accessible names and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/FSMSubFSMPanel.tsx). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class FSMSubFSMPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private static ActiveSubFSM Drive(string state, DateTimeOffset? start = null) =>
        new(SubFSMKind.Drive, state, start);

    private static ActiveSubFSM Charge(string state, DateTimeOffset? start = null) =>
        new(SubFSMKind.Charge, state, start);

    private static FSMSubFSMPanelDisplay Project(string fsmType, params ActiveSubFSM[] subs) =>
        FSMSubFSMPanelProjection.Project(new FSMSubFSMPanelModel(fsmType, subs), Localizer, Now);

    // ── Vehicle-view gate (web `fsmType === 'vehicle' || fsmType === 'all'`) ──────────────────────────────

    [Theory]
    [InlineData("vehicle", true)]
    [InlineData("all", true)]
    [InlineData("ALL", true)]
    [InlineData("  Vehicle  ", true)]
    [InlineData("telemetry_connection", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsVehicleView_matches_the_web_guard(string? fsmType, bool expected) =>
        Assert.Equal(expected, FSMSubFSMPanelProjection.IsVehicleView(fsmType));

    // ── Branch projection: hidden → empty → populated ─────────────────────────────────────────────────────

    [Fact]
    public void Hidden_when_not_a_vehicle_view() =>
        Assert.Equal(FSMSubFSMPanelState.Hidden, Project("telemetry_connection", Drive("active")).State);

    [Fact]
    public void Hidden_view_carries_no_rows() =>
        Assert.Empty(Project("telemetry_connection", Drive("active")).Rows);

    [Fact]
    public void Empty_when_vehicle_view_has_no_subs() =>
        Assert.Equal(FSMSubFSMPanelState.Empty, Project("vehicle").State);

    [Fact]
    public void Empty_when_active_subs_is_null()
    {
        var display = FSMSubFSMPanelProjection.Project(new FSMSubFSMPanelModel("vehicle", null), Localizer, Now);

        Assert.Equal(FSMSubFSMPanelState.Empty, display.State);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Populated_for_a_vehicle_view_with_subs() =>
        Assert.Equal(FSMSubFSMPanelState.Populated, Project("vehicle", Drive("active")).State);

    [Fact]
    public void Populated_projects_one_row_per_sub()
    {
        var display = Project("all", Drive("active"), Charge("pending"));

        Assert.Equal(2, display.Rows.Count);
        Assert.Equal(SubFSMKind.Drive, display.Rows[0].Kind);
        Assert.Equal(SubFSMKind.Charge, display.Rows[1].Kind);
    }

    // ── Ported state colour table (web getStateColor variant) ─────────────────────────────────────────────

    [Theory]
    [InlineData("pending", SeverityLevel.Warn, false)]
    [InlineData("active", SeverityLevel.Success, false)]
    [InlineData("ending", SeverityLevel.Warn, false)]
    [InlineData("completed", SeverityLevel.Info, false)]
    [InlineData("recovered", SeverityLevel.Info, true)]
    [InlineData("mystery", SeverityLevel.Info, true)]
    public void Drive_state_colour_follows_the_web_variant(string state, SeverityLevel severity, bool neutral)
    {
        var style = FSMSubFSMStateColors.Resolve(SubFSMKind.Drive, state);

        Assert.Equal(severity, style.Severity);
        Assert.Equal(neutral, style.Neutral);
    }

    [Theory]
    [InlineData("pending", SeverityLevel.Warn, false)]
    [InlineData("active", SeverityLevel.Success, false)]
    [InlineData("completing", SeverityLevel.Info, false)]
    [InlineData("done", SeverityLevel.Success, false)]
    [InlineData("recovered", SeverityLevel.Info, true)]
    [InlineData("mystery", SeverityLevel.Info, true)]
    public void Charge_state_colour_follows_the_web_variant(string state, SeverityLevel severity, bool neutral)
    {
        var style = FSMSubFSMStateColors.Resolve(SubFSMKind.Charge, state);

        Assert.Equal(severity, style.Severity);
        Assert.Equal(neutral, style.Neutral);
    }

    [Fact]
    public void State_colour_resolution_is_case_insensitive() =>
        Assert.Equal(
            FSMSubFSMStateColors.Resolve(SubFSMKind.Drive, "active"),
            FSMSubFSMStateColors.Resolve(SubFSMKind.Drive, "ACTIVE"));

    // ── Terminal vs active (web terminalStates) ───────────────────────────────────────────────────────────

    [Theory]
    [InlineData("pending", false)]
    [InlineData("active", false)]
    [InlineData("ending", false)]
    [InlineData("completed", true)]
    [InlineData("recovered", true)]
    public void Drive_terminal_states_match_the_web(string state, bool terminal) =>
        Assert.Equal(terminal, FSMSubFSMStateColors.IsTerminal(SubFSMKind.Drive, state));

    [Theory]
    [InlineData("pending", false)]
    [InlineData("active", false)]
    [InlineData("completing", false)]
    [InlineData("done", true)]
    [InlineData("recovered", true)]
    public void Charge_terminal_states_match_the_web(string state, bool terminal) =>
        Assert.Equal(terminal, FSMSubFSMStateColors.IsTerminal(SubFSMKind.Charge, state));

    [Fact]
    public void Active_indicator_is_the_negation_of_terminal()
    {
        Assert.True(Project("vehicle", Drive("active")).Rows[0].IsActive);
        Assert.False(Project("vehicle", Drive("completed")).Rows[0].IsActive);
        Assert.False(Project("vehicle", Charge("done")).Rows[0].IsActive);
    }

    // ── Per-row projection (label / icon / state text) ────────────────────────────────────────────────────

    [Fact]
    public void Drive_row_uses_the_car_glyph_and_drive_label()
    {
        var row = Project("vehicle", Drive("active")).Rows[0];

        Assert.Equal("Drive Session", row.Label);
        Assert.Equal(FSMSubFSMPanelRegistration.CarGlyph, row.IconGlyph);
        Assert.Equal("active", row.StateText);
        Assert.Equal(SeverityLevel.Success, row.StateSeverity);
        Assert.False(row.NeutralState);
    }

    [Fact]
    public void Charge_row_uses_the_zap_glyph_and_charge_label()
    {
        var row = Project("vehicle", Charge("recovered")).Rows[0];

        Assert.Equal("Charge Session", row.Label);
        Assert.Equal(FSMSubFSMPanelRegistration.ZapGlyph, row.IconGlyph);
        Assert.Equal("recovered", row.StateText);
        Assert.True(row.NeutralState);
    }

    // ── Relative start time (web TimeStamp) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Start_time_renders_relative_to_now()
    {
        var hours = Project("vehicle", Drive("active", Now.AddHours(-3))).Rows[0];
        var minutes = Project("vehicle", Charge("active", Now.AddMinutes(-5))).Rows[0];

        Assert.Equal("3h ago", hours.StartTimeText);
        Assert.Equal("5m ago", minutes.StartTimeText);
    }

    [Fact]
    public void Missing_start_time_renders_the_em_dash() =>
        Assert.Equal("\u2014", Project("vehicle", Drive("active")).Rows[0].StartTimeText);

    // ── i18n (resolved through the facade; PassthroughLocalizer returns the English fallback) ──────────────

    [Fact]
    public void Title_and_empty_copy_resolve_through_the_facade()
    {
        var display = Project("vehicle");

        Assert.Equal("Active Sub-FSMs", display.Title);
        Assert.Equal("No active drive or charge sessions", display.EmptyMessage);
    }

    [Fact]
    public void Session_labels_resolve_through_the_facade()
    {
        Assert.Equal("Drive Session", Project("vehicle", Drive("active")).Rows[0].Label);
        Assert.Equal("Charge Session", Project("vehicle", Charge("active")).Rows[0].Label);
    }

    [Theory]
    [InlineData(FSMSubFSMPanelProjection.TitleKey)]
    [InlineData(FSMSubFSMPanelProjection.EmptyKey)]
    [InlineData(FSMSubFSMPanelProjection.DriveLabelKey)]
    [InlineData(FSMSubFSMPanelProjection.ChargeLabelKey)]
    public void Resource_keys_carry_the_translation_prefix(string key) =>
        Assert.StartsWith("translation.fsm.", key, StringComparison.Ordinal);

    // ── Accessible names ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Row_automation_name_composes_label_state_and_time()
    {
        var row = Project("vehicle", Drive("active", Now.AddHours(-3))).Rows[0];

        Assert.Equal("Drive Session, active, 3h ago", row.AutomationName);
    }

    [Fact]
    public void Populated_surface_automation_name_is_the_title() =>
        Assert.Equal("Active Sub-FSMs", Project("vehicle", Drive("active")).AutomationName);

    [Fact]
    public void Empty_surface_automation_name_includes_the_empty_copy() =>
        Assert.Equal("Active Sub-FSMs. No active drive or charge sessions", Project("vehicle").AutomationName);

    // ── Diagnostics (PII-safe view.opened) ────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_the_view_opened_event_with_the_slug()
    {
        var captured = new List<string>();
        var diagnostics = new FSMSubFSMPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FSMSubFSMPanel", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leak_sub_fsm_content()
    {
        var captured = new List<string>();
        var diagnostics = new FSMSubFSMPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("active", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Drive", line, StringComparison.Ordinal);
        Assert.DoesNotContain("ago", line, StringComparison.Ordinal);
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("FSMSubFSMPanel", FSMSubFSMPanelRegistration.Slug);

    [Fact]
    public void Registration_glyphs_are_distinct() =>
        Assert.NotEqual(FSMSubFSMPanelRegistration.CarGlyph, FSMSubFSMPanelRegistration.ZapGlyph);

    // ── Argument validation ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => FSMSubFSMPanelProjection.Project(null!, Localizer, Now));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => FSMSubFSMPanelProjection.Project(FSMSubFSMPanelModel.Empty, null!, Now));
}
