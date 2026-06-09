using System.Collections.Generic;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DriveTimeline</c> feature surface's UI-thread-free logic — the tolerant JSON
/// parse adapter (<c>DriveTimelineSnapshot.FromJson</c> / <c>ParseNullable</c>), the ready / in-progress / empty
/// branch projection, the web-faithful duration formatting (hour rollover, sub-hour, <c>Math.round</c>ed minute
/// remainder, zero, non-finite), the in-progress end label, the localized keys, the composed Narrator name and the
/// diagnostics. Mirrors the web spec (web/src/features/driving/components/drive-detail/DriveTimeline.tsx). The
/// WinUI view itself (feature-views\DriveTimeline\DriveTimeline.cs) is exercised by the app build.
/// </summary>
public sealed class DriveTimelineTests
{
    private const string EmDash = "\u2014";
    private const string Arrow = "\u2192";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static DriveTimelineSnapshot Drive(
        DateTimeOffset? start = null,
        DateTimeOffset? end = null,
        double durationS = 5700) =>
        new(start ?? new DateTimeOffset(2026, 6, 6, 14, 30, 0, TimeSpan.Zero), end, durationS);

    private static DriveTimelineDisplay Project(DriveTimelineModel model) =>
        DriveTimelineProjection.Project(model, Localizer);

    // ── Parse adapter (cached JSON → snapshot) ──────────────────────────────────────────────────────

    [Fact]
    public void FromJson_reads_snake_case_object()
    {
        const string json = """
        {
          "start_ts": "2026-06-06T14:30:00Z",
          "end_ts": "2026-06-06T16:05:00Z",
          "duration_s": 5700
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var drive = DriveTimelineSnapshot.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 6, 6, 14, 30, 0, TimeSpan.Zero), drive.StartTs);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 16, 5, 0, TimeSpan.Zero), drive.EndTs);
        Assert.Equal(5700, drive.DurationS);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"duration_s":120}""");

        var drive = DriveTimelineSnapshot.FromJson(doc.RootElement);

        Assert.Equal(DateTimeOffset.UnixEpoch, drive.StartTs);
        Assert.Null(drive.EndTs);
        Assert.Equal(120, drive.DurationS);
    }

    [Fact]
    public void FromJson_accepts_numeric_epoch_and_string_duration()
    {
        using var doc = JsonDocument.Parse("""{"start_ts":1780000000,"duration_s":"5700"}""");

        var drive = DriveTimelineSnapshot.FromJson(doc.RootElement);

        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1780000000), drive.StartTs);
        Assert.Null(drive.EndTs);
        Assert.Equal(5700, drive.DurationS);
    }

    [Fact]
    public void ParseNullable_maps_object_to_snapshot()
    {
        using var doc = JsonDocument.Parse("""{"duration_s":60}""");

        Assert.NotNull(DriveTimelineSnapshot.ParseNullable(doc.RootElement));
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("123")]
    [InlineData("\"x\"")]
    public void ParseNullable_maps_non_object_to_null(string json)
    {
        using var doc = JsonDocument.Parse(json);

        Assert.Null(DriveTimelineSnapshot.ParseNullable(doc.RootElement));
    }

    // ── Ready projection (completed drive) ──────────────────────────────────────────────────────────

    [Fact]
    public void Project_ready_completed_drive()
    {
        var display = Project(new DriveTimelineModel(Drive(
            end: new DateTimeOffset(2026, 6, 6, 16, 5, 0, TimeSpan.Zero),
            durationS: 5700)));

        Assert.Equal(DriveTimelineState.Ready, display.State);
        Assert.False(display.InProgress);
        Assert.Equal("1h 35m", display.DurationText);
        Assert.NotEqual(DriveTimelineProjection.InProgressFallback, display.EndText);
        Assert.NotEqual(EmDash, display.EndText);
        Assert.False(string.IsNullOrEmpty(display.StartText));
        Assert.Equal(string.Empty, display.EmptyMessage);
    }

    // ── Ready projection (in progress — web !drive.endTs) ───────────────────────────────────────────

    [Fact]
    public void Project_ready_in_progress_uses_localized_label()
    {
        var display = Project(new DriveTimelineModel(Drive(end: null, durationS: 2700)));

        Assert.Equal(DriveTimelineState.Ready, display.State);
        Assert.True(display.InProgress);
        Assert.Equal(DriveTimelineProjection.InProgressFallback, display.EndText);
        Assert.Equal("45m", display.DurationText);
    }

    // ── Empty projection (no drive bound) ───────────────────────────────────────────────────────────

    [Fact]
    public void Project_empty_when_no_drive()
    {
        var display = Project(DriveTimelineModel.Empty);

        Assert.Equal(DriveTimelineState.Empty, display.State);
        Assert.Equal(DriveTimelineProjection.NoDataFallback, display.EmptyMessage);
        Assert.Equal(display.EmptyMessage, display.AutomationName);
        Assert.False(display.InProgress);
        Assert.Equal(string.Empty, display.DurationText);
    }

    // ── Duration formatting (web formatDuration(durationS / 60)) ────────────────────────────────────

    [Theory]
    [InlineData(0, "0m")]
    [InlineData(30, "1m")]
    [InlineData(2700, "45m")]
    [InlineData(3540, "59m")]
    [InlineData(3600, "1h 0m")]
    [InlineData(5700, "1h 35m")]
    [InlineData(5730, "1h 36m")]
    [InlineData(7200, "2h 0m")]
    public void FormatDurationFromSeconds_matches_web(double seconds, string expected)
    {
        Assert.Equal(expected, DriveTimelineProjection.FormatDurationFromSeconds(seconds));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void FormatDurationFromSeconds_non_finite_is_em_dash(double seconds)
    {
        Assert.Equal(EmDash, DriveTimelineProjection.FormatDurationFromSeconds(seconds));
    }

    // ── Accessibility (Narrator name) ───────────────────────────────────────────────────────────────

    [Fact]
    public void AutomationName_ready_composes_start_end_and_duration()
    {
        var display = Project(new DriveTimelineModel(Drive(
            end: new DateTimeOffset(2026, 6, 6, 16, 5, 0, TimeSpan.Zero),
            durationS: 5700)));

        Assert.Equal(
            $"{display.StartText} {Arrow} {display.EndText}, {display.DurationText}",
            display.AutomationName);
    }

    [Fact]
    public void AutomationName_in_progress_carries_the_localized_label()
    {
        var display = Project(new DriveTimelineModel(Drive(end: null)));

        Assert.Contains(DriveTimelineProjection.InProgressFallback, display.AutomationName);
    }

    // ── i18n keys (every key resolves through the facade) ───────────────────────────────────────────

    [Fact]
    public void Projection_requests_the_catalog_keys()
    {
        var recorder = new RecordingLocalizer();

        DriveTimelineProjection.Project(new DriveTimelineModel(Drive(end: null)), recorder);
        DriveTimelineProjection.Project(DriveTimelineModel.Empty, recorder);

        Assert.Contains(DriveTimelineProjection.InProgressKey, recorder.Keys);
        Assert.Contains(DriveTimelineProjection.NoDataKey, recorder.Keys);
        Assert.Equal("driveDetail.inProgress", DriveTimelineProjection.InProgressKey);
        Assert.Equal("common.noData", DriveTimelineProjection.NoDataKey);
    }

    // ── Diagnostics (PII-safe view.opened) ──────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened()
    {
        var emitted = new List<string>();
        var diagnostics = new DriveTimelineDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveTimeline", Assert.Single(emitted));
    }

    // ── Registration metadata ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_slug_and_glyph()
    {
        Assert.Equal("DriveTimeline", DriveTimelineRegistration.Slug);
        Assert.Equal("\uE7C1", DriveTimelineRegistration.FlagGlyph);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
