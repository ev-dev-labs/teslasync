using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SignalChartPanel</c> feature surface's UI-thread-free logic — the
/// multi-line series adapter (ordinal X, the <c>formatTime</c> label, null readings dropped as gaps, palette
/// index by selection order — the web <c>CHART_COLORS[i % len]</c>), the dual-axis <c>useRightAxis</c> memo,
/// the overlay/grid <c>effectiveMode</c> memo, the <c>resolvedTitle</c> fallback, the body-branch state ladder
/// (loading / overlay / grid / live-waiting / empty), the live + historical header annotations, the accessible
/// names, the PII-safe diagnostics and the i18n keys. Mirrors the web spec
/// (web/src/features/telemetry/components/SignalChartPanel.tsx). The WinUI view itself is exercised by the app
/// build.
/// </summary>
public sealed class SignalChartPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SignalChartSample Sample(string? ts, params (string Signal, double? Value)[] readings)
    {
        var values = new Dictionary<string, double?>(StringComparer.Ordinal);
        foreach (var (signal, value) in readings)
        {
            values[signal] = value;
        }

        return new SignalChartSample(ts, values);
    }

    private static SignalChartPanelDisplay Project(SignalChartPanelModel model) =>
        SignalChartPanelProjection.Project(model, Localizer);

    private static SignalChartPanelModel TwoSignalOverlay() => new(
        new[] { "speed", "power" },
        new[]
        {
            Sample("2026-04-04T10:00:00Z", ("speed", 10), ("power", 100)),
            Sample("2026-04-04T10:00:05Z", ("speed", 20), ("power", 200)),
        },
        new[] { new SignalChartStat(0, 30), new SignalChartStat(0, 300) });

    // ── Series adapter: data → render-ready ChartSeries ─────────────────────────────────────────────────

    [Fact]
    public void Series_count_matches_the_selected_signals()
    {
        var series = Project(TwoSignalOverlay()).Series;

        Assert.Equal(2, series.Count);
        Assert.Equal("speed", series[0].Name);
        Assert.Equal("power", series[1].Name);
    }

    [Fact]
    public void Series_colour_index_follows_selection_order()
    {
        var series = Project(TwoSignalOverlay()).Series;

        Assert.Equal(0, series[0].ColorIndex);
        Assert.Equal(1, series[1].ColorIndex);
        Assert.All(series, s => Assert.Equal(ChartSeriesKind.Line, s.Kind));
    }

    [Fact]
    public void Series_points_carry_ordinal_x_and_the_reading()
    {
        var speed = Project(TwoSignalOverlay()).Series[0];

        Assert.Collection(
            speed.Points,
            p => Assert.Equal((0d, 10d), (p.X, p.Y)),
            p => Assert.Equal((1d, 20d), (p.X, p.Y)));
    }

    [Fact]
    public void Series_drops_null_and_missing_readings_as_gaps_keeping_the_ordinal_x()
    {
        var model = new SignalChartPanelModel(
            new[] { "speed" },
            new[]
            {
                Sample("2026-04-04T10:00:00Z", ("speed", 10)),
                Sample("2026-04-04T10:00:05Z", ("speed", null)), // explicit null → gap
                Sample("2026-04-04T10:00:10Z"),                   // missing key → gap
                Sample("2026-04-04T10:00:15Z", ("speed", 40)),
            },
            Array.Empty<SignalChartStat>());

        var points = Project(model).Series[0].Points;

        Assert.Collection(
            points,
            p => Assert.Equal((0d, 10d), (p.X, p.Y)),
            p => Assert.Equal((3d, 40d), (p.X, p.Y)));
    }

    [Fact]
    public void Series_point_label_is_the_clock_for_a_valid_ts_and_empty_for_none()
    {
        var model = new SignalChartPanelModel(
            new[] { "speed" },
            new[] { Sample("2026-04-04T10:00:00Z", ("speed", 10)), Sample(null, ("speed", 20)) },
            Array.Empty<SignalChartStat>());

        var points = Project(model).Series[0].Points;

        Assert.False(string.IsNullOrEmpty(points[0].Label)); // some locale-aware clock label
        Assert.Equal(string.Empty, points[1].Label);
    }

    [Fact]
    public void Series_skips_blank_signal_names_but_keeps_the_colour_index_of_the_kept_ones()
    {
        var model = new SignalChartPanelModel(
            new[] { "a", "  ", "b" },
            new[] { Sample("2026-04-04T10:00:00Z", ("a", 1), ("b", 2)), Sample("2026-04-04T10:00:05Z", ("a", 3), ("b", 4)) },
            Array.Empty<SignalChartStat>());

        var series = Project(model).Series;

        Assert.Collection(
            series,
            s => Assert.Equal(("a", 0), (s.Name, s.ColorIndex)),
            s => Assert.Equal(("b", 2), (s.Name, s.ColorIndex)));
    }

    // ── Dual-axis decision (web useRightAxis memo) ──────────────────────────────────────────────────────

    [Fact]
    public void RightAxis_is_false_with_fewer_than_two_stats()
    {
        Assert.False(SignalChartPanelProjection.ComputeUseRightAxis(Array.Empty<SignalChartStat>()));
        Assert.False(SignalChartPanelProjection.ComputeUseRightAxis(new[] { new SignalChartStat(0, 100) }));
    }

    [Fact]
    public void RightAxis_is_true_when_ranges_differ_by_more_than_ten_fold()
    {
        // 400 / 30 ≈ 13.3 > 10.
        Assert.True(SignalChartPanelProjection.ComputeUseRightAxis(
            new[] { new SignalChartStat(0, 30), new SignalChartStat(0, 400) }));

        // Order-independent: the second being the small one also trips it.
        Assert.True(SignalChartPanelProjection.ComputeUseRightAxis(
            new[] { new SignalChartStat(0, 400), new SignalChartStat(0, 30) }));
    }

    [Fact]
    public void RightAxis_is_false_at_exactly_ten_fold_and_within()
    {
        // 300 / 30 == 10 — the web uses a strict `> 10`, so equal does not trip it.
        Assert.False(SignalChartPanelProjection.ComputeUseRightAxis(
            new[] { new SignalChartStat(0, 30), new SignalChartStat(0, 300) }));
    }

    [Fact]
    public void RightAxis_treats_a_zero_span_as_unit_like_the_web_or_fallback()
    {
        // Web: Math.abs(max - min) || 1. A flat first series (span 0 → 1) vs a span-20 second → 20 / 1 = 20 > 10.
        Assert.True(SignalChartPanelProjection.ComputeUseRightAxis(
            new[] { new SignalChartStat(5, 5), new SignalChartStat(0, 20) }));
    }

    [Fact]
    public void RightAxis_surfaces_on_the_display()
    {
        var model = new SignalChartPanelModel(
            new[] { "a", "b" },
            new[] { Sample("2026-04-04T10:00:00Z", ("a", 1), ("b", 2)), Sample("2026-04-04T10:00:05Z", ("a", 2), ("b", 4)) },
            new[] { new SignalChartStat(0, 1), new SignalChartStat(0, 400) });

        Assert.True(Project(model).UseRightAxis);
    }

    // ── Overlay / grid resolution (web effectiveMode memo) ──────────────────────────────────────────────

    [Fact]
    public void EffectiveMode_overlay_stays_overlay() =>
        Assert.Equal(SignalChartMode.Overlay, SignalChartPanelProjection.ResolveEffectiveMode(SignalChartMode.Overlay, 12, 8));

    [Fact]
    public void EffectiveMode_explicit_grid_needs_two_signals()
    {
        Assert.Equal(SignalChartMode.Overlay, SignalChartPanelProjection.ResolveEffectiveMode(SignalChartMode.Grid, 1, 8));
        Assert.Equal(SignalChartMode.Grid, SignalChartPanelProjection.ResolveEffectiveMode(SignalChartMode.Grid, 2, 8));
    }

    [Fact]
    public void EffectiveMode_auto_flips_to_grid_only_above_the_threshold()
    {
        Assert.Equal(SignalChartMode.Overlay, SignalChartPanelProjection.ResolveEffectiveMode(SignalChartMode.Auto, 8, 8));
        Assert.Equal(SignalChartMode.Grid, SignalChartPanelProjection.ResolveEffectiveMode(SignalChartMode.Auto, 9, 8));
    }

    // ── State ladder (web body branches) ────────────────────────────────────────────────────────────────

    [Fact]
    public void Loading_when_loading_and_not_live() =>
        Assert.Equal(SignalChartPanelState.Loading, Project(SignalChartPanelModel.Pending).State);

    [Fact]
    public void Live_never_shows_the_skeleton_even_while_loading()
    {
        var model = new SignalChartPanelModel(
            Array.Empty<string>(), Array.Empty<SignalChartSample>(), Array.Empty<SignalChartStat>())
        {
            Loading = true,
            IsLive = true,
        };

        Assert.Equal(SignalChartPanelState.LiveWaiting, Project(model).State);
    }

    [Fact]
    public void Overlay_when_data_present_and_resolved_overlay()
    {
        var display = Project(TwoSignalOverlay());

        Assert.Equal(SignalChartPanelState.Overlay, display.State);
        Assert.Equal(SignalChartMode.Overlay, display.EffectiveMode);
        Assert.Equal(2, display.PointCount);
    }

    [Fact]
    public void Grid_when_data_present_and_resolved_grid()
    {
        var model = TwoSignalOverlay() with { ChartMode = SignalChartMode.Grid };

        var display = Project(model);

        Assert.Equal(SignalChartPanelState.Grid, display.State);
        Assert.Equal(SignalChartMode.Grid, display.EffectiveMode);
    }

    [Fact]
    public void LiveWaiting_when_live_with_no_samples() =>
        Assert.Equal(SignalChartPanelState.LiveWaiting, Project(SignalChartPanelModel.LiveWaiting).State);

    [Fact]
    public void Empty_when_historical_with_no_samples() =>
        Assert.Equal(SignalChartPanelState.Empty, Project(SignalChartPanelModel.Empty).State);

    // ── Resolved title (web resolvedTitle) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Title_defaults_to_signal_chart_when_historical() =>
        Assert.Equal("Signal Chart", Project(SignalChartPanelModel.Empty).Title);

    [Fact]
    public void Title_defaults_to_live_signal_stream_when_live() =>
        Assert.Equal("Live Signal Stream", Project(SignalChartPanelModel.LiveWaiting).Title);

    [Fact]
    public void Title_override_wins_over_the_default()
    {
        var model = SignalChartPanelModel.LiveWaiting with { Title = "Pinned Signals" };

        Assert.Equal("Pinned Signals", Project(model).Title);
    }

    // ── Header annotation (web live counters / historical points-loaded) ────────────────────────────────

    [Fact]
    public void Live_annotation_folds_event_and_point_counters_with_grouping()
    {
        var model = TwoSignalOverlay() with { IsLive = true, LiveEventCount = 1234 };

        var display = Project(model);

        Assert.True(display.ShowLivePulse);
        Assert.Equal("1,234 events \u00B7 2 points", display.HeaderAnnotation);
    }

    [Fact]
    public void Live_annotation_defaults_a_missing_event_count_to_zero()
    {
        var model = SignalChartPanelModel.LiveWaiting; // live, no data, no count

        Assert.Equal("0 events \u00B7 0 points", Project(model).HeaderAnnotation);
    }

    [Fact]
    public void Historical_annotation_is_the_points_loaded_note_when_data_present()
    {
        var model = TwoSignalOverlay() with { PointsLoaded = 4096 };

        var display = Project(model);

        Assert.False(display.ShowLivePulse);
        Assert.Equal("4,096 points loaded", display.HeaderAnnotation);
    }

    [Fact]
    public void Historical_annotation_is_blank_without_a_points_loaded_count()
    {
        Assert.Equal(string.Empty, Project(TwoSignalOverlay()).HeaderAnnotation);
    }

    [Fact]
    public void Historical_annotation_is_blank_when_there_is_no_data()
    {
        var model = SignalChartPanelModel.Empty with { PointsLoaded = 99 };

        Assert.Equal(string.Empty, Project(model).HeaderAnnotation);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ───────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_surface_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(SignalChartPanelModel.Pending),
                Project(SignalChartPanelModel.LiveWaiting),
                Project(SignalChartPanelModel.Empty),
                Project(TwoSignalOverlay()),
                Project(TwoSignalOverlay() with { ChartMode = SignalChartMode.Grid }),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_pairs_the_title_with_the_loading_label() =>
        Assert.Equal("Signal Chart. Loading", Project(SignalChartPanelModel.Pending).AutomationName);

    [Fact]
    public void Waiting_automation_name_pairs_the_title_with_the_waiting_message() =>
        Assert.Equal(
            "Live Signal Stream. Waiting for signal data\u2026",
            Project(SignalChartPanelModel.LiveWaiting).AutomationName);

    [Fact]
    public void Empty_automation_name_pairs_the_title_with_the_empty_message() =>
        Assert.Equal("Signal Chart. No data for this time range", Project(SignalChartPanelModel.Empty).AutomationName);

    [Fact]
    public void Chart_automation_name_folds_the_title_and_annotation()
    {
        var model = TwoSignalOverlay() with { IsLive = true, LiveEventCount = 5 };

        Assert.Equal("Live Signal Stream. 5 events \u00B7 2 points", Project(model).AutomationName);
    }

    [Fact]
    public void Chart_automation_name_is_just_the_title_without_an_annotation() =>
        Assert.Equal("Signal Chart", Project(TwoSignalOverlay()).AutomationName);

    // ── i18n: the projection feeds the documented keys to the facade ────────────────────────────────────

    [Fact]
    public void Projection_resolves_chrome_through_the_documented_keys()
    {
        var echo = new KeyEchoLocalizer();

        Assert.Equal("signalChart.title", SignalChartPanelProjection.Project(SignalChartPanelModel.Empty, echo).Title);
        Assert.Equal("signalChart.liveTitle", SignalChartPanelProjection.Project(SignalChartPanelModel.LiveWaiting, echo).Title);
        Assert.Equal(
            "signalChart.empty",
            SignalChartPanelProjection.Project(SignalChartPanelModel.Empty, echo).EmptyMessage);
        Assert.Equal(
            "signalChart.liveWaiting",
            SignalChartPanelProjection.Project(SignalChartPanelModel.LiveWaiting, echo).WaitingMessage);
        Assert.Equal("common.loading", SignalChartPanelProjection.Project(SignalChartPanelModel.Pending, echo).LoadingLabel);
    }

    [Fact]
    public void Live_annotation_uses_the_events_and_points_keys()
    {
        var model = SignalChartPanelModel.LiveWaiting with { LiveEventCount = 1 };

        Assert.Equal(
            "1 signalChart.events \u00B7 0 signalChart.points",
            SignalChartPanelProjection.Project(model, new KeyEchoLocalizer()).HeaderAnnotation);
    }

    [Fact]
    public void Historical_annotation_uses_the_points_loaded_key()
    {
        var model = TwoSignalOverlay() with { PointsLoaded = 3 };

        Assert.Equal(
            "3 signalChart.pointsLoaded",
            SignalChartPanelProjection.Project(model, new KeyEchoLocalizer()).HeaderAnnotation);
    }

    // ── Diagnostics (P1/S11): view.opened slug=SignalChartPanel, PII-safe ───────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SignalChartPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalChartPanel", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_a_signal_name_or_reading()
    {
        var captured = new List<string>();
        var diagnostics = new SignalChartPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=SignalChartPanel", line);
        Assert.DoesNotContain("speed", line, StringComparison.Ordinal);
        Assert.DoesNotContain("power", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("SignalChartPanel", SignalChartPanelRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => SignalChartPanelProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => SignalChartPanelProjection.Project(SignalChartPanelModel.Empty, null!));

    [Fact]
    public void ComputeUseRightAxis_rejects_null_stats() =>
        Assert.Throws<ArgumentNullException>(() => SignalChartPanelProjection.ComputeUseRightAxis(null!));

    /// <summary>
    /// An <see cref="ILocalizer"/> that echoes the requested key (ignoring the fallback), proving the
    /// projection feeds the documented i18n keys — not ad-hoc English literals — into the facade.
    /// </summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }
}
