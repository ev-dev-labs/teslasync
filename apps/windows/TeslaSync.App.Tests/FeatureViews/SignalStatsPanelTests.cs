using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SignalStatsPanel</c> feature surface's UI-thread-free logic — the
/// <c>displayStats</c> derivation (selected-signal gap-filling), the <c>renderNumeric</c> coercion
/// (NaN / non-finite → em-dash, else <c>fmtNumber</c>), the <c>fmtInt</c> count, the categorical colour
/// mapping, the hide-empty filter + interpolated toggle label, the loading / ready / empty state matrix, the
/// composed Narrator names, the localized i18n key set, the registry metadata and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/telemetry/components/SignalStatsPanel.tsx). The WinUI view itself
/// (feature-views\SignalStatsPanel\SignalStatsPanel.cs) is exercised by the app build.
/// </summary>
public sealed class SignalStatsPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SignalStatsModel Model(
        IReadOnlyList<SignalStat>? stats = null,
        IReadOnlyList<string>? selectedSignals = null,
        bool loading = false,
        string? title = null,
        IReadOnlyDictionary<string, int>? signalIndex = null) =>
        new(stats ?? Array.Empty<SignalStat>(), selectedSignals, loading, title, signalIndex);

    private static SignalStatsDisplay Project(
        SignalStatsModel model,
        bool hideEmpty = false,
        int precision = SignalStatsProjection.DefaultPrecision,
        ILocalizer? localizer = null) =>
        SignalStatsProjection.Project(model, hideEmpty, precision, localizer ?? Localizer);

    private static SignalStat Stat(string signal, double min, double max, double avg, int count) =>
        new(signal, min, max, avg, count);

    // ── displayStats derivation (web useMemo) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Without_selected_signals_stats_pass_through_unchanged()
    {
        var stats = new[] { Stat("a", 1, 2, 1.5, 3), Stat("b", 0, 9, 4, 7) };

        var result = SignalStatsProjection.BuildDisplayStats(stats, selectedSignals: null);

        Assert.Same(stats, result);
    }

    [Fact]
    public void Selected_signals_emit_one_row_each_filling_gaps_with_no_data_rows()
    {
        var stats = new[] { Stat("speed", 1, 2, 1.5, 3) };

        var result = SignalStatsProjection.BuildDisplayStats(stats, new[] { "speed", "missing" });

        Assert.Equal(2, result.Count);
        Assert.Equal("speed", result[0].Signal);
        Assert.False(result[0].IsEmpty);

        Assert.Equal("missing", result[1].Signal);
        Assert.True(result[1].IsEmpty);
        Assert.Equal(0, result[1].Count);
        Assert.True(double.IsNaN(result[1].Min));
    }

    [Fact]
    public void Selected_signals_preserve_order_and_last_duplicate_stat_wins()
    {
        var stats = new[] { Stat("x", 1, 1, 1, 1), Stat("x", 5, 5, 5, 9) };

        var result = SignalStatsProjection.BuildDisplayStats(stats, new[] { "x" });

        Assert.Equal(9, Assert.Single(result).Count); // web Map keeps the last entry for a name
    }

    [Fact]
    public void Empty_selected_signals_list_falls_back_to_stats()
    {
        var stats = new[] { Stat("a", 1, 2, 1.5, 3) };

        Assert.Same(stats, SignalStatsProjection.BuildDisplayStats(stats, Array.Empty<string>()));
    }

    // ── renderNumeric coercion (web) ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Numeric_cell_formats_a_finite_value_at_the_given_precision()
    {
        var cell = SignalStatsProjection.NumericCell(42.337, 2);

        Assert.False(cell.IsNoData);
        Assert.Equal("42.34", cell.Text); // halfExpand rounding, en-US grouping
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Numeric_cell_renders_the_em_dash_for_nan_or_non_finite(double value)
    {
        var cell = SignalStatsProjection.NumericCell(value, 2);

        Assert.True(cell.IsNoData);
        Assert.Equal(SignalStatsProjection.EmDash, cell.Text);
    }

    [Fact]
    public void Numeric_cell_groups_thousands_and_clamps_negative_precision()
    {
        Assert.Equal("12,345", SignalStatsProjection.NumericCell(12345, 0).Text);
        Assert.Equal("1,234", SignalStatsProjection.NumericCell(1234.4, -3).Text); // negative precision clamps to 0
    }

    // ── State matrix: loading / ready / empty ──────────────────────────────────────────────────────────────

    [Fact]
    public void Loading_model_projects_the_loading_state_with_no_rows()
    {
        var display = Project(Model(loading: true));

        Assert.Equal(SignalStatsState.Loading, display.State);
        Assert.Empty(display.Rows);
        Assert.Equal("Loading", display.LoadingLabel);
    }

    [Fact]
    public void Loading_takes_precedence_even_when_stats_are_present()
    {
        var display = Project(Model(new[] { Stat("a", 1, 2, 1.5, 3) }, loading: true));

        Assert.Equal(SignalStatsState.Loading, display.State);
    }

    [Fact]
    public void Resolved_stats_render_the_ready_state_with_one_row_each()
    {
        var display = Project(Model(new[] { Stat("a", 1, 2, 1.5, 3), Stat("b", 0, 9, 4, 7) }));

        Assert.Equal(SignalStatsState.Ready, display.State);
        Assert.Equal(2, display.RowCount);
        Assert.Equal(0, display.EmptyCount);
        Assert.False(display.ShowHideEmptyToggle);
    }

    [Fact]
    public void No_stats_renders_the_empty_state()
    {
        var display = Project(Model());

        Assert.Equal(SignalStatsState.Empty, display.State);
        Assert.Empty(display.Rows);
        Assert.Equal("No stats available", display.EmptyMessage);
    }

    [Fact]
    public void Hiding_every_row_renders_the_empty_state_but_keeps_the_toggle_visible()
    {
        // All rows are no-data; hiding them empties the body, but the toggle stays shown (web emptyCount > 0).
        var stats = new[] { Stat("a", double.NaN, double.NaN, double.NaN, 0) };

        var display = Project(Model(stats), hideEmpty: true);

        Assert.Equal(SignalStatsState.Empty, display.State);
        Assert.Empty(display.Rows);
        Assert.True(display.ShowHideEmptyToggle);
        Assert.Equal(1, display.EmptyCount);
    }

    // ── emptyCount + hide-empty filter (web) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_count_counts_zero_sample_rows_and_shows_the_toggle()
    {
        var stats = new[]
        {
            Stat("a", 1, 2, 1.5, 3),
            Stat("b", double.NaN, double.NaN, double.NaN, 0),
            Stat("c", double.NaN, double.NaN, double.NaN, 0),
        };

        var display = Project(Model(stats));

        Assert.Equal(2, display.EmptyCount);
        Assert.True(display.ShowHideEmptyToggle);
        Assert.Equal(3, display.RowCount); // not hidden yet
    }

    [Fact]
    public void Hide_empty_drops_the_no_data_rows_but_keeps_the_populated_ones()
    {
        var stats = new[]
        {
            Stat("a", 1, 2, 1.5, 3),
            Stat("b", double.NaN, double.NaN, double.NaN, 0),
        };

        var display = Project(Model(stats), hideEmpty: true);

        Assert.Equal(SignalStatsState.Ready, display.State);
        Assert.Equal("a", Assert.Single(display.Rows).Signal);
        Assert.Equal(1, display.EmptyCount); // count is from the full set, independent of the filter
        Assert.True(display.HideEmpty);
    }

    [Fact]
    public void Hide_empty_label_interpolates_the_empty_count()
    {
        var stats = new[]
        {
            Stat("a", 1, 2, 1.5, 3),
            Stat("b", double.NaN, double.NaN, double.NaN, 0),
            Stat("c", double.NaN, double.NaN, double.NaN, 0),
        };

        var display = Project(Model(stats));

        Assert.Equal("Hide empty (2)", display.HideEmptyLabel);
        Assert.DoesNotContain(SignalStatsPanelRegistration.CountToken, display.HideEmptyLabel, StringComparison.Ordinal);
    }

    // ── Row projection: cells, subtitle, colour ────────────────────────────────────────────────────────────

    [Fact]
    public void A_populated_row_formats_min_max_avg_at_precision_and_count_as_integer()
    {
        var display = Project(Model(new[] { Stat("speed", 1.5, 88.25, 42.337, 1234) }));

        var row = Assert.Single(display.Rows);
        Assert.Equal("1.50", row.Min.Text);
        Assert.Equal("88.25", row.Max.Text);
        Assert.Equal("42.34", row.Avg.Text);
        Assert.Equal("1,234", row.CountText);
        Assert.False(row.IsEmpty);
        Assert.Null(row.NoDataSubtitle);
    }

    [Fact]
    public void An_empty_row_renders_em_dashes_and_the_no_data_subtitle()
    {
        var display = Project(Model(new[] { Stat("ghost", double.NaN, double.NaN, double.NaN, 0) }));

        var row = Assert.Single(display.Rows);
        Assert.True(row.IsEmpty);
        Assert.True(row.Min.IsNoData);
        Assert.True(row.Max.IsNoData);
        Assert.True(row.Avg.IsNoData);
        Assert.Equal(SignalStatsProjection.EmDash, row.Min.Text);
        Assert.Equal("0", row.CountText);
        Assert.Equal("No data in range", row.NoDataSubtitle);
    }

    [Fact]
    public void Precision_override_changes_the_numeric_cell_format()
    {
        var display = Project(Model(new[] { Stat("a", 1.23456, 9, 5, 2) }), precision: 4);

        Assert.Equal("1.2346", display.Rows[0].Min.Text);
    }

    [Fact]
    public void Signal_colour_uses_the_categorical_palette_by_position()
    {
        var display = Project(Model(new[] { Stat("a", 1, 2, 1.5, 3), Stat("b", 0, 9, 4, 7) }));

        Assert.Equal(ChartPalette.KeyForIndex(0), display.Rows[0].ColorKey);
        Assert.Equal(ChartPalette.KeyForIndex(1), display.Rows[1].ColorKey);
    }

    [Fact]
    public void Signal_index_overrides_the_positional_colour_and_clamps_negatives()
    {
        var signalIndex = new Dictionary<string, int>(StringComparer.Ordinal) { ["a"] = 5, ["b"] = -3 };

        var display = Project(Model(new[] { Stat("a", 1, 2, 1.5, 3), Stat("b", 0, 9, 4, 7) }, signalIndex: signalIndex));

        Assert.Equal(ChartPalette.KeyForIndex(5), display.Rows[0].ColorKey);
        Assert.Equal(ChartPalette.KeyForIndex(0), display.Rows[1].ColorKey); // web Math.max(0, -3)
    }

    [Fact]
    public void Color_key_is_a_theme_token_brush_key_never_a_literal_hex()
    {
        var display = Project(Model(new[] { Stat("a", 1, 2, 1.5, 3) }));

        string key = display.Rows[0].ColorKey;
        Assert.StartsWith("TsChart", key, StringComparison.Ordinal);
        Assert.EndsWith("Brush", key, StringComparison.Ordinal);
        Assert.DoesNotContain('#', key);
    }

    // ── Title ──────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_defaults_to_the_localized_stats_summary()
    {
        Assert.Equal("Stats Summary", Project(Model()).Title);
    }

    [Fact]
    public void Title_override_is_used_verbatim()
    {
        Assert.Equal("My Signals", Project(Model(title: "My Signals")).Title);
    }

    // ── Accessibility: composed Narrator names ─────────────────────────────────────────────────────────────

    [Fact]
    public void Every_row_exposes_a_narrator_name_with_the_signal_and_values()
    {
        var display = Project(Model(new[] { Stat("VehicleSpeed", 1.5, 88.25, 42.337, 1234) }));

        string automation = Assert.Single(display.Rows).AutomationName;
        Assert.Contains("VehicleSpeed", automation, StringComparison.Ordinal);
        Assert.Contains("Min: 1.50", automation, StringComparison.Ordinal);
        Assert.Contains("Avg: 42.34", automation, StringComparison.Ordinal);
        Assert.Contains("Count: 1,234", automation, StringComparison.Ordinal);
    }

    [Fact]
    public void An_empty_row_announces_no_data_rather_than_the_em_dash_glyph()
    {
        var display = Project(Model(new[] { Stat("ghost", double.NaN, double.NaN, double.NaN, 0) }));

        string automation = Assert.Single(display.Rows).AutomationName;
        Assert.Contains("No data", automation, StringComparison.Ordinal);
        Assert.DoesNotContain(SignalStatsProjection.EmDash, automation, StringComparison.Ordinal);
    }

    [Fact]
    public void The_region_label_resolves_for_narrator()
    {
        Assert.Equal("Statistics summary", Project(Model()).RegionLabel);
        Assert.Equal("No data", Project(Model()).NoDataLabel);
    }

    // ── i18n: every key from the source resolves with the web default (P1/S10 catalog) ────────────────────

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        // A mixed set (one populated + one empty row) exercises every label, including the toggle + subtitle.
        Project(
            Model(new[] { Stat("a", 1, 2, 1.5, 3), Stat("b", double.NaN, double.NaN, double.NaN, 0) }),
            localizer: recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Signal"] = "Signal",
            ["Min"] = "Min",
            ["Max"] = "Max",
            ["Avg"] = "Avg",
            ["Count"] = "Count",
            ["Stats Summary"] = "Stats Summary",
            ["No stats available"] = "No stats available",
            ["signalStats.noDataInRange"] = "No data in range",
            ["signalStats.hideEmpty"] = "Hide empty ({{count}})",
            ["signalStats.noData"] = "No data",
            ["signalStats.region"] = "Statistics summary",
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
        Assert.Equal("Signal", SignalStatsPanelRegistration.SignalHeaderKey);
        Assert.Equal("Min", SignalStatsPanelRegistration.MinHeaderKey);
        Assert.Equal("Max", SignalStatsPanelRegistration.MaxHeaderKey);
        Assert.Equal("Avg", SignalStatsPanelRegistration.AvgHeaderKey);
        Assert.Equal("Count", SignalStatsPanelRegistration.CountHeaderKey);
        Assert.Equal("Stats Summary", SignalStatsPanelRegistration.TitleKey);
        Assert.Equal("No stats available", SignalStatsPanelRegistration.NoStatsKey);
        Assert.Equal("signalStats.noDataInRange", SignalStatsPanelRegistration.NoDataInRangeKey);
        Assert.Equal("signalStats.hideEmpty", SignalStatsPanelRegistration.HideEmptyKey);
    }

    [Fact]
    public void Hide_empty_fallback_carries_the_web_interpolation_token()
    {
        Assert.Equal("Hide empty ({{count}})", SignalStatsPanelRegistration.HideEmptyFallback);
        Assert.Contains(
            SignalStatsPanelRegistration.CountToken,
            SignalStatsPanelRegistration.HideEmptyFallback,
            StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): PII-safe slugged events ─────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SignalStatsPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SignalStatsPanel", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("SignalStatsPanel", SignalStatsPanelRegistration.Slug);
    }

    // ── Model defaults ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Pending_model_is_loading_and_empty_model_is_resolved()
    {
        Assert.True(SignalStatsModel.Pending.Loading);
        Assert.Empty(SignalStatsModel.Pending.Stats);

        Assert.False(SignalStatsModel.Empty.Loading);
        Assert.Equal(SignalStatsState.Empty, Project(SignalStatsModel.Empty).State);
    }

    [Fact]
    public void No_data_stat_factory_marks_the_row_empty_with_nan_values()
    {
        var stat = SignalStat.NoData("x");

        Assert.Equal("x", stat.Signal);
        Assert.True(stat.IsEmpty);
        Assert.True(double.IsNaN(stat.Min));
        Assert.True(double.IsNaN(stat.Max));
        Assert.True(double.IsNaN(stat.Avg));
        Assert.Equal(0, stat.Count);
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
