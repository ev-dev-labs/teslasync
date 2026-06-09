using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.IngestXRay;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>XRayBucketChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the per-bar height-ratio + <c>formatTime</c> label + axis-label
/// thinning, the accessible Bucket/Samples table (columns, row formatting, <c>fmtInt</c> grouping), the
/// accessible names, and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/ingest-xray/XRayBucketChart.tsx). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class XRayBucketChartTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // A mid-day UTC reference instant so the local-tz date never crosses a year boundary in any runner zone.
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 5, 0, TimeSpan.Zero);

    private static XRayBucketPoint Pt(string start = "2026-06-08T12:00:00Z", long count = 5) =>
        new(start, count);

    private static XRayBucketChartModel Loaded(params XRayBucketPoint[] buckets) => new(false, buckets);

    private static XRayBucketChartModel Loading(params XRayBucketPoint[] buckets) => new(true, buckets);

    private static XRayBucketChartDisplay Project(XRayBucketChartModel model) =>
        XRayBucketChartProjection.Project(model, Localizer, Now);

    // ── Branch precedence: loading → empty → ready (web source order) ────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading()
    {
        var display = Project(Loading());

        Assert.Equal(XRayBucketChartState.Loading, display.State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_buckets()
    {
        // Web `loading ?` is checked before `empty`/data, so loading wins even with buckets already cached.
        var display = Project(Loading(Pt(), Pt()));

        Assert.Equal(XRayBucketChartState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_buckets()
    {
        var display = Project(Loaded());

        Assert.Equal(XRayBucketChartState.Empty, display.State);
        Assert.Empty(display.Bars);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Ready_when_buckets_present()
    {
        var display = Project(Loaded(Pt(), Pt(start: "2026-06-08T12:01:00Z", count: 9)));

        Assert.Equal(XRayBucketChartState.Ready, display.State);
        Assert.Equal(2, display.Bars.Count);
    }

    [Fact]
    public void Empty_is_a_function_of_bucket_count_not_value()
    {
        // Web `isEmpty = !loading && series.length === 0` — an all-zero window still has length > 0, so it
        // renders the (zero-height) bars rather than collapsing to the empty state.
        var display = Project(Loaded(Pt(count: 0), Pt(start: "2026-06-08T12:01:00Z", count: 0)));

        Assert.Equal(XRayBucketChartState.Ready, display.State);
        Assert.All(display.Bars, bar => Assert.Equal(0.0, bar.HeightRatio));
    }

    // ── Bars: height ratio, count formatting, labels ─────────────────────────────────────────────────

    [Fact]
    public void Bar_height_ratio_is_relative_to_the_tallest_bucket()
    {
        var display = Project(Loaded(
            Pt(start: "2026-06-08T12:00:00Z", count: 10),
            Pt(start: "2026-06-08T12:01:00Z", count: 5),
            Pt(start: "2026-06-08T12:02:00Z", count: 0)));

        Assert.Equal(1.0, display.Bars[0].HeightRatio);
        Assert.Equal(0.5, display.Bars[1].HeightRatio);
        Assert.Equal(0.0, display.Bars[2].HeightRatio);
    }

    [Fact]
    public void Bar_count_text_groups_thousands_like_fmtInt()
    {
        var bar = Assert.Single(Project(Loaded(Pt(count: 1234567))).Bars);

        Assert.Equal(1234567, bar.Count);
        Assert.Equal("1,234,567", bar.CountText);
    }

    [Fact]
    public void Bar_time_label_is_formatted_for_a_valid_boundary()
    {
        var bar = Assert.Single(Project(Loaded(Pt())).Bars);

        Assert.NotEqual(EmDash, bar.TimeLabel);
        Assert.NotEqual(EmDash, bar.FullLabel);
        Assert.Contains("2026", bar.FullLabel, StringComparison.Ordinal);
    }

    [Fact]
    public void Bar_renders_em_dash_for_an_unparseable_boundary()
    {
        var bar = Assert.Single(Project(Loaded(Pt(start: "not-a-timestamp"))).Bars);

        Assert.Equal(EmDash, bar.TimeLabel);
        Assert.Equal(EmDash, bar.FullLabel);
    }

    [Fact]
    public void Axis_labels_thin_to_the_tick_target_for_a_dense_window()
    {
        // 16 buckets with an 8-tick target → stride 2 → a label on every other bar (8 visible labels).
        var buckets = new XRayBucketPoint[16];
        for (int i = 0; i < buckets.Length; i++)
        {
            buckets[i] = new XRayBucketPoint($"2026-06-08T12:{i:D2}:00Z", i + 1);
        }

        var bars = Project(Loaded(buckets)).Bars;

        Assert.True(bars[0].ShowLabel);
        Assert.False(bars[1].ShowLabel);
        Assert.True(bars[2].ShowLabel);
        Assert.Equal(XRayBucketChartProjection.LabelTargetTicks, bars.Count(b => b.ShowLabel));
    }

    [Fact]
    public void Sparse_window_labels_every_bar()
    {
        var bars = Project(Loaded(Pt(), Pt(start: "2026-06-08T12:01:00Z", count: 3))).Bars;

        Assert.All(bars, bar => Assert.True(bar.ShowLabel));
    }

    // ── Accessible data table (web dataColumns Bucket / Samples) ─────────────────────────────────────

    [Fact]
    public void Columns_match_the_web_two_columns()
    {
        var columns = Project(Loaded(Pt())).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((XRayBucketChartProjection.BucketKey, "Bucket"), (c.Key, c.Header)),
            c => Assert.Equal((XRayBucketChartProjection.CountKey, "Samples"), (c.Key, c.Header)));
    }

    [Fact]
    public void Row_carries_the_full_bucket_label_and_formatted_count()
    {
        var row = Assert.Single(Project(Loaded(Pt(count: 42))).Rows);

        Assert.Contains("2026", row.Cells[XRayBucketChartProjection.BucketKey], StringComparison.Ordinal);
        Assert.Equal("42", row.Cells[XRayBucketChartProjection.CountKey]);
    }

    [Fact]
    public void Rows_have_stable_unique_keys()
    {
        var rows = Project(Loaded(Pt(), Pt(start: "2026-06-08T12:01:00Z", count: 3), Pt(start: "2026-06-08T12:02:00Z", count: 7))).Rows;

        Assert.Equal(3, rows.Count);
        Assert.Equal(rows.Count, rows.Select(r => r.RowKey).Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Table_label_interpolates_the_title()
    {
        var display = Project(Loaded(Pt()));

        Assert.Equal("Samples per bucket \u2014 data table", display.TableLabel);
    }

    // ── Resolved labels (i18n facade fallbacks) ─────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_subtitle_and_aria_label_from_the_facade()
    {
        var display = Project(Loaded(Pt()));

        Assert.Equal("Samples per bucket", display.Title);
        Assert.Equal("Time-series of ingested telemetry rows over the selected window.", display.Subtitle);
        Assert.Equal("Bar chart of ingest sample counts per time bucket.", display.AriaLabel);
    }

    [Fact]
    public void Empty_message_uses_the_shared_chart_no_data_string()
    {
        Assert.Equal("No data available", Project(Loaded()).EmptyMessage);
    }

    // ── Accessibility: every state exposes a non-empty Narrator name ─────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Loading()),
                Project(Loaded()),
                Project(Loaded(Pt())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_aria_label()
    {
        var display = Project(Loaded(Pt()));

        Assert.Contains(display.AriaLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(Loaded());

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_bar_exposes_a_descriptive_automation_name()
    {
        var bar = Assert.Single(Project(Loaded(Pt(count: 7))).Bars);

        Assert.False(string.IsNullOrWhiteSpace(bar.AutomationName));
        Assert.Contains("7", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Samples", bar.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_row_exposes_a_descriptive_automation_name()
    {
        var rows = Project(Loaded(Pt(count: 3), Pt(start: "2026-06-08T12:01:00Z", count: 9))).Rows;

        Assert.All(rows, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.Contains("9", rows[1].AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=XRayBucketChart, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new XRayBucketChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=XRayBucketChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_bucket_or_count_data()
    {
        var captured = new List<string>();
        var diagnostics = new XRayBucketChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("2026", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=XRayBucketChart", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("XRayBucketChart", XRayBucketChartRegistration.Slug);
    }
}
