using System.Collections.Generic;
using TeslaSync.App.SharedSurfaces.KpiOverviewCardSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>KpiOverviewCard</c> shared surface's UI-thread-free logic — the pure
/// projection (the header strings, the composed period strip, the optional headline-delta / actions / secondary
/// / footer regions, the empty-vs-populated grid), the responsive column resolver across the web breakpoints and
/// the fixed-column override, the data seam's change notifications, the view-model's state projection, the
/// PII-safe diagnostics and the registration metadata. The composition cases mirror the web source
/// (web/src/components/data-display/KpiOverviewCard.tsx + ComparisonHeader.tsx). The WinUI view itself (the
/// glass panel, the grid placement, the empty state) is exercised by the app build.
/// </summary>
public sealed class KpiOverviewCardTests
{
    private const string Title = "Overview";
    private const string Current = "Last 30 days";
    private const string Comparison = "vs prior 30 days";

    private static KpiOverviewCardInput Input(
        string title = Title,
        string currentLabel = Current,
        string? comparisonLabel = null,
        bool hasHeadlineDelta = false,
        bool hasActions = false,
        bool hasSecondary = false,
        bool hasFooter = false,
        int kpiCount = 6,
        int? gridColumns = null,
        string? testId = null) =>
        new()
        {
            Header = new KpiOverviewCardHeader
            {
                Title = title,
                CurrentLabel = currentLabel,
                ComparisonLabel = comparisonLabel,
            },
            HasHeadlineDelta = hasHeadlineDelta,
            HasActions = hasActions,
            HasSecondary = hasSecondary,
            HasFooter = hasFooter,
            KpiCount = kpiCount,
            GridColumns = gridColumns,
            TestId = testId,
        };

    private static KpiOverviewCardDisplay Project(KpiOverviewCardInput input) =>
        KpiOverviewCardProjection.Project(input);

    // ── Header period strip (web ComparisonHeader L60-L69) ───────────────────────────────────────────────

    [Fact]
    public void Period_without_comparison_is_just_the_current_label()
    {
        var d = Project(Input(comparisonLabel: null));

        Assert.False(d.HasComparisonLabel);
        Assert.Equal(Current, d.PeriodText);
        Assert.Equal(string.Empty, d.ComparisonLabel);
    }

    [Fact]
    public void Period_with_comparison_joins_with_the_middot_separator()
    {
        var d = Project(Input(comparisonLabel: Comparison));

        Assert.True(d.HasComparisonLabel);
        Assert.Equal(Current + KpiOverviewCardRegistration.PeriodSeparator + Comparison, d.PeriodText);
        Assert.Equal(Comparison, d.ComparisonLabel);
    }

    [Fact]
    public void Empty_comparison_label_drops_the_separator()
    {
        var d = Project(Input(comparisonLabel: ""));

        Assert.False(d.HasComparisonLabel);
        Assert.Equal(Current, d.PeriodText);
    }

    // ── Header title + heading (web ComparisonHeader L57-L60) ────────────────────────────────────────────

    [Fact]
    public void Title_is_carried_through_to_the_display()
    {
        var d = Project(Input(title: "Charging summary"));

        Assert.Equal("Charging summary", d.Title);
    }

    // ── Header accessory: headline delta + actions (web ComparisonHeader L71-L74) ────────────────────────

    [Fact]
    public void No_accessory_when_neither_delta_nor_actions_present()
    {
        var d = Project(Input(hasHeadlineDelta: false, hasActions: false));

        Assert.False(d.ShowHeadlineDelta);
        Assert.False(d.ShowActions);
        Assert.False(d.ShowHeaderAccessory);
    }

    [Fact]
    public void Headline_delta_shows_the_accessory_column()
    {
        var d = Project(Input(hasHeadlineDelta: true));

        Assert.True(d.ShowHeadlineDelta);
        Assert.True(d.ShowHeaderAccessory);
    }

    [Fact]
    public void Actions_show_the_accessory_column()
    {
        var d = Project(Input(hasActions: true));

        Assert.True(d.ShowActions);
        Assert.True(d.ShowHeaderAccessory);
    }

    [Fact]
    public void Delta_and_actions_together_show_the_accessory_column()
    {
        var d = Project(Input(hasHeadlineDelta: true, hasActions: true));

        Assert.True(d.ShowHeadlineDelta);
        Assert.True(d.ShowActions);
        Assert.True(d.ShowHeaderAccessory);
    }

    // ── Optional secondary + footer slots (web KpiOverviewCard L95-L101) ─────────────────────────────────

    [Fact]
    public void Secondary_line_hidden_by_default_and_shown_when_present()
    {
        Assert.False(Project(Input(hasSecondary: false)).ShowSecondary);
        Assert.True(Project(Input(hasSecondary: true)).ShowSecondary);
    }

    [Fact]
    public void Footer_hidden_by_default_and_shown_when_present()
    {
        Assert.False(Project(Input(hasFooter: false)).ShowFooter);
        Assert.True(Project(Input(hasFooter: true)).ShowFooter);
    }

    // ── KPI grid: populated vs empty (the empty-state contract) ──────────────────────────────────────────

    [Fact]
    public void Populated_grid_has_kpis_and_no_empty_state()
    {
        var d = Project(Input(kpiCount: 6));

        Assert.True(d.HasKpis);
        Assert.False(d.ShowEmptyState);
    }

    [Fact]
    public void No_tiles_resolves_to_the_empty_state()
    {
        var d = Project(Input(kpiCount: 0));

        Assert.False(d.HasKpis);
        Assert.True(d.ShowEmptyState);
    }

    // ── Responsive column resolver (web grid-cols-2 sm:grid-cols-3 lg:grid-cols-6) ────────────────────────

    [Theory]
    [InlineData(0, KpiOverviewCardRegistration.NarrowColumns)]
    [InlineData(-1, KpiOverviewCardRegistration.NarrowColumns)]
    [InlineData(320, KpiOverviewCardRegistration.NarrowColumns)]
    [InlineData(639, KpiOverviewCardRegistration.NarrowColumns)]
    [InlineData(640, KpiOverviewCardRegistration.MediumColumns)]
    [InlineData(800, KpiOverviewCardRegistration.MediumColumns)]
    [InlineData(1023, KpiOverviewCardRegistration.MediumColumns)]
    [InlineData(1024, KpiOverviewCardRegistration.WideColumns)]
    [InlineData(1600, KpiOverviewCardRegistration.WideColumns)]
    public void Default_grid_follows_the_breakpoints(double width, int expected)
    {
        var d = Project(Input(gridColumns: null));

        Assert.Equal(expected, d.ResolveColumnCount(width));
    }

    [Fact]
    public void Unmeasured_width_resolves_to_the_mobile_first_base_count()
    {
        var d = Project(Input(gridColumns: null));

        Assert.Equal(KpiOverviewCardRegistration.NarrowColumns, d.ResolveColumnCount(double.NaN));
    }

    [Theory]
    [InlineData(320)]
    [InlineData(800)]
    [InlineData(1600)]
    public void Column_override_pins_the_count_at_every_width(double width)
    {
        var d = Project(Input(gridColumns: 4));

        Assert.Equal(4, d.GridColumns);
        Assert.Equal(4, d.ResolveColumnCount(width));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    public void Non_positive_override_falls_back_to_the_responsive_grid(int columns)
    {
        var d = Project(Input(gridColumns: columns));

        Assert.Null(d.GridColumns);
        Assert.Equal(KpiOverviewCardRegistration.WideColumns, d.ResolveColumnCount(1280));
    }

    // ── Accessibility: the card region always has a Narrator name (web <h3> heading) ─────────────────────

    [Fact]
    public void Accessible_name_is_the_title_when_present()
    {
        var d = Project(Input(title: "Drives overview", comparisonLabel: Comparison));

        Assert.Equal("Drives overview", d.AccessibleName);
    }

    [Fact]
    public void Accessible_name_falls_back_to_the_period_when_title_is_empty()
    {
        var d = Project(Input(title: "", comparisonLabel: Comparison));

        Assert.Equal(Current + KpiOverviewCardRegistration.PeriodSeparator + Comparison, d.AccessibleName);
        Assert.False(string.IsNullOrWhiteSpace(d.AccessibleName));
    }

    [Fact]
    public void Every_composition_exposes_a_non_empty_accessible_name()
    {
        foreach (var d in new[]
                 {
                     Project(Input()),
                     Project(Input(comparisonLabel: Comparison, hasHeadlineDelta: true, hasActions: true)),
                     Project(Input(title: "", currentLabel: Current)),
                     Project(Input(kpiCount: 0, hasSecondary: true, hasFooter: true)),
                 })
        {
            Assert.False(string.IsNullOrWhiteSpace(d.AccessibleName));
        }
    }

    // ── Full composition (every optional region on at once) ──────────────────────────────────────────────

    [Fact]
    public void Full_composition_shows_every_region()
    {
        var d = Project(Input(
            comparisonLabel: Comparison,
            hasHeadlineDelta: true,
            hasActions: true,
            hasSecondary: true,
            hasFooter: true,
            kpiCount: 6));

        Assert.True(d.HasComparisonLabel);
        Assert.True(d.ShowHeaderAccessory);
        Assert.True(d.ShowSecondary);
        Assert.True(d.ShowFooter);
        Assert.True(d.HasKpis);
        Assert.False(d.ShowEmptyState);
    }

    [Fact]
    public void Minimal_composition_shows_only_the_header_and_grid()
    {
        var d = Project(Input());

        Assert.False(d.HasComparisonLabel);
        Assert.False(d.ShowHeaderAccessory);
        Assert.False(d.ShowSecondary);
        Assert.False(d.ShowFooter);
    }

    // ── Projection argument validation + null safety ─────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_input()
    {
        Assert.Throws<ArgumentNullException>(() => KpiOverviewCardProjection.Project(null!));
    }

    [Fact]
    public void Project_tolerates_a_null_header()
    {
        var d = Project(new KpiOverviewCardInput { Header = null! });

        Assert.Equal(string.Empty, d.Title);
        Assert.Equal(string.Empty, d.PeriodText);
        Assert.False(d.HasComparisonLabel);
    }

    // ── Data seam: change notifications (P1/S8) ──────────────────────────────────────────────────────────

    [Fact]
    public void Source_starts_with_a_default_input()
    {
        var source = new KpiOverviewCardSource();

        Assert.Equal(0, source.Input.KpiCount);
        Assert.False(source.Input.HasSecondary);
        Assert.Null(source.Input.GridColumns);
    }

    [Fact]
    public void Source_set_input_replaces_and_notifies()
    {
        var source = new KpiOverviewCardSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetInput(Input(comparisonLabel: Comparison, kpiCount: 3));

        Assert.Equal(1, changes);
        Assert.Equal(3, source.Input.KpiCount);
        Assert.Equal(Comparison, source.Input.Header.ComparisonLabel);
    }

    [Fact]
    public void Source_set_input_null_falls_back_to_default()
    {
        var source = new KpiOverviewCardSource(Input(kpiCount: 5));

        source.SetInput(null!);

        Assert.Equal(0, source.Input.KpiCount);
    }

    [Fact]
    public void Source_comparison_label_keeps_the_other_header_fields()
    {
        var source = new KpiOverviewCardSource(Input());

        source.SetComparisonLabel(Comparison);

        Assert.Equal(Title, source.Input.Header.Title);
        Assert.Equal(Current, source.Input.Header.CurrentLabel);
        Assert.Equal(Comparison, source.Input.Header.ComparisonLabel);
    }

    [Fact]
    public void Source_kpi_count_clamps_negatives_to_zero()
    {
        var source = new KpiOverviewCardSource(Input(kpiCount: 4));

        source.SetKpiCount(-10);

        Assert.Equal(0, source.Input.KpiCount);
    }

    [Fact]
    public void Source_flag_toggles_notify_only_on_change()
    {
        var source = new KpiOverviewCardSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetHasSecondary(false); // already false — no change
        Assert.Equal(0, changes);

        source.SetHasSecondary(true);
        source.SetHasFooter(true);
        source.SetHasHeadlineDelta(true);
        source.SetHasActions(true);

        Assert.Equal(4, changes);
        Assert.True(source.Input.HasSecondary);
        Assert.True(source.Input.HasFooter);
        Assert.True(source.Input.HasHeadlineDelta);
        Assert.True(source.Input.HasActions);
    }

    [Fact]
    public void Source_grid_columns_round_trips()
    {
        var source = new KpiOverviewCardSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetGridColumns(4);
        Assert.Equal(4, source.Input.GridColumns);

        source.SetGridColumns(4); // no change
        Assert.Equal(1, changes);

        source.SetGridColumns(null);
        Assert.Null(source.Input.GridColumns);
        Assert.Equal(2, changes);
    }

    // ── View-model: per-state projection over the seam ───────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_source_frame()
    {
        var source = new KpiOverviewCardSource(Input(comparisonLabel: Comparison, kpiCount: 6));
        using var vm = new KpiOverviewCardViewModel(source);

        Assert.Equal(Title, vm.Display.Title);
        Assert.True(vm.Display.HasComparisonLabel);
        Assert.False(vm.ShowEmptyState);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_the_input_changes()
    {
        var source = new KpiOverviewCardSource(Input(kpiCount: 6));
        using var vm = new KpiOverviewCardViewModel(source);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetKpiCount(0);

        Assert.True(vm.ShowEmptyState);
        Assert.Contains(nameof(KpiOverviewCardViewModel.Display), changed);
        Assert.Contains(nameof(KpiOverviewCardViewModel.ShowEmptyState), changed);
    }

    [Fact]
    public void ViewModel_reprojects_the_comparison_label()
    {
        var source = new KpiOverviewCardSource(Input());
        using var vm = new KpiOverviewCardViewModel(source);
        Assert.False(vm.Display.HasComparisonLabel);

        source.SetComparisonLabel(Comparison);

        Assert.True(vm.Display.HasComparisonLabel);
        Assert.Equal(Current + KpiOverviewCardRegistration.PeriodSeparator + Comparison, vm.Display.PeriodText);
    }

    [Fact]
    public void Disposed_view_model_stops_reprojecting()
    {
        var source = new KpiOverviewCardSource(Input(kpiCount: 6));
        var vm = new KpiOverviewCardViewModel(source);

        vm.Dispose();
        source.SetKpiCount(0);

        Assert.False(vm.ShowEmptyState);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new KpiOverviewCardViewModel(new KpiOverviewCardSource());

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void ViewModel_rejects_a_null_source()
    {
        Assert.Throws<ArgumentNullException>(() => new KpiOverviewCardViewModel(null!));
    }

    // ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_and_emits_the_slug()
    {
        var events = new List<string>();
        var diagnostics = new KpiOverviewCardDiagnostics(events.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(2, events.Count);
        Assert.All(events, e => Assert.Equal("view.opened slug=KpiOverviewCard", e));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_counts()
    {
        var diagnostics = new KpiOverviewCardDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ── Registration metadata ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_canonical_slug()
    {
        Assert.Equal("KpiOverviewCard", KpiOverviewCardRegistration.Slug);
        Assert.Equal("KpiOverviewCard", KpiOverviewCardViewModel.Slug);
    }

    [Fact]
    public void Registration_breakpoints_are_ordered_and_columns_ascend()
    {
        Assert.True(KpiOverviewCardRegistration.SmallBreakpoint < KpiOverviewCardRegistration.LargeBreakpoint);
        Assert.True(KpiOverviewCardRegistration.NarrowColumns < KpiOverviewCardRegistration.MediumColumns);
        Assert.True(KpiOverviewCardRegistration.MediumColumns < KpiOverviewCardRegistration.WideColumns);
    }
}
