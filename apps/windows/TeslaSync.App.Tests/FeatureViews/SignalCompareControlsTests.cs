using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SignalDiff;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SignalCompareControls</c> feature surface's UI-thread-free logic — the eight
/// category chips (ids, labels, the web name-match regexes) and five datetime presets (wires, labels, the
/// relative-time maths), the <c>datetime-local</c> ⇄ ISO helpers, the model → display projection (window + preset
/// + filter labels, the active-category flag, the contextual clear affordance, the echoed selection, the
/// accessible name), the category-toggle rule, and the diagnostics. Mirrors the web spec
/// (web/src/features/telemetry/components/SignalCompareControls.tsx). The WinUI view itself is exercised by the
/// app build.
/// </summary>
public sealed class SignalCompareControlsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SignalCompareControlsModel Model(
        string atA = "",
        string atB = "",
        string search = "",
        string? category = null) =>
        new(atA, atB, search, category);

    private static SignalCompareControlsDisplay Project(SignalCompareControlsModel model) =>
        SignalCompareControlsProjection.Project(model, Localizer);

    // ── Categories: eight web prefixes, in order, with the web display_name rule ─────────────────────

    [Fact]
    public void Categories_are_the_eight_web_prefixes_in_order()
    {
        var ids = SignalCompareControlsCategories.All.Select(c => c.Id).ToArray();

        Assert.Equal(
            new[] { "battery", "drive", "climate", "security", "motor", "tire", "media", "safety" },
            ids);
    }

    [Fact]
    public void Category_chips_resolve_labels_and_lead_with_battery()
    {
        var chips = Project(Model()).Categories;

        Assert.Equal(8, chips.Count);
        Assert.Equal("battery", chips[0].Id);
        Assert.Equal("Battery", chips[0].Label);
        Assert.Equal("Safety", chips[7].Label);
    }

    [Theory]
    [InlineData("battery", "battery_level")]
    [InlineData("battery", "charge_state")]
    [InlineData("battery", "soc")]
    [InlineData("battery", "est_range")]
    [InlineData("drive", "vehicle_speed")]
    [InlineData("drive", "odometer")]
    [InlineData("drive", "steering_angle")]
    [InlineData("climate", "cabin_temp")]
    [InlineData("climate", "hvac_power")]
    [InlineData("security", "sentry_mode")]
    [InlineData("security", "door_lock")]
    [InlineData("motor", "rear_torque")]
    [InlineData("motor", "inverter_temp")]
    [InlineData("tire", "tpms_fl")]
    [InlineData("media", "audio_volume")]
    [InlineData("safety", "airbag_status")]
    public void Category_matches_reproduce_the_web_regexes(string categoryId, string signalName)
    {
        var category = SignalCompareControlsCategories.All.Single(c => c.Id == categoryId);

        Assert.True(category.Matches(signalName));
    }

    [Fact]
    public void Category_matching_is_case_insensitive()
    {
        var battery = SignalCompareControlsCategories.All.Single(c => c.Id == "battery");

        Assert.True(battery.Matches("BATTERY_LEVEL"));
    }

    [Fact]
    public void Classify_returns_first_matching_category_or_null()
    {
        Assert.Equal("battery", SignalCompareControlsCategories.Classify("battery_range")?.Id);
        Assert.Equal("drive", SignalCompareControlsCategories.Classify("gear_position")?.Id);
        Assert.Null(SignalCompareControlsCategories.Classify("totally_unknown_field"));
        Assert.Null(SignalCompareControlsCategories.Classify(null));
    }

    // ── Presets: five web presets, in order, value = wire ────────────────────────────────────────────

    [Fact]
    public void Presets_are_the_five_web_presets_in_order()
    {
        var wires = Project(Model()).Presets.Select(p => p.Wire).ToArray();

        Assert.Equal(
            new[] { "now-vs-1h", "now-vs-1d", "before-after-charge", "last-drive", "today-vs-yesterday" },
            wires);
    }

    [Fact]
    public void Preset_buttons_resolve_their_web_labels()
    {
        var presets = Project(Model()).Presets;

        Assert.Equal("Now vs 1h ago", presets[0].Label);
        Assert.Equal("Now vs 1 day ago", presets[1].Label);
        Assert.Equal("Before vs after last charge", presets[2].Label);
        Assert.Equal("Last drive start vs end", presets[3].Label);
        Assert.Equal("Today vs yesterday (same time)", presets[4].Label);
    }

    [Fact]
    public void Preset_compute_reproduces_the_web_relative_time_maths()
    {
        var now = new DateTime(2024, 1, 15, 13, 45, 0, DateTimeKind.Local);

        AssertWindows(DiffPresetId.NowVs1h, now, "2024-01-15T12:45", "2024-01-15T13:45");
        AssertWindows(DiffPresetId.NowVs1d, now, "2024-01-14T13:45", "2024-01-15T13:45");
        AssertWindows(DiffPresetId.BeforeAfterCharge, now, "2024-01-15T09:45", "2024-01-15T13:45");
        AssertWindows(DiffPresetId.LastDrive, now, "2024-01-15T12:15", "2024-01-15T13:40");
        AssertWindows(DiffPresetId.TodayVsYesterday, now, "2024-01-14T13:45", "2024-01-15T13:45");
    }

    private static void AssertWindows(DiffPresetId id, DateTime now, string expectedA, string expectedB)
    {
        var (atA, atB) = SignalCompareControlsPresets.Get(id).Compute(now);

        Assert.Equal(expectedA, SignalCompareControlsTime.ToLocalDatetimeInput(atA));
        Assert.Equal(expectedB, SignalCompareControlsTime.ToLocalDatetimeInput(atB));
    }

    // ── datetime-local ⇄ ISO helpers ─────────────────────────────────────────────────────────────────

    [Fact]
    public void ToLocalDatetimeInput_formats_minutes_precision_without_zone()
    {
        var dt = new DateTime(2024, 3, 9, 7, 5, 0, DateTimeKind.Local);

        Assert.Equal("2024-03-09T07:05", SignalCompareControlsTime.ToLocalDatetimeInput(dt));
    }

    [Fact]
    public void IsoOrEmpty_is_empty_for_blank_or_invalid_input()
    {
        Assert.Equal(string.Empty, SignalCompareControlsTime.IsoOrEmpty(string.Empty));
        Assert.Equal(string.Empty, SignalCompareControlsTime.IsoOrEmpty(null));
        Assert.Equal(string.Empty, SignalCompareControlsTime.IsoOrEmpty("not-a-date"));
    }

    [Fact]
    public void IsoOrEmpty_round_trips_a_local_value_through_utc()
    {
        const string local = "2024-01-15T13:45";

        string iso = SignalCompareControlsTime.IsoOrEmpty(local);

        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", iso);

        var utc = DateTime.Parse(iso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        Assert.Equal(local, SignalCompareControlsTime.ToLocalDatetimeInput(utc.ToLocalTime()));
    }

    [Fact]
    public void TryParseLocalInput_parses_valid_and_rejects_blank_or_invalid()
    {
        Assert.True(SignalCompareControlsTime.TryParseLocalInput("2024-01-15T13:45", out var parsed));
        Assert.Equal("2024-01-15T13:45", SignalCompareControlsTime.ToLocalDatetimeInput(parsed));

        Assert.False(SignalCompareControlsTime.TryParseLocalInput(string.Empty, out _));
        Assert.False(SignalCompareControlsTime.TryParseLocalInput("nope", out _));
    }

    // ── Projection: labels, echoed selection, active category, clear affordance ──────────────────────

    [Fact]
    public void Window_and_section_labels_use_the_web_fallbacks()
    {
        var display = Project(Model());

        Assert.Equal("Window A", display.WindowALabel);
        Assert.Equal("Window B", display.WindowBLabel);
        Assert.Equal("Quick presets:", display.PresetsLabel);
        Assert.Equal("Filter signals\u2026", display.FilterHint);
        Assert.Equal("Clear", display.ClearLabel);
    }

    [Fact]
    public void Help_copy_uses_the_web_fallbacks()
    {
        var display = Project(Model());

        Assert.StartsWith("A snapshot is a point-in-time view", display.SnapshotHelp);
        Assert.Equal("More info about signal snapshots", display.SnapshotHelpAria);
        Assert.StartsWith("Server-side comparison between two snapshots", display.DiffHelp);
        Assert.Equal("More info about signal diffs", display.DiffHelpAria);
    }

    [Fact]
    public void Selection_is_echoed_unchanged()
    {
        var display = Project(Model(atA: "2024-01-15T01:00", atB: "2024-01-15T02:00", search: "soc"));

        Assert.Equal("2024-01-15T01:00", display.AtA);
        Assert.Equal("2024-01-15T02:00", display.AtB);
        Assert.Equal("soc", display.Search);
    }

    [Fact]
    public void No_category_means_no_chip_active_and_no_clear()
    {
        var display = Project(Model());

        Assert.All(display.Categories, c => Assert.False(c.Active));
        Assert.False(display.ShowClear);
    }

    [Fact]
    public void Selected_category_marks_only_that_chip_active_and_shows_clear()
    {
        var display = Project(Model(category: "motor"));

        Assert.True(display.ShowClear);
        Assert.Single(display.Categories, c => c.Active);
        Assert.True(display.Categories.Single(c => c.Id == "motor").Active);
    }

    [Fact]
    public void Unknown_category_marks_nothing_active_but_still_shows_clear()
    {
        var display = Project(Model(category: "does-not-exist"));

        Assert.All(display.Categories, c => Assert.False(c.Active));
        Assert.True(display.ShowClear);
    }

    [Theory]
    [InlineData(null, "battery", "battery")]
    [InlineData("battery", "battery", null)]
    [InlineData("drive", "battery", "battery")]
    public void ToggleCategory_matches_the_web_toggle_rule(string? current, string chipId, string? expected)
    {
        Assert.Equal(expected, SignalCompareControlsProjection.ToggleCategory(current, chipId));
    }

    // ── i18n: every label resolves through its P1/S10 catalog key ────────────────────────────────────

    [Fact]
    public void Field_labels_resolve_through_their_catalog_keys()
    {
        var display = SignalCompareControlsProjection.Project(Model(), new PrefixLocalizer());

        Assert.Equal("L:translation.signalDiff.windowA", display.WindowALabel);
        Assert.Equal("L:translation.signalDiff.windowB", display.WindowBLabel);
        Assert.Equal("L:translation.signalDiff.presetsLabel", display.PresetsLabel);
        Assert.Equal("L:translation.signalDiff.filterPlaceholder", display.FilterHint);
        Assert.Equal("L:translation.signalDiff.clearCategory", display.ClearLabel);
    }

    [Fact]
    public void Help_copy_resolves_through_its_catalog_keys()
    {
        var display = SignalCompareControlsProjection.Project(Model(), new PrefixLocalizer());

        Assert.Equal("L:translation.help.signal.snapshot", display.SnapshotHelp);
        Assert.Equal("L:translation.help.signal.snapshot.aria", display.SnapshotHelpAria);
        Assert.Equal("L:translation.help.signal.diff", display.DiffHelp);
        Assert.Equal("L:translation.help.signal.diff.aria", display.DiffHelpAria);
    }

    [Fact]
    public void Preset_and_category_labels_resolve_through_their_catalog_keys()
    {
        var display = SignalCompareControlsProjection.Project(Model(), new PrefixLocalizer());

        Assert.Equal("L:translation.signalDiff.preset.nowVs1h", display.Presets[0].Label);
        Assert.Equal("L:translation.signalDiff.preset.todayVsYesterday", display.Presets[4].Label);
        Assert.Equal("L:translation.signalDiff.cat.battery", display.Categories[0].Label);
        Assert.Equal("L:translation.signalDiff.cat.safety", display.Categories[7].Label);
    }

    // ── Accessibility: every branch exposes a non-empty automation name + labelled controls ──────────

    [Fact]
    public void Every_branch_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Model()),
                Project(Model(category: "battery")),
                Project(Model(atA: "2024-01-15T01:00", atB: "2024-01-15T02:00", search: "temp", category: "climate")),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Automation_name_includes_the_active_category_label()
    {
        var display = Project(Model(category: "tire"));

        Assert.Contains("Tire", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_preset_and_chip_carries_a_non_empty_label()
    {
        var display = Project(Model());

        Assert.All(display.Presets, p => Assert.False(string.IsNullOrWhiteSpace(p.Label)));
        Assert.All(display.Categories, c => Assert.False(string.IsNullOrWhiteSpace(c.Label)));
    }

    // ── Diagnostics (P1/S11): view.opened slug=SignalCompareControls, PII-safe ───────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SignalCompareControlsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalCompareControls", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("SignalCompareControls", SignalCompareControlsRegistration.Slug);
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
