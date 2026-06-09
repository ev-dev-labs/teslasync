using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>BatteryLevelChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the per-bar height ratio relative to the tallest bucket, the SoC-band
/// passthrough + <c>fmtNumber</c> count grouping, the resolved i18n labels, the accessible names, and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/charging-list/BatteryLevelChart.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class BatteryLevelChartTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static BatteryLevelBucket B(string range, long count) => new(range, count);

    private static BatteryLevelChartModel Loaded(params BatteryLevelBucket[] buckets) => new(false, buckets);

    private static BatteryLevelChartModel Loading(params BatteryLevelBucket[] buckets) => new(true, buckets);

    // The web `computeStartLevelDist` shape: ten "{n}0-{n}0+10%" SoC bands carrying the supplied counts.
    private static BatteryLevelChartModel TenBuckets(params long[] counts)
    {
        var buckets = new BatteryLevelBucket[counts.Length];
        for (int i = 0; i < counts.Length; i++)
        {
            buckets[i] = new BatteryLevelBucket($"{i * 10}-{(i * 10) + 10}%", counts[i]);
        }

        return new BatteryLevelChartModel(false, buckets);
    }

    private static BatteryLevelChartDisplay Project(BatteryLevelChartModel model) =>
        BatteryLevelChartProjection.Project(model, Localizer);

    // ── Branch precedence: loading → empty → ready (web data lifecycle) ────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(BatteryLevelChartState.Loading, Project(BatteryLevelChartModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_buckets()
    {
        // Web gates the whole chart behind its query state, so loading wins even with buckets already cached.
        var display = Project(Loading(B("0-10%", 3), B("10-20%", 9)));

        Assert.Equal(BatteryLevelChartState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_buckets()
    {
        var display = Project(BatteryLevelChartModel.Empty);

        Assert.Equal(BatteryLevelChartState.Empty, display.State);
        Assert.Empty(display.Bars);
    }

    [Fact]
    public void Empty_when_every_bucket_is_zero()
    {
        // The web always emits ten buckets; with no sessions they are all zero and answer nothing, so the
        // surface collapses to the friendly empty state rather than charting ten flat bars.
        var display = Project(TenBuckets(0, 0, 0, 0, 0, 0, 0, 0, 0, 0));

        Assert.Equal(BatteryLevelChartState.Empty, display.State);
    }

    [Fact]
    public void Ready_when_any_bucket_has_a_session()
    {
        var display = Project(TenBuckets(0, 0, 0, 4, 0, 0, 0, 0, 0, 0));

        Assert.Equal(BatteryLevelChartState.Ready, display.State);
        Assert.Equal(10, display.Bars.Count);
    }

    // ── Bars: height ratio, count formatting, labels ─────────────────────────────────────────────────

    [Fact]
    public void Bar_height_ratio_is_relative_to_the_tallest_bucket()
    {
        var display = Project(Loaded(B("0-10%", 10), B("10-20%", 5), B("20-30%", 0)));

        Assert.Equal(1.0, display.Bars[0].HeightRatio);
        Assert.Equal(0.5, display.Bars[1].HeightRatio);
        Assert.Equal(0.0, display.Bars[2].HeightRatio);
    }

    [Fact]
    public void Bar_count_text_groups_thousands_like_fmtNumber()
    {
        var bar = Assert.Single(Project(Loaded(B("90-100%", 1234567))).Bars);

        Assert.Equal(1234567, bar.Count);
        Assert.Equal("1,234,567", bar.CountText);
    }

    [Fact]
    public void Bar_carries_the_soc_band_label()
    {
        var bar = Assert.Single(Project(Loaded(B("30-40%", 7))).Bars);

        Assert.Equal("30-40%", bar.Range);
    }

    [Fact]
    public void Bar_renders_em_dash_for_a_blank_band_label()
    {
        var bar = Assert.Single(Project(Loaded(B("   ", 4))).Bars);

        Assert.Equal(EmDash, bar.Range);
    }

    [Fact]
    public void Negative_count_is_clamped_to_zero()
    {
        // A stray negative count never produces a negative bar height; it floors at zero.
        var display = Project(Loaded(B("0-10%", -3), B("10-20%", 6)));

        Assert.Equal(BatteryLevelChartState.Ready, display.State);
        Assert.Equal(0, display.Bars[0].Count);
        Assert.Equal(0.0, display.Bars[0].HeightRatio);
        Assert.Equal(1.0, display.Bars[1].HeightRatio);
    }

    [Fact]
    public void All_ten_buckets_render_as_bars_when_any_has_data()
    {
        var bars = Project(TenBuckets(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)).Bars;

        Assert.Equal(10, bars.Count);
        Assert.Equal("0-10%", bars[0].Range);
        Assert.Equal("90-100%", bars[9].Range);
        Assert.Equal(1.0, bars[9].HeightRatio); // tallest band
    }

    // ── Resolved labels (i18n facade fallbacks mirror the web `t(...)` defaults) ──────────────────────

    [Fact]
    public void Resolves_title_and_hint_from_the_facade()
    {
        var display = Project(TenBuckets(1, 0, 0, 0, 0, 0, 0, 0, 0, 0));

        Assert.Equal("Battery Level at Charge Start", display.Title);
        Assert.Equal("How low do you typically go before charging?", display.Hint);
    }

    [Fact]
    public void Empty_message_uses_the_shared_chart_no_data_string() =>
        Assert.Equal("No data available", Project(BatteryLevelChartModel.Empty).EmptyMessage);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(BatteryLevelChartModel.Pending).LoadingLabel);

    [Fact]
    public void Sessions_word_resolves_from_the_facade() =>
        Assert.Equal("Sessions", Project(TenBuckets(1, 0, 0, 0, 0, 0, 0, 0, 0, 0)).SessionsWord);

    // ── Accessibility: every state exposes a meaningful Narrator name ─────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(BatteryLevelChartModel.Pending),
                Project(BatteryLevelChartModel.Empty),
                Project(TenBuckets(1, 2, 3, 0, 0, 0, 0, 0, 0, 0)),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_carries_the_title_and_loading_label()
    {
        var display = Project(BatteryLevelChartModel.Pending);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.LoadingLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_empty_message()
    {
        var display = Project(BatteryLevelChartModel.Empty);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_carries_the_title_and_hint()
    {
        var display = Project(TenBuckets(3, 0, 0, 0, 0, 0, 0, 0, 0, 0));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Hint, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_bar_exposes_a_descriptive_automation_name()
    {
        var bar = Assert.Single(Project(Loaded(B("40-50%", 7))).Bars);

        Assert.False(string.IsNullOrWhiteSpace(bar.AutomationName));
        Assert.Contains("40-50%", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("7", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Sessions", bar.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=BatteryLevelChart, PII-safe ────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new BatteryLevelChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryLevelChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_bucket_or_count_data()
    {
        var captured = new List<string>();
        var diagnostics = new BatteryLevelChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=BatteryLevelChart", line);
        Assert.DoesNotContain('%', line);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("BatteryLevelChart", BatteryLevelChartRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => BatteryLevelChartProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => BatteryLevelChartProjection.Project(BatteryLevelChartModel.Pending, null!));
}
