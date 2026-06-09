using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LiveTelemetry</c> feature surface's UI-thread-free logic — the per-panel
/// skeleton / content gating (the web's <c>{data ? … : skeleton}</c>), the SI→display unit conversion the web
/// does with its injected converters, the per-field em-dash fallbacks, the <c>cleanNil</c> Go-sentinel
/// filtering, the gear / playback badge mapping, the door / window open-count logic, the tire freshness bands,
/// the climate-mode and saved-location chips, the accessible names for every panel and state, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/dashboard/components/LiveTelemetry.tsx). The WinUI view
/// itself is exercised by the app build.
/// </summary>
public sealed class LiveTelemetryTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static LiveTelemetryDisplay Project(LiveTelemetryModel model) =>
        LiveTelemetryProjection.Project(model, Localizer);

    private static LiveTelemetryModel Full(UnitPref? units = null) => new(
        new MotorTelemetry(281, 84.6, "D", 0.12, -0.45),
        new ClimateTelemetry(21.0, 12.3, 2500, 3, "Off", false),
        new SecurityTelemetry(true, true, "closed,closed,closed,closed", "Closed", "Closed", "Closed", "Closed"),
        new TirePressureTelemetry(240, 240, 240, 240),
        new MediaTelemetry("Song", "Artist", "Playing", 7, 11),
        new NavigationTelemetry("Office", 5000, 8, true, false, false),
        units ?? UnitPref.Metric);

    // ── Per-panel loading gate (web {data ? … : <SkeletonRows />}) ──────────────────────────────────────

    [Fact]
    public void Pending_model_marks_every_panel_as_loading()
    {
        var display = Project(LiveTelemetryModel.Pending);

        Assert.False(display.Drivetrain.HasData);
        Assert.False(display.Climate.HasData);
        Assert.False(display.Security.HasData);
        Assert.False(display.TirePressure.HasData);
        Assert.False(display.Media.HasData);
        Assert.False(display.Navigation.HasData);
    }

    [Fact]
    public void Each_panel_loads_independently_of_the_others()
    {
        var model = LiveTelemetryModel.Pending with { Motor = new MotorTelemetry(10, 20, "D", 0, 0) };

        var display = Project(model);

        Assert.True(display.Drivetrain.HasData);
        Assert.False(display.Climate.HasData);
        Assert.False(display.Security.HasData);
    }

    [Fact]
    public void Populated_model_marks_every_panel_as_loaded()
    {
        var display = Project(Full());

        Assert.True(display.Drivetrain.HasData);
        Assert.True(display.Climate.HasData);
        Assert.True(display.Security.HasData);
        Assert.True(display.TirePressure.HasData);
        Assert.True(display.Media.HasData);
        Assert.True(display.Navigation.HasData);
    }

    // ── Drivetrain ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Torque_renders_the_raw_value_with_the_newton_metre_unit() =>
        Assert.Equal("281 Nm", Project(Full()).Drivetrain.Torque.Value);

    [Fact]
    public void Motor_temp_converts_to_celsius_at_integer_precision() =>
        // 84.6 °C → "85°C" (half-expand integer, no space before the unit).
        Assert.Equal("85\u00B0C", Project(Full()).Drivetrain.MotorTemp.Value);

    [Fact]
    public void Motor_temp_converts_to_fahrenheit_under_the_imperial_preference() =>
        // 84.6 °C → 184.28 °F → "184°F".
        Assert.Equal("184\u00B0F", Project(Full(UnitPref.Imperial)).Drivetrain.MotorTemp.Value);

    [Fact]
    public void G_force_is_the_larger_axis_magnitude_at_two_decimals() =>
        // max(|0.12|, |-0.45|) = 0.45 → "0.45g".
        Assert.Equal("0.45g", Project(Full()).Drivetrain.GForce.Value);

    [Theory]
    [InlineData("D", StatusKind.Success)]
    [InlineData("R", StatusKind.Danger)]
    [InlineData("N", StatusKind.Neutral)]
    [InlineData("P", StatusKind.Neutral)]
    public void Gear_chip_status_maps_drive_and_reverse(string gear, StatusKind expected)
    {
        var model = Full() with { Motor = new MotorTelemetry(0, 0, gear, 0, 0) };

        var drivetrain = Project(model).Drivetrain;

        Assert.True(drivetrain.GearKnown);
        Assert.Equal(gear, drivetrain.GearText);
        Assert.Equal(expected, drivetrain.GearStatus);
    }

    [Fact]
    public void Gear_nil_sentinel_is_treated_as_unknown()
    {
        var model = Full() with { Motor = new MotorTelemetry(0, 0, "<nil>", 0, 0) };

        var drivetrain = Project(model).Drivetrain;

        Assert.False(drivetrain.GearKnown);
        Assert.Equal("\u2014", drivetrain.GearText);
    }

    [Fact]
    public void Drivetrain_fields_fall_back_to_em_dash_when_null()
    {
        var model = Full() with { Motor = new MotorTelemetry(null, null, null, null, null) };

        var drivetrain = Project(model).Drivetrain;

        Assert.True(drivetrain.HasData);
        Assert.Equal("\u2014", drivetrain.Torque.Value);
        Assert.Equal("\u2014", drivetrain.MotorTemp.Value);
        Assert.Equal("\u2014", drivetrain.GForce.Value);
        Assert.False(drivetrain.GearKnown);
    }

    // ── Climate ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Cabin_and_outside_render_integer_celsius()
    {
        var climate = Project(Full()).Climate;

        Assert.Equal("21\u00B0C", climate.Cabin.Value);
        Assert.Equal("12\u00B0C", climate.Outside.Value);
    }

    [Fact]
    public void Hvac_power_converts_si_watts_to_kilowatts() =>
        // 2500 W → "2.5 kW".
        Assert.Equal("2.5 kW", Project(Full()).Climate.HvacPower.Value);

    [Fact]
    public void Fan_meter_shows_the_step_over_six_and_a_clamped_fraction()
    {
        var fan = Project(Full()).Climate.Fan;

        Assert.Equal("3/6", fan.ValueText);
        Assert.Equal(0.5, fan.Fraction, 6);
    }

    [Fact]
    public void Climate_shows_no_active_modes_when_defrost_is_off_and_no_heater()
    {
        var climate = Project(Full()).Climate;

        Assert.False(climate.AnyModes);
        Assert.False(climate.ShowDefrost);
        Assert.False(climate.ShowBatteryHeater);
        Assert.Equal("No active modes", climate.NoModesText);
    }

    [Fact]
    public void Climate_surfaces_both_mode_chips_when_active()
    {
        var model = Full() with { Climate = new ClimateTelemetry(21, 12, 1000, 2, "Defrosting", true) };

        var climate = Project(model).Climate;

        Assert.True(climate.AnyModes);
        Assert.True(climate.ShowDefrost);
        Assert.True(climate.ShowBatteryHeater);
        Assert.Equal("Defrost", climate.DefrostText);
        Assert.Equal("Bat Heater", climate.BatteryHeaterText);
    }

    // ── Security ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Lock_and_sentry_text_track_their_flags()
    {
        var locked = Project(Full()).Security;
        Assert.True(locked.Locked);
        Assert.Equal("Locked", locked.LockText);
        Assert.True(locked.SentryActive);
        Assert.Equal("Active", locked.SentryText);

        var open = Project(Full() with
        {
            Security = new SecurityTelemetry(false, false, "", null, null, null, null),
        }).Security;
        Assert.False(open.Locked);
        Assert.Equal("Unlocked", open.LockText);
        Assert.False(open.SentryActive);
        Assert.Equal("Off", open.SentryText);
    }

    [Fact]
    public void All_doors_and_windows_closed_is_a_success_chip()
    {
        var security = Project(Full()).Security;

        Assert.Equal("All Closed", security.Doors.Text);
        Assert.Equal(StatusKind.Success, security.Doors.Status);
        Assert.Equal("All Closed", security.Windows.Text);
        Assert.Equal(StatusKind.Success, security.Windows.Status);
    }

    [Fact]
    public void Open_doors_are_counted_from_the_comma_list()
    {
        var model = Full() with
        {
            Security = new SecurityTelemetry(true, false, "Open,Closed,Open,Closed", "Closed", "Closed", "Closed", "Closed"),
        };

        var doors = Project(model).Security.Doors;

        Assert.Equal("2 Open", doors.Text);
        Assert.Equal(StatusKind.Warning, doors.Status);
    }

    [Fact]
    public void Open_windows_are_any_value_other_than_closed()
    {
        var model = Full() with
        {
            Security = new SecurityTelemetry(true, false, "closed", "Open", "Closed", "Vented", "Closed"),
        };

        var windows = Project(model).Security.Windows;

        Assert.Equal("2 Open", windows.Text);
        Assert.Equal(StatusKind.Warning, windows.Status);
    }

    // ── Tire pressure ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Tire_values_convert_from_si_kilopascals()
    {
        var tire = Project(Full()).TirePressure;

        Assert.Equal("kPa", tire.UnitLabel);
        Assert.Equal("240.0", tire.Corners[0].Value);
        Assert.All(tire.Corners, c => Assert.Equal(TirePressureLevel.Normal, c.Level));
    }

    [Fact]
    public void Tire_values_convert_to_psi_under_the_imperial_preference()
    {
        var tire = Project(Full(UnitPref.Imperial)).TirePressure;

        Assert.Equal("psi", tire.UnitLabel);
        // 240 kPa / 6.894757 = 34.81 → "34.8".
        Assert.Equal("34.8", tire.Corners[0].Value);
    }

    [Theory]
    [InlineData(150.0, TirePressureLevel.Critical)]
    [InlineData(215.0, TirePressureLevel.Warning)]
    [InlineData(250.0, TirePressureLevel.Normal)]
    [InlineData(300.0, TirePressureLevel.Warning)]
    [InlineData(320.0, TirePressureLevel.Critical)]
    public void Tire_freshness_bands_follow_the_web_thresholds(double kpa, TirePressureLevel expected)
    {
        var model = Full() with { TirePressure = new TirePressureTelemetry(kpa, 240, 240, 240) };

        Assert.Equal(expected, Project(model).TirePressure.Corners[0].Level);
    }

    [Fact]
    public void Tire_corner_without_a_reading_is_unknown_and_an_em_dash()
    {
        var model = Full() with { TirePressure = new TirePressureTelemetry(null, 240, 240, 240) };

        var corner = Project(model).TirePressure.Corners[0];

        Assert.Equal("\u2014", corner.Value);
        Assert.Equal(TirePressureLevel.Unknown, corner.Level);
    }

    [Fact]
    public void Tire_summary_warns_when_any_corner_leaves_the_normal_band()
    {
        var allNormal = Project(Full()).TirePressure.Summary;
        Assert.Equal("All Normal", allNormal.Text);
        Assert.Equal(StatusKind.Success, allNormal.Status);

        var model = Full() with { TirePressure = new TirePressureTelemetry(150, 240, 240, 240) };
        var warned = Project(model).TirePressure.Summary;
        Assert.Equal("Warning", warned.Text);
        Assert.Equal(StatusKind.Warning, warned.Status);
    }

    [Fact]
    public void Tire_summary_ignores_corners_without_a_reading()
    {
        var model = Full() with { TirePressure = new TirePressureTelemetry(null, null, null, null) };

        Assert.Equal("All Normal", Project(model).TirePressure.Summary.Text);
    }

    // ── Media ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Media_track_and_artist_apply_clean_nil_and_fallbacks()
    {
        var playing = Project(Full()).Media;
        Assert.Equal("Song", playing.TrackTitle);
        Assert.Equal("Artist", playing.Artist);

        var blank = Project(Full() with
        {
            Media = new MediaTelemetry("<nil>", "nil", null, null, null),
        }).Media;
        Assert.Equal("\u2014", blank.TrackTitle);
        Assert.Equal("Unknown artist", blank.Artist);
    }

    [Theory]
    [InlineData("Playing", StatusKind.Success)]
    [InlineData("Paused", StatusKind.Warning)]
    [InlineData("Stopped", StatusKind.Neutral)]
    public void Media_status_chip_maps_playback_state(string playback, StatusKind expected)
    {
        var model = Full() with { Media = new MediaTelemetry("S", "A", playback, 1, 10) };

        var status = Project(model).Media.Status;

        Assert.Equal(playback, status.Text);
        Assert.Equal(expected, status.Status);
    }

    [Fact]
    public void Media_status_falls_back_to_em_dash_for_a_nil_state()
    {
        var model = Full() with { Media = new MediaTelemetry("S", "A", "<nil>", 1, 10) };

        Assert.Equal("\u2014", Project(model).Media.Status.Text);
    }

    [Fact]
    public void Volume_shows_current_over_max_with_a_clamped_fraction()
    {
        var volume = Project(Full()).Media.Volume;

        Assert.Equal("7/11", volume.ValueText);
        Assert.Equal(7.0 / 11.0, volume.Fraction, 6);
    }

    [Fact]
    public void Volume_without_a_maximum_drops_the_denominator_and_zeroes_the_meter()
    {
        var model = Full() with { Media = new MediaTelemetry("S", "A", "Playing", 5, null) };

        var volume = Project(model).Media.Volume;

        Assert.Equal("5", volume.ValueText);
        Assert.Equal(0d, volume.Fraction);
    }

    // ── Navigation ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Navigation_rows_render_destination_distance_and_eta()
    {
        var nav = Project(Full()).Navigation;

        Assert.Equal("Office", nav.Destination.Value);
        Assert.Equal("5.0 km", nav.Distance.Value);
        Assert.Equal("8 min", nav.Eta.Value);
    }

    [Fact]
    public void Navigation_distance_converts_to_miles_under_the_imperial_preference() =>
        // 5000 m / 1609.344 = 3.11 → "3.1 mi".
        Assert.Equal("3.1 mi", Project(Full(UnitPref.Imperial)).Navigation.Distance.Value);

    [Fact]
    public void Navigation_fields_fall_back_to_em_dash_when_null()
    {
        var model = Full() with { Navigation = new NavigationTelemetry(null, null, null, false, false, false) };

        var nav = Project(model).Navigation;

        Assert.Equal("\u2014", nav.Destination.Value);
        Assert.Equal("\u2014", nav.Distance.Value);
        Assert.Equal("\u2014", nav.Eta.Value);
        Assert.False(nav.AnyLocation);
        Assert.Equal("No saved location", nav.NoLocationText);
    }

    [Fact]
    public void Navigation_saved_location_flags_drive_the_chips()
    {
        var model = Full() with { Navigation = new NavigationTelemetry("Home", 0, 0, true, false, true) };

        var nav = Project(model).Navigation;

        Assert.True(nav.AnyLocation);
        Assert.True(nav.AtHome);
        Assert.False(nav.AtWork);
        Assert.True(nav.AtFavorite);
        Assert.Equal("Home", nav.HomeText);
        Assert.Equal("Favorite", nav.FavoriteText);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ────────────────────────────────────

    [Fact]
    public void Surface_automation_name_lists_the_section_and_every_panel_title() =>
        Assert.Equal(
            "Live Telemetry. Drivetrain. Climate. Security. Tire Pressure. Media. Navigation",
            Project(Full()).AutomationName);

    [Fact]
    public void Loaded_panel_automation_name_folds_every_readout() =>
        Assert.Equal(
            "Drivetrain. Torque 281 Nm. Motor Temp 85\u00B0C. Gear D. G-Force 0.45g",
            Project(Full()).Drivetrain.AutomationName);

    [Fact]
    public void Loading_panel_automation_name_is_the_title_and_loading_label()
    {
        var display = Project(LiveTelemetryModel.Pending);

        Assert.Equal("Drivetrain. Loading...", display.Drivetrain.AutomationName);
        Assert.Equal("Climate. Loading...", display.Climate.AutomationName);
        Assert.Equal("Navigation. Loading...", display.Navigation.AutomationName);
    }

    [Fact]
    public void Every_panel_in_every_state_exposes_a_non_empty_automation_name()
    {
        foreach (var display in new[] { Project(LiveTelemetryModel.Pending), Project(Full()) })
        {
            Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
            Assert.False(string.IsNullOrWhiteSpace(display.Drivetrain.AutomationName));
            Assert.False(string.IsNullOrWhiteSpace(display.Climate.AutomationName));
            Assert.False(string.IsNullOrWhiteSpace(display.Security.AutomationName));
            Assert.False(string.IsNullOrWhiteSpace(display.TirePressure.AutomationName));
            Assert.False(string.IsNullOrWhiteSpace(display.Media.AutomationName));
            Assert.False(string.IsNullOrWhiteSpace(display.Navigation.AutomationName));
        }
    }

    // ── i18n: the projection feeds the documented dashboard.telemetry.* keys to the facade ──────────────

    [Fact]
    public void Projection_resolves_titles_through_the_documented_keys()
    {
        var display = LiveTelemetryProjection.Project(Full(), new KeyEchoLocalizer());

        Assert.Equal("dashboard.telemetry.title", display.Title);
        Assert.Equal("dashboard.telemetry.drivetrain", display.Drivetrain.Title);
        Assert.Equal("dashboard.telemetry.climate", display.Climate.Title);
        Assert.Equal("dashboard.telemetry.security", display.Security.Title);
        Assert.Equal("dashboard.telemetry.tirePressure", display.TirePressure.Title);
        Assert.Equal("dashboard.telemetry.media", display.Media.Title);
        Assert.Equal("dashboard.telemetry.navigation", display.Navigation.Title);
    }

    [Fact]
    public void Projection_resolves_row_labels_through_the_documented_keys()
    {
        var display = LiveTelemetryProjection.Project(Full(), new KeyEchoLocalizer());

        Assert.Equal("dashboard.telemetry.torque", display.Drivetrain.Torque.Label);
        Assert.Equal("dashboard.telemetry.motorTemp", display.Drivetrain.MotorTemp.Label);
        Assert.Equal("dashboard.telemetry.gear", display.Drivetrain.GearLabel);
        Assert.Equal("dashboard.telemetry.gforce", display.Drivetrain.GForce.Label);
        Assert.Equal("dashboard.telemetry.cabin", display.Climate.Cabin.Label);
        Assert.Equal("dashboard.telemetry.hvac", display.Climate.HvacPower.Label);
        Assert.Equal("dashboard.telemetry.destination", display.Navigation.Destination.Label);
        Assert.Equal("dashboard.telemetry.eta", display.Navigation.Eta.Label);
    }

    [Fact]
    public void Projection_resolves_state_words_through_the_documented_keys()
    {
        var display = LiveTelemetryProjection.Project(Full(), new KeyEchoLocalizer());

        Assert.Equal("dashboard.telemetry.locked", display.Security.LockText);
        Assert.Equal("dashboard.telemetry.active", display.Security.SentryText);
        Assert.Equal("dashboard.telemetry.allClosed", display.Security.Doors.Text);
        Assert.Equal("dashboard.telemetry.allNormal", display.TirePressure.Summary.Text);
    }

    // ── Diagnostics (P1/S11): view.opened slug=LiveTelemetry, PII-safe ──────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LiveTelemetryDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveTelemetry", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_live_values()
    {
        var captured = new List<string>();
        var diagnostics = new LiveTelemetryDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=LiveTelemetry", line);
        Assert.DoesNotContain("281", line, StringComparison.Ordinal);
        Assert.DoesNotContain("\u00B0", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("LiveTelemetry", LiveTelemetryRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => LiveTelemetryProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => LiveTelemetryProjection.Project(LiveTelemetryModel.Pending, null!));

    /// <summary>
    /// An <see cref="ILocalizer"/> that echoes the requested key (ignoring the fallback), proving the
    /// projection feeds the documented i18n keys — not ad-hoc English literals — into the facade.
    /// </summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }
}
