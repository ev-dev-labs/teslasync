using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SentryModeChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the per-day stacked-segment ratios relative to the busiest day's
/// total, the short-date axis formatting, the <c>fmtNumber</c> count grouping, the resolved i18n labels, the
/// accessible names, the stable token brush keys, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/security-access/SentryModeChart.tsx). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class SentryModeChartTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SentryDayBucket B(string date, long on, long off) => new(date, on, off);

    private static SentryModeChartModel Loaded(params SentryDayBucket[] buckets) => new(false, buckets);

    private static SentryModeChartModel Loading(params SentryDayBucket[] buckets) => new(true, buckets);

    private static SentryModeChartDisplay Project(SentryModeChartModel model) =>
        SentryModeChartProjection.Project(model, Localizer);

    // ── Branch precedence: loading → empty → ready (web data lifecycle) ────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(SentryModeChartState.Loading, Project(SentryModeChartModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_buckets()
    {
        // The web gates the whole chart behind its query state, so loading wins even with buckets cached.
        var display = Project(Loading(B("2026-04-01", 3, 1), B("2026-04-02", 2, 2)));

        Assert.Equal(SentryModeChartState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_buckets()
    {
        var display = Project(SentryModeChartModel.Empty);

        Assert.Equal(SentryModeChartState.Empty, display.State);
        Assert.Empty(display.Columns);
    }

    [Fact]
    public void Ready_when_any_day_bucket_present()
    {
        // The web gate is purely `sentryBuckets.length > 0` — a single day promotes to the charted state.
        var display = Project(Loaded(B("2026-04-04", 3, 1)));

        Assert.Equal(SentryModeChartState.Ready, display.State);
        Assert.Single(display.Columns);
    }

    [Fact]
    public void Ready_renders_one_column_per_day_bucket()
    {
        var display = Project(Loaded(
            B("2026-04-01", 1, 0),
            B("2026-04-02", 2, 1),
            B("2026-04-03", 0, 3)));

        Assert.Equal(SentryModeChartState.Ready, display.State);
        Assert.Equal(3, display.Columns.Count);
        Assert.Equal("2026-04-01", display.Columns[0].Date);
        Assert.Equal("2026-04-03", display.Columns[2].Date);
    }

    // ── Stacking ratios are relative to the busiest day's total (web stackId="sentry") ─────────────────

    [Fact]
    public void Segment_ratios_scale_to_the_busiest_days_total()
    {
        // Day 1 total = 8 (the busiest); day 2 total = 3. Ratios are each segment / 8 (exact binary fractions).
        var display = Project(Loaded(B("2026-04-01", 4, 4), B("2026-04-02", 2, 1)));

        Assert.Equal(0.5, display.Columns[0].OnRatio);
        Assert.Equal(0.5, display.Columns[0].OffRatio);
        Assert.Equal(0.25, display.Columns[1].OnRatio);
        Assert.Equal(0.125, display.Columns[1].OffRatio);
    }

    [Fact]
    public void Segment_ratios_never_exceed_a_full_column()
    {
        var display = Project(Loaded(B("2026-04-01", 5, 5)));

        var column = Assert.Single(display.Columns);
        Assert.True(column.OnRatio + column.OffRatio <= 1.0);
        Assert.Equal(0.5, column.OnRatio);
        Assert.Equal(0.5, column.OffRatio);
    }

    [Fact]
    public void Negative_counts_are_clamped_to_zero()
    {
        // A stray negative tally never produces a negative segment; it floors at zero and drops out of the max.
        var column = Assert.Single(Project(Loaded(B("2026-04-04", -3, 5))).Columns);

        Assert.Equal(0, column.SentryOn);
        Assert.Equal(5, column.SentryOff);
        Assert.Equal(0.0, column.OnRatio);
        Assert.Equal(1.0, column.OffRatio);
    }

    [Fact]
    public void All_zero_day_still_renders_a_column_without_dividing_by_zero()
    {
        // buildSentryBuckets only emits days with activity, but a degenerate all-zero day must not throw.
        var column = Assert.Single(Project(Loaded(B("2026-04-04", 0, 0))).Columns);

        Assert.Equal(0.0, column.OnRatio);
        Assert.Equal(0.0, column.OffRatio);
    }

    // ── Counts + axis label formatting (web fmtNumber / formatDateShort) ───────────────────────────────

    [Fact]
    public void Counts_group_thousands_like_fmtNumber()
    {
        var column = Assert.Single(Project(Loaded(B("2026-01-01", 1234567, 7654321))).Columns);

        Assert.Equal("1,234,567", column.SentryOnText);
        Assert.Equal("7,654,321", column.SentryOffText);
    }

    [Fact]
    public void Axis_label_renders_short_month_day_like_formatDateShort()
    {
        var column = Assert.Single(Project(Loaded(B("2026-04-04", 1, 0))).Columns);

        Assert.Equal("Apr 4", column.AxisLabel);
    }

    [Fact]
    public void Axis_label_renders_em_dash_for_a_blank_day_key()
    {
        var column = Assert.Single(Project(Loaded(B("   ", 1, 0))).Columns);

        Assert.Equal(EmDash, column.AxisLabel);
    }

    [Fact]
    public void Axis_label_renders_em_dash_for_an_unparseable_day_key()
    {
        var column = Assert.Single(Project(Loaded(B("not-a-date", 1, 0))).Columns);

        Assert.Equal(EmDash, column.AxisLabel);
    }

    // ── Resolved labels (i18n facade fallbacks mirror the web `t(...)` defaults) ───────────────────────

    [Fact]
    public void Resolves_title_and_series_labels_from_the_facade()
    {
        var display = Project(Loaded(B("2026-04-04", 1, 1)));

        Assert.Equal("Sentry Mode Activity", display.Title);
        Assert.Equal("Sentry On", display.SentryOnLabel);
        Assert.Equal("Sentry Off", display.SentryOffLabel);
    }

    [Fact]
    public void Empty_message_uses_the_shared_common_no_data_string() =>
        Assert.Equal("No data available", Project(SentryModeChartModel.Empty).EmptyMessage);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(SentryModeChartModel.Pending).LoadingLabel);

    // ── Accessibility: every state + every column exposes a meaningful Narrator name ───────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(SentryModeChartModel.Pending),
                Project(SentryModeChartModel.Empty),
                Project(Loaded(B("2026-04-04", 2, 1))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_carries_the_title_and_loading_label()
    {
        var display = Project(SentryModeChartModel.Pending);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.LoadingLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_empty_message()
    {
        var display = Project(SentryModeChartModel.Empty);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_carries_the_title()
    {
        var display = Project(Loaded(B("2026-04-04", 2, 1)));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_column_exposes_a_descriptive_automation_name()
    {
        var column = Assert.Single(Project(Loaded(B("2026-04-04", 3, 1))).Columns);

        Assert.False(string.IsNullOrWhiteSpace(column.AutomationName));
        Assert.Contains("Apr 4", column.AutomationName, StringComparison.Ordinal);
        Assert.Contains("3", column.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Sentry On", column.AutomationName, StringComparison.Ordinal);
        Assert.Contains("1", column.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Sentry Off", column.AutomationName, StringComparison.Ordinal);
    }

    // ── Token brush keys are stable + theme-aware (no hard-coded hex in the view) ──────────────────────

    [Fact]
    public void Sentry_on_brush_key_is_the_token_carrying_the_web_blue() =>
        Assert.Equal("TsChartSpeedBrush", SentryModeChartProjection.SentryOnBrushKey);

    [Fact]
    public void Sentry_off_brush_key_resolves_to_a_non_empty_neutral_token() =>
        Assert.False(string.IsNullOrWhiteSpace(SentryModeChartProjection.SentryOffBrushKey));

    // ── Diagnostics (P1/S11): view.opened slug=SentryModeChart, PII-safe ───────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SentryModeChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SentryModeChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_day_or_count_data()
    {
        var captured = new List<string>();
        var diagnostics = new SentryModeChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=SentryModeChart", line);
        Assert.DoesNotContain("2026", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("SentryModeChart", SentryModeChartRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => SentryModeChartProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => SentryModeChartProjection.Project(SentryModeChartModel.Pending, null!));
}
