using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>VehicleConfigSection</c> feature surface's UI-thread-free logic — the
/// per-state branch projection (loading / error / empty / stale / offline / ready), the twelve configuration
/// rows (label order, <c>?? '—'</c> null handling, <c>Yes</c> / <c>No</c> booleans, the
/// <c>software_update_version ?? softwareVersion</c> fallback), the freshness chip copy, the accessible names,
/// and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx). The WinUI view itself
/// (VehicleConfigSection.cs) is exercised by the app build.
/// </summary>
public sealed class VehicleConfigSectionTests
{
    private const string EmDash = "\u2014";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static VehicleConfigData FullConfig() => new(
        CarType: "models",
        Trim: "P100D",
        ExteriorColor: "RedMulticoat",
        WheelType: "Turbine22",
        RoofColor: "Glass",
        ChargePort: "US",
        RightHandDrive: false,
        EuropeVehicle: false,
        OffroadLightbarPresent: false,
        RearSeatHeaters: "Front and Rear",
        SunroofInstalled: "None",
        SoftwareUpdateVersion: "2024.8.9");

    private static VehicleConfigSectionDisplay Project(VehicleConfigSectionModel model) =>
        VehicleConfigSectionProjection.Project(model, Localizer);

    // ── Branch precedence: loading → error → empty → freshness → ready ─────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(VehicleConfigSectionState.Loading, Project(VehicleConfigSectionModel.Loading).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(VehicleConfigSectionState.Error, Project(VehicleConfigSectionModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(VehicleConfigSectionState.Empty, Project(VehicleConfigSectionModel.Empty).State);

    [Fact]
    public void Ready_when_snapshot_present() =>
        Assert.Equal(VehicleConfigSectionState.Ready, Project(VehicleConfigSectionModel.Ready(FullConfig())).State);

    [Fact]
    public void Stale_keeps_its_branch()
    {
        // Freshness wins: a stale cached snapshot keeps its chip rather than reclassifying.
        Assert.Equal(
            VehicleConfigSectionState.Stale,
            Project(VehicleConfigSectionModel.Stale(FullConfig())).State);
    }

    [Fact]
    public void Offline_keeps_its_branch() =>
        Assert.Equal(
            VehicleConfigSectionState.Offline,
            Project(VehicleConfigSectionModel.Offline(FullConfig())).State);

    // ── Title ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_resolves_from_the_facade() =>
        Assert.Equal("Vehicle Configuration", Project(VehicleConfigSectionModel.Ready(FullConfig())).Title);

    // ── The twelve rows (web KVList items: order, labels, values) ──────────────────────────────────────

    [Fact]
    public void Ready_renders_twelve_rows() =>
        Assert.Equal(12, Project(VehicleConfigSectionModel.Ready(FullConfig())).Items.Count);

    [Fact]
    public void Rows_follow_the_web_label_order()
    {
        var labels = Project(VehicleConfigSectionModel.Ready(FullConfig())).Items.Select(i => i.Label).ToArray();

        Assert.Equal(
            new[]
            {
                "Car Type",
                "Trim",
                "Exterior Color",
                "Wheels",
                "Roof Color",
                "Charge Port",
                "Right-Hand Drive",
                "Europe Vehicle",
                "Offroad Lightbar",
                "Rear Seat Heaters",
                "Sunroof",
                "Software",
            },
            labels);
    }

    [Fact]
    public void String_rows_carry_their_snapshot_values()
    {
        var items = Project(VehicleConfigSectionModel.Ready(FullConfig())).Items;

        Assert.Equal("models", items[0].Value);
        Assert.Equal("P100D", items[1].Value);
        Assert.Equal("RedMulticoat", items[2].Value);
        Assert.Equal("Turbine22", items[3].Value);
        Assert.Equal("Glass", items[4].Value);
        Assert.Equal("US", items[5].Value);
        Assert.Equal("Front and Rear", items[9].Value);
        Assert.Equal("None", items[10].Value);
    }

    [Fact]
    public void Absent_string_fields_render_the_em_dash()
    {
        var items = Project(VehicleConfigSectionModel.Ready(new VehicleConfigData())).Items;

        Assert.Equal(EmDash, items[0].Value); // Car Type
        Assert.Equal(EmDash, items[1].Value); // Trim
        Assert.Equal(EmDash, items[10].Value); // Sunroof
    }

    // ── Boolean rows (web `flag != null ? (flag ? Yes : No) : '—'`) ────────────────────────────────────

    [Fact]
    public void True_boolean_renders_yes()
    {
        var config = new VehicleConfigData(RightHandDrive: true, EuropeVehicle: true, OffroadLightbarPresent: true);
        var items = Project(VehicleConfigSectionModel.Ready(config)).Items;

        Assert.Equal("Yes", items[6].Value); // Right-Hand Drive
        Assert.Equal("Yes", items[7].Value); // Europe Vehicle
        Assert.Equal("Yes", items[8].Value); // Offroad Lightbar
    }

    [Fact]
    public void False_boolean_renders_no()
    {
        var items = Project(VehicleConfigSectionModel.Ready(FullConfig())).Items;

        Assert.Equal("No", items[6].Value); // Right-Hand Drive
        Assert.Equal("No", items[7].Value); // Europe Vehicle
        Assert.Equal("No", items[8].Value); // Offroad Lightbar
    }

    [Fact]
    public void Null_boolean_renders_the_em_dash()
    {
        var items = Project(VehicleConfigSectionModel.Ready(new VehicleConfigData())).Items;

        Assert.Equal(EmDash, items[6].Value); // Right-Hand Drive
        Assert.Equal(EmDash, items[7].Value); // Europe Vehicle
        Assert.Equal(EmDash, items[8].Value); // Offroad Lightbar
    }

    // ── Software row fallback (web `software_update_version ?? softwareVersion ?? '—'`) ────────────────

    [Fact]
    public void Software_row_prefers_the_snapshot_version()
    {
        var config = FullConfig() with { SoftwareUpdateVersion = "2024.8.9" };
        var items = Project(VehicleConfigSectionModel.Ready(config, softwareVersion: "2023.1.1")).Items;

        Assert.Equal("2024.8.9", items[11].Value);
    }

    [Fact]
    public void Software_row_falls_back_to_the_software_version_prop()
    {
        var config = FullConfig() with { SoftwareUpdateVersion = null };
        var items = Project(VehicleConfigSectionModel.Ready(config, softwareVersion: "2023.1.1")).Items;

        Assert.Equal("2023.1.1", items[11].Value);
    }

    [Fact]
    public void Software_row_is_the_em_dash_when_both_are_absent()
    {
        var config = FullConfig() with { SoftwareUpdateVersion = null };
        var items = Project(VehicleConfigSectionModel.Ready(config, softwareVersion: null)).Items;

        Assert.Equal(EmDash, items[11].Value);
    }

    // ── Empty-of-rows states ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Loading_empty_and_error_have_no_rows()
    {
        Assert.Empty(Project(VehicleConfigSectionModel.Loading).Items);
        Assert.Empty(Project(VehicleConfigSectionModel.Empty).Items);
        Assert.Empty(Project(VehicleConfigSectionModel.Failed()).Items);
    }

    // ── Freshness chip ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Project(VehicleConfigSectionModel.Ready(FullConfig())).ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(VehicleConfigSectionModel.Stale(FullConfig()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(VehicleConfigSectionModel.Offline(FullConfig()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_rows()
    {
        var items = Project(VehicleConfigSectionModel.Offline(FullConfig())).Items;

        Assert.Equal(12, items.Count);
        Assert.Equal("models", items[0].Value);
        Assert.Equal("2024.8.9", items[11].Value);
    }

    // ── Fixed copy (loading / empty / error / retry) ───────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(VehicleConfigSectionModel.Loading).LoadingLabel);

    [Fact]
    public void Empty_message_is_a_friendly_string() =>
        Assert.Equal(
            "No vehicle configuration available",
            Project(VehicleConfigSectionModel.Empty).EmptyMessage);

    [Fact]
    public void Error_title_is_resolved() =>
        Assert.Equal("Couldn't load vehicle configuration", Project(VehicleConfigSectionModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "We couldn't load this vehicle's configuration. Please try again.",
            Project(VehicleConfigSectionModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal(
            "Network unreachable",
            Project(VehicleConfigSectionModel.Failed("Network unreachable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(VehicleConfigSectionModel.Failed()).RetryLabel);

    [Fact]
    public void Em_dash_constant_is_u2014() =>
        Assert.Equal("\u2014", VehicleConfigSectionProjection.EmptyValue);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(VehicleConfigSectionModel.Loading),
                Project(VehicleConfigSectionModel.Empty),
                Project(VehicleConfigSectionModel.Failed()),
                Project(VehicleConfigSectionModel.Stale(FullConfig())),
                Project(VehicleConfigSectionModel.Offline(FullConfig())),
                Project(VehicleConfigSectionModel.Ready(FullConfig())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_pairs_the_title_and_loading_label() =>
        Assert.Equal("Vehicle Configuration. Loading", Project(VehicleConfigSectionModel.Loading).AutomationName);

    [Fact]
    public void Empty_automation_name_pairs_the_title_and_empty_message() =>
        Assert.Equal(
            "Vehicle Configuration. No vehicle configuration available",
            Project(VehicleConfigSectionModel.Empty).AutomationName);

    [Fact]
    public void Error_automation_name_pairs_the_title_and_error_title() =>
        Assert.Equal(
            "Vehicle Configuration. Couldn't load vehicle configuration",
            Project(VehicleConfigSectionModel.Failed()).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_title_and_every_row()
    {
        var display = Project(VehicleConfigSectionModel.Ready(FullConfig()));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        foreach (var item in display.Items)
        {
            Assert.Contains(item.AutomationName, display.AutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Row_automation_name_carries_label_and_value()
    {
        var item = Project(VehicleConfigSectionModel.Ready(FullConfig())).Items[0];

        Assert.Equal("Car Type, models", item.AutomationName);
    }

    [Fact]
    public void Stale_automation_name_includes_the_chip() =>
        Assert.Contains(
            "Stale",
            Project(VehicleConfigSectionModel.Stale(FullConfig())).AutomationName,
            StringComparison.Ordinal);

    // ── Diagnostics (P1/S11): view.opened slug=VehicleConfigSection, PII-safe ──────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new VehicleConfigSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleConfigSection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_configuration()
    {
        var captured = new List<string>();
        var diagnostics = new VehicleConfigSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=VehicleConfigSection", line);
        Assert.DoesNotContain("P100D", line, StringComparison.Ordinal);
        Assert.DoesNotContain("models", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("VehicleConfigSection", VehicleConfigSectionRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => VehicleConfigSectionProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => VehicleConfigSectionProjection.Project(VehicleConfigSectionModel.Loading, null!));

    [Fact]
    public void Ready_rejects_a_null_config() =>
        Assert.Throws<ArgumentNullException>(() => VehicleConfigSectionModel.Ready(null!));
}
