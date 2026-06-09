using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.YearReview;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>StatChartSlide</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the count-up <c>total_drives</c> headline + avg-per-week
/// interpolation, the per-bar height-ratio + abbreviated month labels + <c>fmtNumber</c> grouping, the
/// accessible Month/Drives fallback table, the per-state accessible names, and the diagnostics. Mirrors the
/// web spec (web/src/features/analytics/components/review/StatChartSlide.tsx). The WinUI view itself
/// (StatChartSlide.cs) is exercised by the app build.
/// </summary>
public sealed class StatChartSlideTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Invariant culture gives the stable English abbreviated month names ("Jan".."Dec") the web hard-codes.
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;

    private static StatChartMonth M(int month, long drives) => new(month, drives);

    private static StatChartSlideModel Loaded(long total, double avg, params StatChartMonth[] months) =>
        new(false, total, avg, months);

    private static StatChartSlideModel Loading(long total = 0, double avg = 0, params StatChartMonth[] months) =>
        new(true, total, avg, months);

    private static StatChartSlideDisplay Project(StatChartSlideModel model) =>
        StatChartSlideProjection.Project(model, Localizer, Culture);

    // ── Branch precedence: loading → empty → ready ───────────────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading()
    {
        Assert.Equal(StatChartSlideState.Loading, Project(Loading()).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_data()
    {
        // The parent renders its loading scaffold before the slide; loading wins even with data cached.
        var display = Project(Loading(120, 3, M(1, 10), M(2, 8)));

        Assert.Equal(StatChartSlideState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_activity()
    {
        var display = Project(Loaded(0, 0));

        Assert.Equal(StatChartSlideState.Empty, display.State);
        Assert.Empty(display.Bars);
        Assert.Empty(display.Rows);
        Assert.False(display.HasChartData);
    }

    [Fact]
    public void Ready_when_months_present()
    {
        var display = Project(Loaded(15, 1.5, M(1, 5), M(2, 9)));

        Assert.Equal(StatChartSlideState.Ready, display.State);
        Assert.True(display.HasChartData);
        Assert.Equal(2, display.Bars.Count);
    }

    [Fact]
    public void Ready_keeps_the_headline_even_when_months_are_missing()
    {
        // Web parity: the slide always shows total_drives + the avg line; a degenerate year with a non-zero
        // total but no monthly_stats still renders the headline, with the chart region showing its own
        // friendly placeholder rather than collapsing the whole slide.
        var display = Project(Loaded(250, 4, Array.Empty<StatChartMonth>()));

        Assert.Equal(StatChartSlideState.Ready, display.State);
        Assert.False(display.HasChartData);
        Assert.Empty(display.Bars);
        Assert.Equal("250", display.TotalDrivesText);
    }

    [Fact]
    public void Ready_when_months_present_even_with_zero_total()
    {
        // Emptiness is a function of (no total AND no months); months alone keep it out of the empty branch.
        var display = Project(Loaded(0, 0, M(1, 3)));

        Assert.Equal(StatChartSlideState.Ready, display.State);
        Assert.Equal("0", display.TotalDrivesText);
        Assert.Single(display.Bars);
    }

    // ── Headline: total drives + avg per week ────────────────────────────────────────────────────────

    [Fact]
    public void Total_drives_text_groups_thousands_like_fmtNumber()
    {
        var display = Project(Loaded(1234567, 0, M(1, 1)));

        Assert.Equal(1234567, display.TotalDrives);
        Assert.Equal("1,234,567", display.TotalDrivesText);
    }

    [Fact]
    public void Animated_number_uses_the_web_tween_duration()
    {
        Assert.Equal(1.2, Project(Loaded(10, 1, M(1, 1))).TotalDrivesDurationSeconds);
    }

    [Fact]
    public void Avg_per_week_text_interpolates_one_decimal()
    {
        Assert.Equal(
            "2.5 drives per week on average",
            Project(Loaded(130, 2.5, M(1, 1))).AvgPerWeekText);
    }

    [Fact]
    public void Avg_per_week_text_keeps_a_trailing_zero_decimal()
    {
        Assert.Equal(
            "4.0 drives per week on average",
            Project(Loaded(208, 4, M(1, 1))).AvgPerWeekText);
    }

    [Fact]
    public void Drives_label_resolves_from_the_facade()
    {
        Assert.Equal("drives", Project(Loaded(10, 1, M(1, 1))).DrivesLabel);
    }

    [Fact]
    public void Emoji_is_the_calendar_glyph()
    {
        Assert.Equal("\U0001F5D3\uFE0F", Project(Loaded(10, 1, M(1, 1))).Emoji);
        Assert.Equal(StatChartSlideProjection.Emoji, Project(Loaded(10, 1, M(1, 1))).Emoji);
    }

    // ── Bars: height ratio, count formatting, month labels ───────────────────────────────────────────

    [Fact]
    public void Bar_height_ratio_is_relative_to_the_busiest_month()
    {
        var display = Project(Loaded(15, 1, M(1, 10), M(2, 5), M(3, 0)));

        Assert.Equal(1.0, display.Bars[0].HeightRatio);
        Assert.Equal(0.5, display.Bars[1].HeightRatio);
        Assert.Equal(0.0, display.Bars[2].HeightRatio);
    }

    [Fact]
    public void Bar_drives_text_groups_thousands()
    {
        var bar = Assert.Single(Project(Loaded(12345, 1, M(1, 12345))).Bars);

        Assert.Equal(12345, bar.Drives);
        Assert.Equal("12,345", bar.DrivesText);
    }

    [Fact]
    public void Bar_month_labels_use_abbreviated_names()
    {
        var display = Project(Loaded(2, 1, M(1, 1), M(12, 1)));

        Assert.Equal("Jan", display.Bars[0].MonthLabel);
        Assert.Equal("Dec", display.Bars[1].MonthLabel);
    }

    [Fact]
    public void Bar_out_of_range_month_falls_back_to_index_label()
    {
        var display = Project(Loaded(2, 1, M(0, 1), M(13, 1)));

        Assert.Equal("M0", display.Bars[0].MonthLabel);
        Assert.Equal("M13", display.Bars[1].MonthLabel);
    }

    [Fact]
    public void All_zero_months_still_render_flat_bars()
    {
        var display = Project(Loaded(0, 0, M(1, 0), M(2, 0)));

        Assert.Equal(StatChartSlideState.Ready, display.State);
        Assert.All(display.Bars, bar => Assert.Equal(0.0, bar.HeightRatio));
    }

    // ── Chart-region empty placeholder (no months, but a headline to keep) ───────────────────────────

    [Fact]
    public void Chart_empty_message_uses_the_shared_chart_no_data_string()
    {
        var display = Project(Loaded(50, 1));

        Assert.False(display.HasChartData);
        Assert.Equal("No data available", display.ChartEmptyMessage);
    }

    // ── Accessible data table (Month / Drives) ───────────────────────────────────────────────────────

    [Fact]
    public void Columns_match_the_month_and_drives_columns()
    {
        var columns = Project(Loaded(2, 1, M(1, 1))).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((StatChartSlideProjection.MonthKey, "Month"), (c.Key, c.Header)),
            c => Assert.Equal((StatChartSlideProjection.DrivesKey, "Drives"), (c.Key, c.Header)));
    }

    [Fact]
    public void Row_carries_the_month_label_and_formatted_count()
    {
        var row = Assert.Single(Project(Loaded(42, 1, M(2, 42))).Rows);

        Assert.Equal("Feb", row.Cells[StatChartSlideProjection.MonthKey]);
        Assert.Equal("42", row.Cells[StatChartSlideProjection.DrivesKey]);
    }

    [Fact]
    public void Rows_have_stable_unique_keys()
    {
        var rows = Project(Loaded(20, 1, M(1, 3), M(2, 7), M(3, 10))).Rows;

        Assert.Equal(3, rows.Count);
        Assert.Equal(rows.Count, rows.Select(r => r.RowKey).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Table_label_interpolates_the_chart_label()
    {
        Assert.Equal("Drives by month \u2014 data table", Project(Loaded(2, 1, M(1, 1))).TableLabel);
    }

    // ── Resolved labels (i18n facade fallbacks) ──────────────────────────────────────────────────────

    [Fact]
    public void Resolves_chart_labels_and_empty_message_from_the_facade()
    {
        var display = Project(Loaded(2, 1, M(1, 1)));

        Assert.Equal("Drives by month", display.ChartLabel);
        Assert.Equal("Bar chart of drives per month.", display.ChartAriaLabel);
        Assert.Equal("No drive data for this year", display.EmptyMessage);
    }

    // ── Accessibility: every state exposes a non-empty Narrator name ─────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Loading()),
                Project(Loaded(0, 0)),
                Project(Loaded(10, 1, M(1, 1))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_string()
    {
        Assert.Equal("Loading", Project(Loading()).AutomationName);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(Loaded(0, 0));

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_carries_the_headline_and_aria_label()
    {
        var display = Project(Loaded(250, 4, M(1, 1)));

        Assert.Contains(display.HeadlineAutomationName, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.ChartAriaLabel, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("250", display.HeadlineAutomationName, StringComparison.Ordinal);
        Assert.Contains("drives", display.HeadlineAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_bar_exposes_a_descriptive_automation_name()
    {
        var bar = Assert.Single(Project(Loaded(7, 1, M(6, 7))).Bars);

        Assert.False(string.IsNullOrWhiteSpace(bar.AutomationName));
        Assert.Contains("Jun", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("7", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("drives", bar.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_row_exposes_a_descriptive_automation_name()
    {
        var rows = Project(Loaded(12, 1, M(1, 3), M(2, 9))).Rows;

        Assert.All(rows, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.Contains("9", rows[1].AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=StatChartSlide, PII-safe ──────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new StatChartSlideDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StatChartSlide", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_drive_counts()
    {
        var captured = new List<string>();
        var diagnostics = new StatChartSlideDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("250", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=StatChartSlide", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("StatChartSlide", StatChartSlideRegistration.Slug);
    }
}
