using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DriveDetailHeader</c> feature surface's UI-thread-free logic — the
/// route-vs-fallback title, the present-vs-live end-time branch, the loading skeleton branch, the localized
/// action labels + i18n key set, the value pass-through, the composed Narrator names, and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx). The WinUI view itself
/// (feature-views\DriveDetailHeader\DriveDetailHeader.cs) is exercised by the app build.
/// </summary>
public sealed class DriveDetailHeaderTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static readonly DateTimeOffset Start = new(2026, 4, 4, 14, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset End = new(2026, 4, 4, 15, 15, 0, TimeSpan.Zero);

    private static DriveDetailHeaderDisplay Project(DriveDetailHeaderModel model) =>
        DriveDetailHeaderProjection.Project(model, Localizer);

    private static DriveDetailHeaderModel Ready(
        string? startAddress = "1 Alpha St",
        string? endAddress = "2 Beta Ave",
        DateTimeOffset? startTs = null,
        DateTimeOffset? endTs = null,
        string driveId = "42",
        string vehicleName = "Model 3") =>
        new(new DriveHeaderSnapshot(startAddress, endAddress, startTs, endTs), driveId, vehicleName);

    // ── Loading branch (parent has not resolved the drive — skeleton chrome, never a blank box) ──────

    [Fact]
    public void Pending_model_projects_the_loading_state_with_no_title()
    {
        var display = Project(DriveDetailHeaderModel.Pending);

        Assert.Equal(DriveDetailHeaderState.Loading, display.State);
        Assert.Equal(string.Empty, display.Title);
        Assert.False(display.HasRoute);
        Assert.False(display.ShowEndTime);
        Assert.Null(display.StartTimestamp);
        Assert.Null(display.EndTimestamp);
    }

    [Fact]
    public void Loading_still_resolves_the_action_labels_and_announces_a_loading_name()
    {
        var display = Project(DriveDetailHeaderModel.Pending);

        Assert.Equal("Replay", display.ReplayLabel);
        Assert.Equal("Share", display.ShareLabel);
        Assert.Equal("Back", display.BackLabel);
        Assert.Equal("Loading", display.LoadingLabel);
        Assert.Equal("Loading", display.AutomationName);
    }

    // ── Ready: the title route (web `${startAddress} → ${endAddress}`) ───────────────────────────────

    [Fact]
    public void Both_addresses_render_the_start_to_end_route_title()
    {
        var display = Project(Ready(startAddress: "Home", endAddress: "Office"));

        Assert.Equal(DriveDetailHeaderState.Ready, display.State);
        Assert.True(display.HasRoute);
        Assert.Equal($"Home {DriveDetailHeaderProjection.RouteArrow} Office", display.Title);
    }

    [Fact]
    public void Route_arrow_is_the_web_unicode_right_arrow()
    {
        Assert.Equal("\u2192", DriveDetailHeaderProjection.RouteArrow);
    }

    [Theory]
    [InlineData(null, "Office")]   // web: undefined && … → falsy
    [InlineData("Home", null)]
    [InlineData(null, null)]
    [InlineData("", "Office")]     // web: '' is falsy
    [InlineData("Home", "")]
    [InlineData("", "")]
    public void Missing_either_address_falls_back_to_the_generic_title(string? start, string? end)
    {
        // web: drive.startAddress && drive.endAddress ? route : t('driveDetail.title', 'Drive Details').
        var display = Project(Ready(startAddress: start, endAddress: end));

        Assert.Equal(DriveDetailHeaderState.Ready, display.State);
        Assert.False(display.HasRoute);
        Assert.Equal("Drive Details", display.Title);
    }

    // ── Ready: the subtitle end time (web `{drive.endTs && ( → <DateTime/> )}`) ──────────────────────

    [Fact]
    public void A_completed_drive_with_an_end_timestamp_shows_the_end_time()
    {
        var display = Project(Ready(startTs: Start, endTs: End));

        Assert.True(display.ShowEndTime);
        Assert.Equal(Start, display.StartTimestamp);
        Assert.Equal(End, display.EndTimestamp);
    }

    [Fact]
    public void A_live_drive_with_no_end_timestamp_omits_the_end_time()
    {
        // web: a live drive has drive.endTs == null, so the `→ <DateTime>` branch is skipped.
        var display = Project(Ready(startTs: Start, endTs: null));

        Assert.False(display.ShowEndTime);
        Assert.Equal(Start, display.StartTimestamp);
        Assert.Null(display.EndTimestamp);
    }

    // ── Value pass-through (subtitle vehicle name + replay drive id) ─────────────────────────────────

    [Fact]
    public void Vehicle_name_and_drive_id_pass_through_to_the_display()
    {
        var display = Project(Ready(driveId: "987", vehicleName: "Cyber Truck"));

        Assert.Equal("987", display.DriveId);
        Assert.Equal("Cyber Truck", display.VehicleName);
    }

    // ── i18n: every key from the source resolves with the web default (P1/S10 catalog) ──────────────

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        // A no-route ready model exercises the title-fallback key alongside the always-on
        // replay / share / back / loading keys, covering every t() call the surface makes.
        DriveDetailHeaderProjection.Project(
            new DriveDetailHeaderModel(new DriveHeaderSnapshot(null, null, null, null), "1", "Car"), recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["driveDetail.title"] = "Drive Details",
            ["driveDetail.replay"] = "Replay",
            ["driveDetail.share"] = "Share",
            ["common.back"] = "Back",
            ["common.loading"] = "Loading",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    [Fact]
    public void Source_i18n_keys_match_the_web_t_calls()
    {
        Assert.Equal("driveDetail.title", DriveDetailHeaderRegistration.TitleKey);
        Assert.Equal("driveDetail.replay", DriveDetailHeaderRegistration.ReplayKey);
        Assert.Equal("driveDetail.share", DriveDetailHeaderRegistration.ShareKey);
    }

    // ── Accessibility: the surface exposes a non-empty, descriptive Narrator name ────────────────────

    [Fact]
    public void Ready_automation_name_includes_the_title_and_the_vehicle()
    {
        var display = Project(Ready(startAddress: "Home", endAddress: "Office", vehicleName: "Model Y"));

        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Model Y", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_is_just_the_title_when_no_vehicle_name()
    {
        var display = Project(Ready(startAddress: "Home", endAddress: "Office", vehicleName: string.Empty));

        Assert.Equal(display.Title, display.AutomationName);
    }

    // ── Diagnostics (P1/S11): PII-safe slugged events ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new DriveDetailHeaderDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveDetailHeader", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_records_the_replay_share_and_back_activations()
    {
        var captured = new List<string>();
        var diagnostics = new DriveDetailHeaderDiagnostics(captured.Add);

        diagnostics.RecordReplayOpened();
        diagnostics.RecordShared();
        diagnostics.RecordBackToList();

        Assert.Equal(1, diagnostics.ReplaysOpened);
        Assert.Equal(1, diagnostics.Shares);
        Assert.Equal(1, diagnostics.BackNavigations);
        Assert.Collection(
            captured,
            line => Assert.Equal("drive-detail-header.replay slug=DriveDetailHeader", line),
            line => Assert.Equal("drive-detail-header.share slug=DriveDetailHeader", line),
            line => Assert.Equal("drive-detail-header.back slug=DriveDetailHeader", line));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("DriveDetailHeader", DriveDetailHeaderRegistration.Slug);
    }

    [Fact]
    public void Glyphs_map_to_the_expected_segoe_fluent_code_points()
    {
        Assert.Equal("\uE7C0", DriveDetailHeaderRegistration.RouteGlyph);
        Assert.Equal("\uE72B", DriveDetailHeaderRegistration.BackGlyph);
        Assert.Equal("\uE768", DriveDetailHeaderRegistration.PlayGlyph);
        Assert.Equal("\uE72D", DriveDetailHeaderRegistration.ShareGlyph);
    }

    /// <summary>An <see cref="ILocalizer"/> that returns the fallback and records each requested key.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        public Dictionary<string, string> Requested { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Requested[key] = fallback;
            return fallback;
        }
    }
}
