using System;
using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Vehicles;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the vehicle-detail <c>RecentActivity</c> feature surface's UI-thread-free logic —
/// the branch projection (loading / ready), the recent-drives panel (SI distance conversion at one decimal
/// with the display-unit suffix, the duration and SoC strings, the five-row cap in input order, the friendly
/// empty note), the recent-charges panel (SI energy → kWh, the duration, the end-SoC-gated span, the cap and
/// empty note), the panel metadata (titles, glyphs, accents, route targets), the i18n key resolution, the
/// per-state accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/vehicles/components/RecentActivity.tsx). The WinUI view itself (RecentActivity.Vehicles.cs)
/// is exercised by the app build.
/// </summary>
public sealed class RecentActivityVehiclesTests
{
    private const string RouteGlyph = "\uE804";
    private const string ZapGlyph = "\uE945";
    private const string BatteryChargingGlyph = "\uE83F";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Base = new(2026, 6, 1, 12, 0, 0, TimeSpan.Zero);

    private static RecentActivityDrive Drive(
        long id = 1,
        double distanceM = 1609.344,
        double durationS = 4980,
        double? startSoc = 80,
        double? endSoc = 60,
        int index = 0) =>
        new(id, distanceM, durationS, startSoc, endSoc, Base.AddMinutes(-index));

    private static RecentActivityCharge Charge(
        long id = 1,
        double energyWh = 8500,
        double durationS = 4500,
        double? startSoc = 40,
        double? endSoc = 80,
        int index = 0) =>
        new(id, energyWh, durationS, startSoc, endSoc, Base.AddMinutes(-index));

    private static RecentActivityModel Ready(
        IReadOnlyList<RecentActivityDrive>? drives = null,
        IReadOnlyList<RecentActivityCharge>? charges = null,
        DistanceUnit unit = DistanceUnit.Mi) =>
        new(false,
            drives ?? Array.Empty<RecentActivityDrive>(),
            charges ?? Array.Empty<RecentActivityCharge>(),
            unit);

    private static RecentActivityDisplay Project(RecentActivityModel model) =>
        RecentActivityProjection.Project(model, Localizer);

    // ── Branch precedence: loading → ready (web data lifecycle) ────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(RecentActivityState.Loading, Project(RecentActivityModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_data()
    {
        var model = new RecentActivityModel(true, new[] { Drive() }, new[] { Charge() }, DistanceUnit.Mi);

        Assert.Equal(RecentActivityState.Loading, Project(model).State);
    }

    [Fact]
    public void Ready_when_resolved() =>
        Assert.Equal(RecentActivityState.Ready, Project(RecentActivityModel.Empty).State);

    // ── Recent Drives panel: row composition (web parity) ───────────────────────────────────────────────

    [Fact]
    public void Drive_value_converts_distance_to_the_display_unit_at_one_decimal()
    {
        var row = Project(Ready(drives: new[] { Drive(distanceM: 1609.344) }, unit: DistanceUnit.Mi)).Drives.Rows[0];

        Assert.Equal(1.0, row.Value, 3);
        Assert.Equal(1, row.ValuePrecision);
        Assert.Equal(" mi", row.ValueSuffix);
        Assert.Equal("1.0 mi", row.ValueText);
    }

    [Fact]
    public void Drive_value_honours_a_kilometre_display_unit()
    {
        var row = Project(Ready(drives: new[] { Drive(distanceM: 5000) }, unit: DistanceUnit.Km)).Drives.Rows[0];

        Assert.Equal(5.0, row.Value, 3);
        Assert.Equal(" km", row.ValueSuffix);
        Assert.Equal("5.0 km", row.ValueText);
    }

    [Fact]
    public void Drive_duration_is_hours_and_minutes()
    {
        var row = Project(Ready(drives: new[] { Drive(durationS: 4980) })).Drives.Rows[0];

        Assert.Equal("1h 23m", row.Duration);
    }

    [Fact]
    public void Drive_soc_span_shows_when_both_are_present()
    {
        var row = Project(Ready(drives: new[] { Drive(startSoc: 80, endSoc: 60) })).Drives.Rows[0];

        Assert.Equal("80% \u2192 60%", row.SocSpan);
    }

    [Fact]
    public void Drive_soc_span_is_omitted_when_the_end_is_missing()
    {
        var row = Project(Ready(drives: new[] { Drive(startSoc: 80, endSoc: null) })).Drives.Rows[0];

        Assert.Null(row.SocSpan);
    }

    [Fact]
    public void Drive_soc_span_is_omitted_when_the_start_is_missing()
    {
        var row = Project(Ready(drives: new[] { Drive(startSoc: null, endSoc: 60) })).Drives.Rows[0];

        Assert.Null(row.SocSpan);
    }

    [Fact]
    public void Drive_row_carries_its_id_for_navigation()
    {
        var row = Project(Ready(drives: new[] { Drive(id: 4242) })).Drives.Rows[0];

        Assert.Equal(4242, row.Id);
    }

    // ── Recent Charges panel: row composition (web parity) ──────────────────────────────────────────────

    [Fact]
    public void Charge_value_converts_energy_to_kwh_at_one_decimal()
    {
        var row = Project(Ready(charges: new[] { Charge(energyWh: 8500) })).Charges.Rows[0];

        Assert.Equal(8.5, row.Value, 3);
        Assert.Equal(" kWh", row.ValueSuffix);
        Assert.Equal("8.5 kWh", row.ValueText);
    }

    [Fact]
    public void Charge_duration_is_hours_and_minutes()
    {
        var row = Project(Ready(charges: new[] { Charge(durationS: 4500) })).Charges.Rows[0];

        Assert.Equal("1h 15m", row.Duration);
    }

    [Fact]
    public void Charge_soc_span_shows_when_the_end_is_present()
    {
        var row = Project(Ready(charges: new[] { Charge(startSoc: 40, endSoc: 80) })).Charges.Rows[0];

        Assert.Equal("40% \u2192 80%", row.SocSpan);
    }

    [Fact]
    public void Charge_soc_span_is_omitted_when_the_end_is_missing()
    {
        var row = Project(Ready(charges: new[] { Charge(startSoc: 40, endSoc: null) })).Charges.Rows[0];

        Assert.Null(row.SocSpan);
    }

    [Fact]
    public void Charge_row_carries_its_id_for_navigation()
    {
        var row = Project(Ready(charges: new[] { Charge(id: 7007) })).Charges.Rows[0];

        Assert.Equal(7007, row.Id);
    }

    // ── Ordering + the five-row cap (web slice(0, 5), no sort) ──────────────────────────────────────────

    [Fact]
    public void Drives_preserve_input_order()
    {
        var display = Project(Ready(drives: new[] { Drive(id: 1), Drive(id: 2), Drive(id: 3) }));

        Assert.Collection(
            display.Drives.Rows,
            r => Assert.Equal(1, r.Id),
            r => Assert.Equal(2, r.Id),
            r => Assert.Equal(3, r.Id));
    }

    [Fact]
    public void Drives_are_capped_at_five_rows()
    {
        var drives = new List<RecentActivityDrive>();
        for (int i = 0; i < 9; i++)
        {
            drives.Add(Drive(id: i));
        }

        var display = Project(Ready(drives: drives));

        Assert.Equal(5, display.Drives.Rows.Count);
        Assert.True(display.Drives.HasRows);
        Assert.Equal(0, display.Drives.Rows[0].Id); // first five in input order
        Assert.Equal(4, display.Drives.Rows[4].Id);
    }

    [Fact]
    public void Charges_are_capped_at_five_rows()
    {
        var charges = new List<RecentActivityCharge>();
        for (int i = 0; i < 8; i++)
        {
            charges.Add(Charge(id: i));
        }

        var display = Project(Ready(charges: charges));

        Assert.Equal(5, display.Charges.Rows.Count);
        Assert.True(display.Charges.HasRows);
    }

    // ── Empty panels (web friendly note instead of a blank box) ─────────────────────────────────────────

    [Fact]
    public void Drives_panel_is_empty_without_drives()
    {
        var display = Project(RecentActivityModel.Empty);

        Assert.False(display.Drives.HasRows);
        Assert.Empty(display.Drives.Rows);
        Assert.Equal("No drives recorded yet", display.Drives.EmptyMessage);
    }

    [Fact]
    public void Charges_panel_is_empty_without_charges()
    {
        var display = Project(RecentActivityModel.Empty);

        Assert.False(display.Charges.HasRows);
        Assert.Empty(display.Charges.Rows);
        Assert.Equal("No charging sessions recorded yet", display.Charges.EmptyMessage);
    }

    // ── Non-finite guards (web ?? 0 / safeNumber) ───────────────────────────────────────────────────────

    [Fact]
    public void Non_finite_distance_and_energy_format_as_zero()
    {
        var drive = Project(Ready(drives: new[] { Drive(distanceM: double.NaN) })).Drives.Rows[0];
        var charge = Project(Ready(charges: new[] { Charge(energyWh: double.PositiveInfinity) })).Charges.Rows[0];

        Assert.StartsWith("0.0 mi", drive.ValueText, StringComparison.Ordinal);
        Assert.StartsWith("0.0 kWh", charge.ValueText, StringComparison.Ordinal);
    }

    [Fact]
    public void Non_finite_duration_formats_as_zero()
    {
        var row = Project(Ready(drives: new[] { Drive(durationS: double.NaN) })).Drives.Rows[0];

        Assert.Equal("0h 0m", row.Duration);
    }

    // ── Panel metadata: titles, glyphs, accents, route targets (web parity) ─────────────────────────────

    [Fact]
    public void Panels_resolve_their_titles_from_the_facade()
    {
        var display = Project(Ready());

        Assert.Equal("Recent Drives", display.Drives.Title);
        Assert.Equal("Recent Charges", display.Charges.Title);
        Assert.Equal("View all", display.Drives.ViewAllLabel);
        Assert.Equal("View all", display.Charges.ViewAllLabel);
    }

    [Fact]
    public void Drives_panel_uses_the_route_icon_and_cyan_accent_and_links_to_drives()
    {
        var panel = Project(Ready()).Drives;

        Assert.Equal(RecentActivityKind.Drive, panel.Kind);
        Assert.Equal(RouteGlyph, panel.HeaderGlyph);
        Assert.Equal(RouteGlyph, panel.RowGlyph);
        Assert.Equal("info", panel.Accent);
        Assert.Equal("/drives", panel.ViewAllTarget);
    }

    [Fact]
    public void Charges_panel_uses_the_battery_and_zap_icons_and_green_accent_and_links_to_charging()
    {
        var panel = Project(Ready()).Charges;

        Assert.Equal(RecentActivityKind.Charge, panel.Kind);
        Assert.Equal(BatteryChargingGlyph, panel.HeaderGlyph);
        Assert.Equal(ZapGlyph, panel.RowGlyph);
        Assert.Equal("success", panel.Accent);
        Assert.Equal("/charging", panel.ViewAllTarget);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ───────────────────────────────────

    [Fact]
    public void Drive_row_automation_name_carries_value_duration_and_soc()
    {
        var row = Project(Ready(drives: new[] { Drive(distanceM: 1609.344, durationS: 4980, startSoc: 80, endSoc: 60) })).Drives.Rows[0];

        Assert.Equal("1.0 mi, 1h 23m, 80% \u2192 60%", row.AutomationName);
    }

    [Fact]
    public void Charge_row_automation_name_omits_a_missing_soc()
    {
        var row = Project(Ready(charges: new[] { Charge(energyWh: 8500, durationS: 4500, endSoc: null) })).Charges.Rows[0];

        Assert.Equal("8.5 kWh, 1h 15m", row.AutomationName);
    }

    [Fact]
    public void Panel_automation_name_reports_its_row_count()
    {
        var display = Project(Ready(drives: new[] { Drive(), Drive(id: 2) }));

        Assert.Equal("Recent Drives: 2", display.Drives.AutomationName);
    }

    [Fact]
    public void Empty_panel_automation_name_carries_the_empty_copy()
    {
        var display = Project(RecentActivityModel.Empty);

        Assert.Equal("Recent Drives: No drives recorded yet", display.Drives.AutomationName);
        Assert.Equal("Recent Charges: No charging sessions recorded yet", display.Charges.AutomationName);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_surface_automation_name() =>
        Assert.All(
            new[]
            {
                Project(RecentActivityModel.Pending),
                Project(RecentActivityModel.Empty),
                Project(Ready(drives: new[] { Drive() }, charges: new[] { Charge() })),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    [Fact]
    public void Loading_surface_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading", Project(RecentActivityModel.Pending).AutomationName);

    [Fact]
    public void Ready_surface_automation_name_joins_both_panels()
    {
        var display = Project(Ready(drives: new[] { Drive() }));

        Assert.Equal("Recent Drives: 1. Recent Charges: No charging sessions recorded yet", display.AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=RecentActivity, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new RecentActivityDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RecentActivity", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_activity_figures()
    {
        var captured = new List<string>();
        var diagnostics = new RecentActivityDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=RecentActivity", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain('$', line);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
        Assert.DoesNotContain("mi", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("RecentActivity", RecentActivityRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => RecentActivityProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => RecentActivityProjection.Project(RecentActivityModel.Pending, null!));
}
