using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.IngestXRay;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>XRayControls</c> feature surface's UI-thread-free logic — the option
/// projection (the vehicle prompt + per-vehicle label rule, the five window options, the five bucket options
/// with the per-window auto-disable guard), the selected-value mapping, the fleet-status → render-branch
/// machine (loading / ready / empty / stale / offline / error), the localized labels + status copy, the
/// accessible name, the wire round-trips driving the change events, and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/ingest-xray/XRayControls.tsx). The WinUI view itself is exercised by the
/// app build.
/// </summary>
public sealed class XRayControlsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static XRayControlsModel Model(
        IReadOnlyList<VehicleOption>? vehicles = null,
        int? vehicleId = null,
        IngestXRayWindow window = IngestXRayWindow.H1,
        IngestXRayBucket bucket = IngestXRayBucket.M1,
        XRayVehiclesStatus status = XRayVehiclesStatus.Resolved) =>
        new(vehicles ?? Array.Empty<VehicleOption>(), vehicleId, window, bucket, status);

    private static XRayControlsDisplay Project(XRayControlsModel model) =>
        XRayControlsProjection.Project(model, Localizer);

    private static IReadOnlyList<VehicleOption> TwoVehicles() => new[]
    {
        new VehicleOption(7, "Garage Car"),
        new VehicleOption(9, null, "5YJ3E1EA7KF000000"),
    };

    // ── Render branch: fleet status, then vehicle count ─────────────────────────────────────────────

    [Fact]
    public void Loading_when_fleet_is_loading()
    {
        Assert.Equal(XRayControlsState.Loading, Project(Model(status: XRayVehiclesStatus.Loading)).State);
    }

    [Fact]
    public void Ready_when_vehicles_present_and_resolved()
    {
        Assert.Equal(XRayControlsState.Ready, Project(Model(vehicles: TwoVehicles())).State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_vehicles()
    {
        Assert.Equal(XRayControlsState.Empty, Project(Model()).State);
    }

    [Theory]
    [InlineData(XRayVehiclesStatus.Stale, XRayControlsState.Stale)]
    [InlineData(XRayVehiclesStatus.Offline, XRayControlsState.Offline)]
    [InlineData(XRayVehiclesStatus.Error, XRayControlsState.Error)]
    public void Maps_fleet_status_to_its_branch(XRayVehiclesStatus status, XRayControlsState expected)
    {
        Assert.Equal(expected, Project(Model(vehicles: TwoVehicles(), status: status)).State);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Model(status: XRayVehiclesStatus.Loading)),
                Project(Model(vehicles: TwoVehicles())),
                Project(Model()),
                Project(Model(vehicles: TwoVehicles(), status: XRayVehiclesStatus.Stale)),
                Project(Model(vehicles: TwoVehicles(), status: XRayVehiclesStatus.Offline)),
                Project(Model(status: XRayVehiclesStatus.Error)),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    // ── Vehicle options: prompt first, then the web display_name || vin || `Vehicle ${id}` rule ─────

    [Fact]
    public void Vehicle_options_lead_with_the_select_prompt()
    {
        var options = Project(Model(vehicles: TwoVehicles())).VehicleOptions;

        Assert.Equal(string.Empty, options[0].Value);
        Assert.Equal("Select vehicle\u2026", options[0].Label);
    }

    [Fact]
    public void Vehicle_options_map_each_vehicle_to_id_value_and_web_label()
    {
        var options = Project(Model(vehicles: TwoVehicles())).VehicleOptions;

        Assert.Equal(3, options.Count); // prompt + 2

        Assert.Equal("7", options[1].Value);
        Assert.Equal("Garage Car", options[1].Label); // display_name wins

        Assert.Equal("9", options[2].Value);
        Assert.Equal("5YJ3E1EA7KF000000", options[2].Label); // falls back to vin
    }

    [Fact]
    public void Vehicle_label_falls_back_to_vehicle_id_when_unnamed()
    {
        var options = Project(Model(vehicles: new[] { new VehicleOption(42) })).VehicleOptions;

        Assert.Equal("42", options[1].Value);
        Assert.Equal("Vehicle 42", options[1].Label);
    }

    [Fact]
    public void Empty_fleet_still_renders_the_prompt_only()
    {
        var options = Project(Model()).VehicleOptions;

        Assert.Single(options);
        Assert.Equal(string.Empty, options[0].Value);
    }

    // ── Window options: the five web windows, value = wire ──────────────────────────────────────────

    [Fact]
    public void Window_options_are_the_five_web_windows()
    {
        var values = Project(Model()).WindowOptions.Select(o => o.Value).ToArray();

        Assert.Equal(new[] { "5m", "15m", "1h", "6h", "24h" }, values);
    }

    [Fact]
    public void Window_option_labels_fall_back_to_the_raw_wire()
    {
        var labels = Project(Model()).WindowOptions.Select(o => o.Label).ToArray();

        Assert.Equal(new[] { "5m", "15m", "1h", "6h", "24h" }, labels);
    }

    [Fact]
    public void No_window_option_is_ever_disabled()
    {
        Assert.All(Project(Model()).WindowOptions, o => Assert.False(o.Disabled));
    }

    // ── Bucket options: the five web buckets + the BUCKET_SECS >= WINDOW_SECS auto-disable guard ─────

    [Fact]
    public void Bucket_options_are_the_five_web_buckets()
    {
        var values = Project(Model()).BucketOptions.Select(o => o.Value).ToArray();

        Assert.Equal(new[] { "30s", "1m", "5m", "15m", "1h" }, values);
    }

    [Theory]
    // window 5m (300s): only 30s + 1m remain valid.
    [InlineData(IngestXRayWindow.M5, "30s,1m")]
    // window 15m (900s): 30s + 1m + 5m valid.
    [InlineData(IngestXRayWindow.M15, "30s,1m,5m")]
    // window 1h (3600s): everything but 1h valid.
    [InlineData(IngestXRayWindow.H1, "30s,1m,5m,15m")]
    // window 24h (86400s): every bucket valid.
    [InlineData(IngestXRayWindow.H24, "30s,1m,5m,15m,1h")]
    public void Bucket_options_disable_any_granularity_at_or_above_the_window(
        IngestXRayWindow window,
        string expectedEnabled)
    {
        var enabled = Project(Model(window: window)).BucketOptions
            .Where(o => !o.Disabled)
            .Select(o => o.Value);

        Assert.Equal(expectedEnabled, string.Join(",", enabled));
    }

    [Fact]
    public void Bucket_disable_rule_matches_the_web_threshold()
    {
        // BUCKET_SECS[5m] (300) >= WINDOW_SECS[5m] (300) → disabled (the web uses >=, not >).
        Assert.True(XRayControlsProjection.IsBucketDisabled(IngestXRayBucket.M5, IngestXRayWindow.M5));
        // BUCKET_SECS[1m] (60) < WINDOW_SECS[5m] (300) → enabled.
        Assert.False(XRayControlsProjection.IsBucketDisabled(IngestXRayBucket.M1, IngestXRayWindow.M5));
    }

    // ── Selected values: vehicle (null → "", id → string), window + bucket wire ─────────────────────

    [Fact]
    public void Selected_vehicle_value_is_empty_when_none_selected()
    {
        Assert.Equal(string.Empty, Project(Model(vehicles: TwoVehicles())).SelectedVehicleValue);
    }

    [Fact]
    public void Selected_vehicle_value_is_the_id_string_when_selected()
    {
        Assert.Equal("9", Project(Model(vehicles: TwoVehicles(), vehicleId: 9)).SelectedVehicleValue);
    }

    [Fact]
    public void Selected_window_and_bucket_values_are_the_wire_literals()
    {
        var display = Project(Model(window: IngestXRayWindow.H6, bucket: IngestXRayBucket.M15));

        Assert.Equal("6h", display.SelectedWindowValue);
        Assert.Equal("15m", display.SelectedBucketValue);
    }

    // ── Picker enabled: disabled only while loading / errored ───────────────────────────────────────

    [Theory]
    [InlineData(XRayVehiclesStatus.Loading, false)]
    [InlineData(XRayVehiclesStatus.Error, false)]
    [InlineData(XRayVehiclesStatus.Resolved, true)]
    [InlineData(XRayVehiclesStatus.Stale, true)]
    [InlineData(XRayVehiclesStatus.Offline, true)]
    public void Vehicle_picker_is_disabled_only_while_loading_or_errored(
        XRayVehiclesStatus status,
        bool enabled)
    {
        Assert.Equal(enabled, Project(Model(vehicles: TwoVehicles(), status: status)).VehiclePickerEnabled);
    }

    // ── Status chip / hint / retry per branch ───────────────────────────────────────────────────────

    [Fact]
    public void Stale_branch_shows_a_warning_chip_and_no_retry()
    {
        var display = Project(Model(vehicles: TwoVehicles(), status: XRayVehiclesStatus.Stale));

        Assert.Equal("Stale", display.StatusChip);
        Assert.Equal(StatusKind.Warning, display.StatusChipKind);
        Assert.Null(display.RetryLabel);
    }

    [Fact]
    public void Offline_branch_shows_a_danger_chip()
    {
        var display = Project(Model(vehicles: TwoVehicles(), status: XRayVehiclesStatus.Offline));

        Assert.Equal("Offline", display.StatusChip);
        Assert.Equal(StatusKind.Danger, display.StatusChipKind);
    }

    [Fact]
    public void Error_branch_shows_a_hint_and_a_retry_affordance()
    {
        var display = Project(Model(status: XRayVehiclesStatus.Error));

        Assert.Equal("Couldn\u2019t load vehicles", display.Hint);
        Assert.Equal("Try again", display.RetryLabel);
        Assert.Null(display.StatusChip);
    }

    [Fact]
    public void Loading_branch_shows_a_loading_hint()
    {
        Assert.Equal("Loading vehicles\u2026", Project(Model(status: XRayVehiclesStatus.Loading)).Hint);
    }

    [Fact]
    public void Empty_branch_shows_a_friendly_hint()
    {
        Assert.Equal(
            "No vehicles are linked yet. Add a vehicle to inspect its ingest X-Ray.",
            Project(Model()).Hint);
    }

    [Fact]
    public void Ready_branch_shows_no_chip_hint_or_retry()
    {
        var display = Project(Model(vehicles: TwoVehicles()));

        Assert.Null(display.StatusChip);
        Assert.Null(display.Hint);
        Assert.Null(display.RetryLabel);
    }

    // ── i18n: every label resolves through its P1/S10 catalog key ───────────────────────────────────

    [Fact]
    public void Field_labels_and_prompt_resolve_through_their_catalog_keys()
    {
        var display = XRayControlsProjection.Project(Model(vehicles: TwoVehicles()), new PrefixLocalizer());

        Assert.Equal("L:translation.admin.xray.controls.vehicleAria", display.VehicleLabel);
        Assert.Equal("L:translation.admin.xray.controls.windowAria", display.WindowLabel);
        Assert.Equal("L:translation.admin.xray.controls.bucketAria", display.BucketLabel);
        Assert.Equal("L:translation.admin.xray.controls.selectVehicle", display.VehiclePrompt);
    }

    [Fact]
    public void Window_and_bucket_option_labels_resolve_through_their_catalog_keys()
    {
        var display = XRayControlsProjection.Project(Model(), new PrefixLocalizer());

        Assert.Equal("L:translation.admin.xray.windowOption.5m", display.WindowOptions[0].Label);
        Assert.Equal("L:translation.admin.xray.bucketOption.30s", display.BucketOptions[0].Label);
    }

    [Fact]
    public void Status_copy_resolves_through_its_catalog_keys()
    {
        var prefix = new PrefixLocalizer();

        Assert.Equal(
            "L:translation.admin.xray.controls.stale",
            XRayControlsProjection.Project(Model(vehicles: TwoVehicles(), status: XRayVehiclesStatus.Stale), prefix).StatusChip);
        Assert.Equal(
            "L:translation.admin.xray.controls.error",
            XRayControlsProjection.Project(Model(status: XRayVehiclesStatus.Error), prefix).Hint);
        Assert.Equal(
            "L:translation.admin.xray.controls.retry",
            XRayControlsProjection.Project(Model(status: XRayVehiclesStatus.Error), prefix).RetryLabel);
    }

    // ── Wire round-trips driving the change events ──────────────────────────────────────────────────

    [Theory]
    [InlineData(IngestXRayWindow.M5, "5m")]
    [InlineData(IngestXRayWindow.M15, "15m")]
    [InlineData(IngestXRayWindow.H1, "1h")]
    [InlineData(IngestXRayWindow.H6, "6h")]
    [InlineData(IngestXRayWindow.H24, "24h")]
    public void Window_wire_round_trips(IngestXRayWindow window, string wire)
    {
        Assert.Equal(wire, IngestXRayWindows.Wire(window));
        Assert.Equal(window, IngestXRayWindows.FromWire(wire));
    }

    [Theory]
    [InlineData(IngestXRayBucket.S30, "30s")]
    [InlineData(IngestXRayBucket.M1, "1m")]
    [InlineData(IngestXRayBucket.M5, "5m")]
    [InlineData(IngestXRayBucket.M15, "15m")]
    [InlineData(IngestXRayBucket.H1, "1h")]
    public void Bucket_wire_round_trips(IngestXRayBucket bucket, string wire)
    {
        Assert.Equal(wire, IngestXRayBuckets.Wire(bucket));
        Assert.Equal(bucket, XRayControlsBuckets.FromWire(wire));
    }

    [Fact]
    public void Bucket_from_wire_defaults_to_one_minute_for_garbage()
    {
        Assert.Equal(IngestXRayBucket.M1, XRayControlsBuckets.FromWire("nonsense"));
    }

    // ── Diagnostics (P1/S11): view.opened slug=XRayControls, PII-safe ───────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new XRayControlsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=XRayControls", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("XRayControls", XRayControlsRegistration.Slug);
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
