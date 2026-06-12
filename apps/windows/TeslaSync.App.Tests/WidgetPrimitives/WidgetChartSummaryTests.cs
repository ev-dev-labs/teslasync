using TeslaSync.App.Core.Notifications;
using TeslaSync.App.WidgetPrimitives;
using Xunit;

namespace TeslaSync.App.Tests.WidgetPrimitives;

/// <summary>
/// Headless verification of the WidgetChartSummary primitive's UI-thread-free logic — the registration metadata
/// (slug, automation id, the status role the empty branch exposes, the i18n key + fallback behind the default
/// empty message and the layout metrics), the <see cref="ChartSummaryStat"/> value model (the numeric factory's
/// invariant formatting), the pure <see cref="WidgetChartSummaryProjection"/> adapter (the empty-message
/// resolution, the per-stat value/unit composition, the accessible-name contract and the two render guards
/// <c>stats.length &gt; 0</c> / <c>!compact</c>), the <see cref="WidgetChartSummaryViewModel"/> state holder
/// (initial projection, prop pushes via the source, subscription cleanup) and the PII-safe diagnostics. Mirrors the
/// web spec (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx). The WinUI view
/// (widget-primitives/WidgetChartSummary.cs) is exercised by the app build. Because the primitive reads no network
/// data, there is no loading / error / stale / offline state — the parent widget owns those and flips this
/// primitive into its single empty branch; the reproduced render branches are the empty state, the populated
/// stats+chart state, the compact (no-chart) state and the no-stats (chart-only) state.
/// </summary>
public sealed class WidgetChartSummaryTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static WidgetChartSummaryDisplay Project(WidgetChartSummaryInput input) =>
        WidgetChartSummaryProjection.Project(input, Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("WidgetChartSummary", WidgetChartSummaryRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("widget-chart-summary", WidgetChartSummaryRegistration.RootAutomationId);

    [Fact]
    public void Status_role_describes_the_empty_branch_region() =>
        // web isEmpty branch delegates to <EmptyState role="status">.
        Assert.Equal("status", WidgetChartSummaryRegistration.StatusRole);

    [Fact]
    public void Default_empty_message_key_and_fallback_match_the_web_source()
    {
        // web emptyMessage ?? 'No data available' — the default resolves through common.noData.
        Assert.Equal("translation.common.noData", WidgetChartSummaryRegistration.DefaultEmptyMessageKey);
        Assert.Equal("No data available", WidgetChartSummaryRegistration.DefaultEmptyMessageFallback);
        Assert.Equal("No data available", WidgetChartSummaryRegistration.ResolveDefaultEmptyMessage(Localizer));
    }

    [Fact]
    public void Layout_metrics_match_the_web_tailwind_classes()
    {
        Assert.Equal(10, WidgetChartSummaryRegistration.MicroFontSize);     // text-[10px]
        Assert.Equal(14, WidgetChartSummaryRegistration.ValueFontSize);     // text-sm
        Assert.Equal(600, WidgetChartSummaryRegistration.ValueFontWeight);  // font-semibold
        Assert.Equal(400, WidgetChartSummaryRegistration.MutedFontWeight);  // font-normal
        Assert.Equal(8, WidgetChartSummaryRegistration.CompactGap);         // gap-2
        Assert.Equal(16, WidgetChartSummaryRegistration.WideGap);           // @sm:gap-4
        Assert.Equal(2, WidgetChartSummaryRegistration.UnitLeftMargin);     // ml-0.5
        Assert.Equal(8, WidgetChartSummaryRegistration.ChartTopMargin);     // mt-2
        Assert.Equal(384, WidgetChartSummaryRegistration.HorizontalBreakpointDip); // @sm (24rem)
        Assert.Equal(2, WidgetChartSummaryRegistration.DefaultColumns);     // grid-cols-2
    }

    [Fact]
    public void Resolve_default_empty_message_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(
            () => WidgetChartSummaryRegistration.ResolveDefaultEmptyMessage(localizer: null!));

    // ── ChartSummaryStat value model ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Stat_ctor_keeps_the_supplied_strings()
    {
        var stat = new ChartSummaryStat("Distance", "42", "mi");

        Assert.Equal("Distance", stat.Label);
        Assert.Equal("42", stat.Value);
        Assert.Equal("mi", stat.Unit);
    }

    [Fact]
    public void Stat_ctor_coalesces_null_label_and_value_to_empty()
    {
        var stat = new ChartSummaryStat(null!, null!);

        Assert.Equal(string.Empty, stat.Label);
        Assert.Equal(string.Empty, stat.Value);
        Assert.Null(stat.Unit);
    }

    [Theory]
    [InlineData(1234.5, "1234.5")]
    [InlineData(1000, "1000")]
    [InlineData(0, "0")]
    [InlineData(-12.25, "-12.25")]
    public void Stat_number_factory_formats_with_the_invariant_culture(double value, string expected)
    {
        var stat = ChartSummaryStat.Number("Energy", value, "kWh");

        Assert.Equal(expected, stat.Value);
        Assert.Equal("Energy", stat.Label);
        Assert.Equal("kWh", stat.Unit);
    }

    // ── projection adapter (web component body) ───────────────────────────────────────────────────────────

    [Fact]
    public void Projection_empty_branch_falls_back_to_the_localized_default_message()
    {
        var display = Project(new WidgetChartSummaryInput { IsEmpty = true });

        // web message={emptyMessage ?? 'No data available'} with no override.
        Assert.True(display.IsEmpty);
        Assert.Equal("No data available", display.EmptyMessage);
        Assert.Null(display.EmptyIconGlyph);
    }

    [Fact]
    public void Projection_empty_branch_keeps_a_caller_message_override()
    {
        var display = Project(new WidgetChartSummaryInput
        {
            IsEmpty = true,
            EmptyMessage = "No charging sessions yet",
        });

        Assert.Equal("No charging sessions yet", display.EmptyMessage);
    }

    [Fact]
    public void Projection_empty_branch_keeps_an_empty_string_override_rather_than_falling_back()
    {
        // web uses ?? so only a null (not an empty string) falls back to the default.
        var display = Project(new WidgetChartSummaryInput { IsEmpty = true, EmptyMessage = string.Empty });

        Assert.Equal(string.Empty, display.EmptyMessage);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Projection_normalizes_a_blank_empty_glyph_to_null(string? glyph)
    {
        var display = Project(new WidgetChartSummaryInput { IsEmpty = true, EmptyIconGlyph = glyph });

        // web {icon && …}: no icon node → no glyph rendered.
        Assert.Null(display.EmptyIconGlyph);
    }

    [Fact]
    public void Projection_passes_a_supplied_empty_glyph_through()
    {
        var display = Project(new WidgetChartSummaryInput { IsEmpty = true, EmptyIconGlyph = "\uE9D9" });

        Assert.Equal("\uE9D9", display.EmptyIconGlyph);
    }

    [Fact]
    public void Projection_shows_the_stat_row_only_when_there_are_stats()
    {
        var withStats = Project(new WidgetChartSummaryInput
        {
            Stats = new[] { new ChartSummaryStat("Trips", "12") },
        });
        var withoutStats = Project(new WidgetChartSummaryInput());

        // web {stats.length > 0 && …}
        Assert.True(withStats.ShowStats);
        Assert.False(withoutStats.ShowStats);
    }

    [Fact]
    public void Projection_shows_the_chart_only_when_not_compact()
    {
        var normal = Project(new WidgetChartSummaryInput { Compact = false });
        var compact = Project(new WidgetChartSummaryInput { Compact = true });

        // web {!compact && …}
        Assert.True(normal.ShowChart);
        Assert.False(normal.Compact);
        Assert.False(compact.ShowChart);
        Assert.True(compact.Compact);
    }

    [Fact]
    public void Projection_composes_each_stat_value_and_unit()
    {
        var display = Project(new WidgetChartSummaryInput
        {
            Stats = new[]
            {
                new ChartSummaryStat("Distance", "42", "mi"),
                new ChartSummaryStat("Trips", "12"),
            },
        });

        Assert.Equal(2, display.Stats.Count);

        StatCellDisplay first = display.Stats[0];
        Assert.Equal("Distance", first.Label);
        Assert.Equal("42", first.Value);
        Assert.Equal("mi", first.Unit);
        Assert.True(first.HasUnit);

        StatCellDisplay second = display.Stats[1];
        Assert.Equal("Trips", second.Label);
        Assert.Equal("12", second.Value);
        Assert.Equal(string.Empty, second.Unit);
        Assert.False(second.HasUnit);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Projection_treats_a_blank_unit_as_absent(string? unit)
    {
        var display = Project(new WidgetChartSummaryInput
        {
            Stats = new[] { new ChartSummaryStat("Trips", "12", unit) },
        });

        // web {stat.unit && …}: a blank unit hides the suffix.
        Assert.False(display.Stats[0].HasUnit);
        Assert.Equal(string.Empty, display.Stats[0].Unit);
    }

    [Fact]
    public void Projection_handles_a_null_stats_list_as_empty()
    {
        var display = Project(new WidgetChartSummaryInput { Stats = null! });

        Assert.Empty(display.Stats);
        Assert.False(display.ShowStats);
    }

    [Fact]
    public void Projection_throws_when_inputs_or_localizer_are_null()
    {
        Assert.Throws<ArgumentNullException>(
            () => WidgetChartSummaryProjection.Project(input: null!, Localizer));
        Assert.Throws<ArgumentNullException>(
            () => WidgetChartSummaryProjection.Project(new WidgetChartSummaryInput(), localizer: null!));
    }

    // ── per-state snapshots (the reproduced render branches) ──────────────────────────────────────────────

    [Fact]
    public void Snapshot_empty_state()
    {
        var display = Project(new WidgetChartSummaryInput { IsEmpty = true });

        Assert.True(display.IsEmpty);
        Assert.Equal("No data available", display.EmptyMessage);
        Assert.Empty(display.Stats);
    }

    [Fact]
    public void Snapshot_populated_with_chart()
    {
        var display = Project(new WidgetChartSummaryInput
        {
            Stats = new[] { new ChartSummaryStat("Avg", "55", "mph") },
            Compact = false,
        });

        Assert.False(display.IsEmpty);
        Assert.True(display.ShowStats);
        Assert.True(display.ShowChart);
        Assert.Single(display.Stats);
    }

    [Fact]
    public void Snapshot_compact_hides_the_chart()
    {
        var display = Project(new WidgetChartSummaryInput
        {
            Stats = new[] { new ChartSummaryStat("Avg", "55", "mph") },
            Compact = true,
        });

        Assert.False(display.IsEmpty);
        Assert.True(display.ShowStats);
        Assert.False(display.ShowChart);
    }

    [Fact]
    public void Snapshot_chart_only_when_no_stats()
    {
        var display = Project(new WidgetChartSummaryInput { Compact = false });

        Assert.False(display.IsEmpty);
        Assert.False(display.ShowStats);
        Assert.True(display.ShowChart);
    }

    // ── accessibility: each stat cell is read as one coherent figure ──────────────────────────────────────

    [Fact]
    public void Stat_cell_accessible_name_joins_label_value_and_unit()
    {
        var display = Project(new WidgetChartSummaryInput
        {
            Stats = new[] { new ChartSummaryStat("Distance", "42", "mi") },
        });

        Assert.Equal("Distance, 42 mi", display.Stats[0].AccessibleName);
    }

    [Fact]
    public void Stat_cell_accessible_name_omits_an_absent_unit()
    {
        var display = Project(new WidgetChartSummaryInput
        {
            Stats = new[] { new ChartSummaryStat("Trips", "12") },
        });

        Assert.Equal("Trips, 12", display.Stats[0].AccessibleName);
    }

    [Fact]
    public void Stat_cell_accessible_name_falls_back_to_the_figure_when_unlabeled()
    {
        var display = Project(new WidgetChartSummaryInput
        {
            Stats = new[] { new ChartSummaryStat(string.Empty, "42", "mi") },
        });

        Assert.Equal("42 mi", display.Stats[0].AccessibleName);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("WidgetChartSummary", WidgetChartSummaryViewModel.Slug);

    [Fact]
    public void ViewModel_default_projects_the_empty_props()
    {
        var source = new StaticWidgetChartSummarySource();
        using var viewModel = new WidgetChartSummaryViewModel(Localizer, source);

        Assert.False(viewModel.IsEmpty);
        Assert.False(viewModel.ShowStats);
        Assert.True(viewModel.ShowChart);
        Assert.Empty(viewModel.Stats);
        Assert.Equal("No data available", viewModel.EmptyMessage);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_source_pushes_stats()
    {
        var source = new StaticWidgetChartSummarySource();
        using var viewModel = new WidgetChartSummaryViewModel(Localizer, source);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetStats(new[] { new ChartSummaryStat("Trips", "12") });

        Assert.True(viewModel.ShowStats);
        Assert.Single(viewModel.Stats);
        Assert.Contains(nameof(WidgetChartSummaryViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_source_toggles_empty()
    {
        var source = new StaticWidgetChartSummarySource();
        using var viewModel = new WidgetChartSummaryViewModel(Localizer, source);

        source.SetEmpty(true);

        Assert.True(viewModel.IsEmpty);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_source_replaces_the_whole_input()
    {
        var source = new StaticWidgetChartSummarySource();
        using var viewModel = new WidgetChartSummaryViewModel(Localizer, source);

        source.Set(new WidgetChartSummaryInput
        {
            Compact = true,
            Stats = new[] { new ChartSummaryStat("Avg", "55", "mph") },
        });

        Assert.True(viewModel.Compact);
        Assert.False(viewModel.ShowChart);
        Assert.True(viewModel.ShowStats);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_source()
    {
        var source = new CountingSource();
        var viewModel = new WidgetChartSummaryViewModel(Localizer, source);
        Assert.Equal(1, source.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, source.ObserverCount);

        // After dispose a late change must not move the projection.
        source.PushEmpty();
        Assert.False(viewModel.IsEmpty);
    }

    [Fact]
    public void ViewModel_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(
            () => new WidgetChartSummaryViewModel(localizer: null!, new StaticWidgetChartSummarySource()));
        Assert.Throws<ArgumentNullException>(
            () => new WidgetChartSummaryViewModel(Localizer, source: null!));
    }

    // ── source seam ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_null_assignments_fall_back_to_a_safe_default()
    {
        var source = new StaticWidgetChartSummarySource(current: null!);
        Assert.NotNull(source.Current);

        source.Set(null!);
        Assert.NotNull(source.Current);

        source.SetStats(null!);
        Assert.Empty(source.Current.Stats);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WidgetChartSummaryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetChartSummary", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new WidgetChartSummaryDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new WidgetChartSummaryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(WidgetChartSummaryRegistration.Slug, line, StringComparison.Ordinal);
    }

    /// <summary>A props seam that counts live observers so dispose-cleanup is asserted.</summary>
    private sealed class CountingSource : IWidgetChartSummarySource
    {
        private WidgetChartSummaryInput _current = new();

        public event EventHandler? Changed;

        public WidgetChartSummaryInput Current => _current;

        public int ObserverCount => Changed?.GetInvocationList().Length ?? 0;

        public void PushEmpty()
        {
            _current = _current with { IsEmpty = true };
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }
}
