using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>JourneyDetailsPanel</c> feature surface's UI-thread-free logic — the
/// per-state branch projection (loading / error / empty / stale / offline / ready), the web address
/// fall-through (address → truthy lat &amp; lon coordinates → "No address data" / "In progress"), the
/// signed-latitude / absolute-longitude coordinate formatting with its cardinal letters, the raw
/// "<c>Battery: {n}%</c>" line, the destination "In progress" timestamp, the freshness chip copy, the accessible
/// names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx). The WinUI view itself
/// (JourneyDetailsPanel.cs) is exercised by the app build.
/// </summary>
public sealed class JourneyDetailsPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset StartTs = new(2026, 4, 4, 14, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset EndTs = new(2026, 4, 4, 15, 10, 0, TimeSpan.Zero);

    private static JourneyDetailsPanelDisplay Project(JourneyDetailsPanelModel model) =>
        JourneyDetailsPanelProjection.Project(model, Localizer);

    private static JourneyDetailsPanelModel Ready(
        string? startAddress = null,
        string? endAddress = null,
        double? startLat = null,
        double? startLon = null,
        double? endLat = null,
        double? endLon = null,
        double? startBattery = null,
        double? endBattery = null,
        DateTimeOffset? startTs = null,
        DateTimeOffset? endTs = null) =>
        JourneyDetailsPanelModel.Ready(
            startTs,
            endTs,
            startAddress,
            endAddress,
            startLat,
            startLon,
            endLat,
            endLon,
            startBattery,
            endBattery);

    // ── Branch precedence: loading → error → empty → freshness → ready ──────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(JourneyDetailsPanelState.Loading, Project(JourneyDetailsPanelModel.Loading).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(JourneyDetailsPanelState.Error, Project(JourneyDetailsPanelModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(JourneyDetailsPanelState.Empty, Project(JourneyDetailsPanelModel.Empty).State);

    [Fact]
    public void Ready_when_model_is_ready() =>
        Assert.Equal(JourneyDetailsPanelState.Ready, Project(Ready(startAddress: "Home")).State);

    [Fact]
    public void Stale_keeps_its_branch()
    {
        var model = JourneyDetailsPanelModel.Stale(StartTs, EndTs, "A", "B", null, null, null, null, 90, 64);
        Assert.Equal(JourneyDetailsPanelState.Stale, Project(model).State);
    }

    [Fact]
    public void Offline_keeps_its_branch()
    {
        var model = JourneyDetailsPanelModel.Offline(StartTs, EndTs, "A", "B", null, null, null, null, 90, 64);
        Assert.Equal(JourneyDetailsPanelState.Offline, Project(model).State);
    }

    // ── Title + endpoint labels ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_resolves_from_the_facade() =>
        Assert.Equal("Journey Details", Project(Ready()).Title);

    [Fact]
    public void Start_label_resolves_from_the_facade() =>
        Assert.Equal("Start", Project(Ready()).Start.Label);

    [Fact]
    public void Destination_label_resolves_from_the_facade() =>
        Assert.Equal("Destination", Project(Ready()).Destination.Label);

    [Fact]
    public void Start_endpoint_is_the_start_kind() =>
        Assert.Equal(JourneyEndpointKind.Start, Project(Ready()).Start.Kind);

    [Fact]
    public void Destination_endpoint_is_the_destination_kind() =>
        Assert.Equal(JourneyEndpointKind.Destination, Project(Ready()).Destination.Kind);

    // ── Address fall-through (web: address → coords → "No address data" / "In progress") ────────────────

    [Fact]
    public void Start_prefers_a_non_empty_address()
    {
        var display = Project(Ready(startAddress: "1 Main St", startLat: 37.5, startLon: -122.5));

        Assert.Equal("1 Main St", display.Start.AddressText);
        Assert.False(display.Start.IsCoordinates);
    }

    [Fact]
    public void Start_falls_through_to_coordinates_when_no_address()
    {
        var display = Project(Ready(startLat: 37.5, startLon: -122.5));

        Assert.Equal("37.50\u00B0N, 122.50\u00B0W", display.Start.AddressText);
        Assert.True(display.Start.IsCoordinates);
    }

    [Fact]
    public void Start_falls_through_to_no_address_when_nothing_is_known()
    {
        var display = Project(Ready());

        Assert.Equal("No address data", display.Start.AddressText);
        Assert.False(display.Start.IsCoordinates);
    }

    [Fact]
    public void Destination_prefers_a_non_empty_address()
    {
        var display = Project(Ready(endAddress: "2 Market St", endLat: 34.0, endLon: -118.2, endTs: EndTs));

        Assert.Equal("2 Market St", display.Destination.AddressText);
        Assert.False(display.Destination.IsCoordinates);
    }

    [Fact]
    public void Destination_falls_through_to_coordinates_when_no_address()
    {
        var display = Project(Ready(endLat: 34.0, endLon: -118.2, endTs: EndTs));

        Assert.Equal("34.00\u00B0N, 118.20\u00B0W", display.Destination.AddressText);
        Assert.True(display.Destination.IsCoordinates);
    }

    [Fact]
    public void Destination_shows_no_address_when_the_drive_has_ended_without_a_location()
    {
        // web: endTs present but no address/coords → "No address data".
        var display = Project(Ready(endTs: EndTs));

        Assert.Equal("No address data", display.Destination.AddressText);
    }

    [Fact]
    public void Destination_shows_in_progress_when_the_drive_is_still_running()
    {
        // web: no endTs, no address/coords → "In progress".
        var display = Project(Ready(endTs: null));

        Assert.Equal("In progress", display.Destination.AddressText);
    }

    // ── Coordinate formatting: web `{fmtNumber(lat)}°{N|S}, {fmtNumber(|lon|)}°{E|W}` ────────────────────

    [Fact]
    public void Coordinates_use_signed_latitude_and_absolute_longitude_with_cardinals()
    {
        // Southern + eastern hemispheres: latitude keeps its sign (web fmtNumber(lat), not abs), longitude is
        // absolute, and each cardinal letter follows the original component's sign.
        Assert.Equal("-33.86\u00B0S, 151.20\u00B0E", JourneyDetailsPanelProjection.FormatCoordinates(-33.86, 151.2));
    }

    [Fact]
    public void Coordinates_round_half_away_from_zero_at_the_web_precision()
    {
        Assert.Equal("37.78\u00B0N, 122.42\u00B0W", JourneyDetailsPanelProjection.FormatCoordinates(37.775, -122.4194));
    }

    [Fact]
    public void Coordinate_precision_is_the_web_default() =>
        Assert.Equal(2, JourneyDetailsPanelProjection.CoordinatePrecision);

    [Theory]
    [InlineData(37.5, true)]
    [InlineData(-122.5, true)]
    [InlineData(0, false)]
    [InlineData(double.NaN, false)]
    public void Coordinate_truthiness_matches_the_web_guard(double value, bool expected) =>
        Assert.Equal(expected, JourneyDetailsPanelProjection.IsTruthyCoordinate(value));

    [Fact]
    public void Null_coordinate_is_not_truthy() =>
        Assert.False(JourneyDetailsPanelProjection.IsTruthyCoordinate(null));

    [Fact]
    public void A_zero_latitude_falls_through_past_coordinates()
    {
        // web `startLat && startLon` short-circuits on the falsy 0° latitude → the no-address fallback.
        var display = Project(Ready(startLat: 0, startLon: -122.5));

        Assert.Equal("No address data", display.Start.AddressText);
        Assert.False(display.Start.IsCoordinates);
    }

    // ── Battery line: web `Battery: {pct ?? '?'}%` ──────────────────────────────────────────────────────

    [Fact]
    public void Battery_line_pairs_the_label_value_and_percent() =>
        Assert.Equal("Battery: 90%", Project(Ready(startBattery: 90)).Start.BatteryText);

    [Fact]
    public void Battery_line_shows_the_question_sentinel_when_absent() =>
        Assert.Equal("Battery: ?%", Project(Ready(startBattery: null)).Start.BatteryText);

    [Fact]
    public void Battery_line_keeps_a_fractional_percentage_verbatim() =>
        Assert.Equal("Battery: 85.5%", JourneyDetailsPanelProjection.FormatBattery("Battery", 85.5));

    [Fact]
    public void Destination_battery_reads_the_end_percentage() =>
        Assert.Equal("Battery: 64%", Project(Ready(endBattery: 64)).Destination.BatteryText);

    // ── Timestamps: start always formats; destination shows "In progress" without an end ────────────────

    [Fact]
    public void Start_timestamp_uses_the_full_datetime_variant()
    {
        var expected = DateTimeFormatting.Format(StartTs, DateTimeVariant.Full, DateTimeOffset.UnixEpoch);

        Assert.Equal(expected, Project(Ready(startTs: StartTs)).Start.TimestampText);
    }

    [Fact]
    public void Destination_timestamp_uses_the_full_datetime_variant_when_ended()
    {
        var expected = DateTimeFormatting.Format(EndTs, DateTimeVariant.Full, DateTimeOffset.UnixEpoch);

        Assert.Equal(expected, Project(Ready(endTs: EndTs)).Destination.TimestampText);
    }

    [Fact]
    public void Destination_timestamp_is_in_progress_without_an_end() =>
        Assert.Equal("In progress", Project(Ready(endTs: null)).Destination.TimestampText);

    // ── Freshness chip ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Project(Ready(startAddress: "Home")).ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(JourneyDetailsPanelModel.Stale(StartTs, EndTs, "A", "B", null, null, null, null, 90, 64));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(JourneyDetailsPanelModel.Offline(StartTs, EndTs, "A", "B", null, null, null, null, 90, 64));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_endpoints()
    {
        var display = Project(
            JourneyDetailsPanelModel.Offline(StartTs, EndTs, "Cached Home", "Cached Work", null, null, null, null, 90, 64));

        Assert.Equal("Cached Home", display.Start.AddressText);
        Assert.Equal("Cached Work", display.Destination.AddressText);
        Assert.Equal("Battery: 90%", display.Start.BatteryText);
    }

    // ── Fixed copy (loading / empty / error / retry) ───────────────────────────────────────────────────

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(JourneyDetailsPanelModel.Loading).LoadingLabel);

    [Fact]
    public void Empty_message_uses_the_shared_no_data_string() =>
        Assert.Equal("No data available", Project(JourneyDetailsPanelModel.Empty).EmptyMessage);

    [Fact]
    public void Error_title_is_the_journey_section_failure_string() =>
        Assert.Equal("Journey details failed to load", Project(JourneyDetailsPanelModel.Failed()).ErrorTitle);

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "We couldn't load the journey details. Please try again.",
            Project(JourneyDetailsPanelModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal("Network unreachable", Project(JourneyDetailsPanelModel.Failed("Network unreachable")).ErrorMessage);

    [Fact]
    public void Retry_label_uses_the_shared_common_retry_string() =>
        Assert.Equal("Retry", Project(JourneyDetailsPanelModel.Failed()).RetryLabel);

    // ── Accessibility: every state exposes a meaningful Narrator name ───────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(JourneyDetailsPanelModel.Loading),
                Project(JourneyDetailsPanelModel.Empty),
                Project(JourneyDetailsPanelModel.Failed()),
                Project(JourneyDetailsPanelModel.Stale(StartTs, EndTs, "A", "B", null, null, null, null, 90, 64)),
                Project(JourneyDetailsPanelModel.Offline(StartTs, EndTs, "A", "B", null, null, null, null, 90, 64)),
                Project(Ready(startAddress: "Home", endAddress: "Work", endTs: EndTs)),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_pairs_the_title_and_loading_label() =>
        Assert.Equal("Journey Details. Loading", Project(JourneyDetailsPanelModel.Loading).AutomationName);

    [Fact]
    public void Empty_automation_name_pairs_the_title_and_empty_message() =>
        Assert.Equal(
            "Journey Details. No data available",
            Project(JourneyDetailsPanelModel.Empty).AutomationName);

    [Fact]
    public void Error_automation_name_pairs_the_title_and_error_title() =>
        Assert.Equal(
            "Journey Details. Journey details failed to load",
            Project(JourneyDetailsPanelModel.Failed()).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_title_and_both_endpoints()
    {
        var display = Project(Ready(startAddress: "Home", endAddress: "Work", endTs: EndTs));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Start.AutomationName, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Destination.AutomationName, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Endpoint_automation_name_carries_label_address_time_and_battery()
    {
        var display = Project(Ready(startAddress: "Home", startBattery: 90, startTs: StartTs));
        var start = display.Start;

        Assert.Contains(start.Label, start.AutomationName, StringComparison.Ordinal);
        Assert.Contains(start.AddressText, start.AutomationName, StringComparison.Ordinal);
        Assert.Contains(start.TimestampText, start.AutomationName, StringComparison.Ordinal);
        Assert.Contains(start.BatteryText, start.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_automation_name_includes_the_chip()
    {
        var display = Project(JourneyDetailsPanelModel.Stale(StartTs, EndTs, "A", "B", null, null, null, null, 90, 64));

        Assert.Contains("Stale", display.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=JourneyDetailsPanel, PII-safe ────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new JourneyDetailsPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=JourneyDetailsPanel", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_journey_location_or_battery()
    {
        var captured = new List<string>();
        var diagnostics = new JourneyDetailsPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=JourneyDetailsPanel", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain('\u00B0', line);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("JourneyDetailsPanel", JourneyDetailsPanelRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => JourneyDetailsPanelProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => JourneyDetailsPanelProjection.Project(JourneyDetailsPanelModel.Loading, null!));
}
