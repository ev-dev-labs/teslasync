using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the PageSkeleton surface's UI-thread-free logic — the registration metadata (slug,
/// the ARIA role/live contract, the per-block automation ids + i18n label keys/fallbacks, the Tailwind-derived
/// block geometry and the prop defaults), the pure <see cref="PageSkeletonProjection"/> adapter (the four
/// building blocks, their configurable parameters, the wrapping stat grid, the reduced-motion branch and the
/// accessible-name / automation-id contract), the <see cref="PageSkeletonViewModel"/> state holder (initial
/// projection, runtime block/parameter push, runtime motion toggle, subscription cleanup) and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/components/feedback/PageSkeleton.tsx). The WinUI view
/// (shared-surfaces/PageSkeleton.cs) is exercised by the app build. Because the component reads no network data,
/// there is no loading / error / stale / offline state — the skeleton is itself the loading state; the reproduced
/// render branches are the four building blocks (PageHeaderSkeleton, StatGridSkeleton, ChartBlockSkeleton,
/// TableSkeleton), their parameters and the full-motion vs reduced-motion shimmer.
/// </summary>
public sealed class PageSkeletonTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("PageSkeleton", PageSkeletonRegistration.Slug);

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        // web role="status" aria-busy="true": a polite status live region.
        Assert.Equal("status", PageSkeletonRegistration.StatusRole);
        Assert.Equal("polite", PageSkeletonRegistration.LiveSetting);
    }

    [Theory]
    [InlineData(PageSkeletonBlock.PageHeader, "page-header-skeleton")]
    [InlineData(PageSkeletonBlock.StatGrid, "stat-grid-skeleton")]
    [InlineData(PageSkeletonBlock.ChartBlock, "chart-block-skeleton")]
    [InlineData(PageSkeletonBlock.Table, "table-skeleton")]
    public void Automation_ids_match_the_web_data_testids(PageSkeletonBlock block, string id) =>
        Assert.Equal(id, PageSkeletonRegistration.AutomationIdFor(block));

    [Theory]
    [InlineData(PageSkeletonBlock.PageHeader, "translation.skeleton.pageHeader", "Loading page header")]
    [InlineData(PageSkeletonBlock.StatGrid, "translation.skeleton.statCards", "Loading stat cards")]
    [InlineData(PageSkeletonBlock.ChartBlock, "translation.skeleton.chart", "Loading chart")]
    [InlineData(PageSkeletonBlock.Table, "translation.skeleton.table", "Loading table")]
    public void Label_keys_and_fallbacks_match_the_web_aria_labels(PageSkeletonBlock block, string key, string fallback)
    {
        Assert.Equal(key, PageSkeletonRegistration.LabelKeyFor(block));
        Assert.Equal(fallback, PageSkeletonRegistration.LabelFallbackFor(block));
        Assert.Equal(fallback, PageSkeletonRegistration.ResolveLabel(block, Localizer));
    }

    [Fact]
    public void Resolve_label_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(
            () => PageSkeletonRegistration.ResolveLabel(PageSkeletonBlock.PageHeader, localizer: null!));

    [Fact]
    public void Block_geometry_matches_the_web_tailwind_classes()
    {
        // Tailwind: 4px per spacing unit, rem = 16px.
        Assert.Equal(32, PageSkeletonRegistration.HeaderTitleHeight);   // h-8
        Assert.Equal(256, PageSkeletonRegistration.HeaderTitleWidth);   // w-64
        Assert.Equal(16, PageSkeletonRegistration.HeaderSubtitleHeight); // h-4
        Assert.Equal(384, PageSkeletonRegistration.HeaderSubtitleWidth); // w-96
        Assert.Equal(8, PageSkeletonRegistration.HeaderGap);             // space-y-2
        Assert.Equal(6, PageSkeletonRegistration.LineRadius);            // rounded
        Assert.Equal(96, PageSkeletonRegistration.StatCardHeight);      // h-24
        Assert.Equal(12, PageSkeletonRegistration.StatCardRadius);      // rounded-xl
        Assert.Equal(16, PageSkeletonRegistration.StatGridGap);         // gap-4
        Assert.Equal(12, PageSkeletonRegistration.ChartRadius);         // rounded-xl
        Assert.Equal(40, PageSkeletonRegistration.TableHeaderHeight);   // h-10
        Assert.Equal(12, PageSkeletonRegistration.TableHeaderRadius);   // rounded-t-xl
        Assert.Equal(32, PageSkeletonRegistration.TableCellHeight);     // h-8
        Assert.Equal(6, PageSkeletonRegistration.TableCellRadius);      // rounded
        Assert.Equal(8, PageSkeletonRegistration.TableRowGap);          // space-y-2
        Assert.Equal(12, PageSkeletonRegistration.TableColumnGap);      // gap-3
    }

    [Fact]
    public void Prop_defaults_match_the_web_source()
    {
        Assert.Equal(4, PageSkeletonRegistration.DefaultCards);
        Assert.Equal(320, PageSkeletonRegistration.DefaultChartHeight);
        Assert.Equal(8, PageSkeletonRegistration.DefaultRows);
        Assert.Equal(4, PageSkeletonRegistration.DefaultColumns);
        Assert.Equal(4, PageSkeletonRegistration.StatGridColumns);
    }

    // ── parameters (web props) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Parameters_default_matches_the_web_prop_defaults()
    {
        PageSkeletonParameters defaults = PageSkeletonParameters.Default;

        Assert.Equal(4, defaults.Cards);
        Assert.Equal(320, defaults.ChartHeight);
        Assert.Equal(8, defaults.TableRows);
        Assert.Equal(4, defaults.TableColumns);
    }

    [Fact]
    public void Parameters_clamp_nonsensical_inputs()
    {
        var parameters = new PageSkeletonParameters(Cards: -3, ChartHeight: -50, TableRows: -1, TableColumns: 0);

        Assert.Equal(0, parameters.NormalizedCards);
        Assert.Equal(1, parameters.NormalizedChartHeight);
        Assert.Equal(0, parameters.NormalizedTableRows);
        Assert.Equal(1, parameters.NormalizedTableColumns);
    }

    [Fact]
    public void Parameters_value_equality_makes_identical_sets_equal()
    {
        var a = new PageSkeletonParameters(6, 280, 5, 3);
        var b = new PageSkeletonParameters(6, 280, 5, 3);
        var different = new PageSkeletonParameters(6, 280, 5, 4);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    // ── projection: page header (web PageHeaderSkeleton) ──────────────────────────────────────────────────

    [Fact]
    public void Page_header_projection_is_a_title_over_a_wider_subtitle()
    {
        PageSkeletonProjection projection = Project(PageSkeletonBlock.PageHeader);

        Assert.Equal(PageSkeletonBlock.PageHeader, projection.Block);
        Assert.Equal("page-header-skeleton", projection.AutomationId);
        Assert.Equal("Loading page header", projection.AccessibleName);
        Assert.Equal(8, projection.RowGap);

        Assert.Equal(2, projection.Rows.Count);
        SkeletonRow title = projection.Rows[0];
        SkeletonRow subtitle = projection.Rows[1];

        Assert.Equal(1, title.Columns);
        Assert.Equal(SkeletonCell.Fixed(32, 256, 6), Assert.Single(title.Cells));
        Assert.Equal(1, subtitle.Columns);
        Assert.Equal(SkeletonCell.Fixed(16, 384, 6), Assert.Single(subtitle.Cells));
    }

    // ── projection: stat grid (web StatGridSkeleton) ──────────────────────────────────────────────────────

    [Fact]
    public void Stat_grid_projection_defaults_to_one_row_of_four_cards()
    {
        PageSkeletonProjection projection = Project(PageSkeletonBlock.StatGrid);

        Assert.Equal("stat-grid-skeleton", projection.AutomationId);
        Assert.Equal("Loading stat cards", projection.AccessibleName);
        Assert.Equal(16, projection.RowGap);

        SkeletonRow row = Assert.Single(projection.Rows);
        Assert.Equal(4, row.Columns);
        Assert.Equal(16, row.ColumnGap);
        Assert.Equal(4, row.Cells.Count);
        Assert.All(row.Cells, cell =>
        {
            Assert.True(cell.Stretches);
            Assert.Equal(96, cell.Height);
            Assert.Equal(12, cell.Radius);
        });
    }

    [Fact]
    public void Stat_grid_wraps_into_full_width_rows_when_cards_exceed_the_column_count()
    {
        PageSkeletonProjection projection = Project(
            PageSkeletonBlock.StatGrid,
            PageSkeletonParameters.Default with { Cards = 6 });

        Assert.Equal(2, projection.Rows.Count);
        Assert.Equal(4, projection.Rows[0].Cells.Count);
        Assert.Equal(2, projection.Rows[1].Cells.Count);

        // Both rows keep four column tracks so the partial last row's cards stay the same width as full rows.
        Assert.Equal(4, projection.Rows[0].Columns);
        Assert.Equal(4, projection.Rows[1].Columns);
    }

    [Fact]
    public void Stat_grid_with_zero_cards_renders_no_rows_but_keeps_its_label()
    {
        PageSkeletonProjection projection = Project(
            PageSkeletonBlock.StatGrid,
            PageSkeletonParameters.Default with { Cards = 0 });

        Assert.Empty(projection.Rows);
        Assert.Equal("Loading stat cards", projection.AccessibleName);
    }

    // ── projection: chart block (web ChartBlockSkeleton) ──────────────────────────────────────────────────

    [Fact]
    public void Chart_block_projection_is_a_single_full_width_box_at_the_default_height()
    {
        PageSkeletonProjection projection = Project(PageSkeletonBlock.ChartBlock);

        Assert.Equal("chart-block-skeleton", projection.AutomationId);
        Assert.Equal("Loading chart", projection.AccessibleName);
        Assert.Equal(0, projection.RowGap);

        SkeletonRow row = Assert.Single(projection.Rows);
        Assert.Equal(1, row.Columns);
        SkeletonCell cell = Assert.Single(row.Cells);
        Assert.True(cell.Stretches);
        Assert.Equal(320, cell.Height);
        Assert.Equal(12, cell.Radius);
    }

    [Fact]
    public void Chart_block_honours_a_custom_height()
    {
        PageSkeletonProjection projection = Project(
            PageSkeletonBlock.ChartBlock,
            PageSkeletonParameters.Default with { ChartHeight = 480 });

        SkeletonCell cell = Assert.Single(Assert.Single(projection.Rows).Cells);
        Assert.Equal(480, cell.Height);
    }

    // ── projection: table (web TableSkeleton) ─────────────────────────────────────────────────────────────

    [Fact]
    public void Table_projection_defaults_to_a_header_over_eight_rows_of_four_cells()
    {
        PageSkeletonProjection projection = Project(PageSkeletonBlock.Table);

        Assert.Equal("table-skeleton", projection.AutomationId);
        Assert.Equal("Loading table", projection.AccessibleName);
        Assert.Equal(8, projection.RowGap);

        // 1 header row + 8 body rows.
        Assert.Equal(9, projection.Rows.Count);

        SkeletonRow header = projection.Rows[0];
        Assert.Equal(1, header.Columns);
        SkeletonCell headerCell = Assert.Single(header.Cells);
        Assert.True(headerCell.Stretches);
        Assert.Equal(40, headerCell.Height);
        Assert.Equal(12, headerCell.Radius);

        foreach (SkeletonRow body in projection.Rows.Skip(1))
        {
            Assert.Equal(4, body.Columns);
            Assert.Equal(12, body.ColumnGap);
            Assert.Equal(4, body.Cells.Count);
            Assert.All(body.Cells, cell =>
            {
                Assert.True(cell.Stretches);
                Assert.Equal(32, cell.Height);
                Assert.Equal(6, cell.Radius);
            });
        }
    }

    [Fact]
    public void Table_honours_custom_row_and_column_counts()
    {
        PageSkeletonProjection projection = Project(
            PageSkeletonBlock.Table,
            PageSkeletonParameters.Default with { TableRows = 3, TableColumns = 2 });

        // 1 header + 3 body rows.
        Assert.Equal(4, projection.Rows.Count);
        foreach (SkeletonRow body in projection.Rows.Skip(1))
        {
            Assert.Equal(2, body.Columns);
            Assert.Equal(2, body.Cells.Count);
        }
    }

    [Fact]
    public void Table_with_zero_rows_keeps_just_the_header()
    {
        PageSkeletonProjection projection = Project(
            PageSkeletonBlock.Table,
            PageSkeletonParameters.Default with { TableRows = 0 });

        SkeletonRow header = Assert.Single(projection.Rows);
        Assert.Equal(40, Assert.Single(header.Cells).Height);
    }

    // ── projection: reduced motion + accessibility invariants ─────────────────────────────────────────────

    [Theory]
    [InlineData(PageSkeletonBlock.PageHeader)]
    [InlineData(PageSkeletonBlock.StatGrid)]
    [InlineData(PageSkeletonBlock.ChartBlock)]
    [InlineData(PageSkeletonBlock.Table)]
    public void Projection_animates_under_full_motion_and_not_under_reduced(PageSkeletonBlock block)
    {
        Assert.True(Project(block, reduceMotion: false).Animate);
        Assert.False(Project(block, reduceMotion: true).Animate);
    }

    [Theory]
    [InlineData(PageSkeletonBlock.PageHeader)]
    [InlineData(PageSkeletonBlock.StatGrid)]
    [InlineData(PageSkeletonBlock.ChartBlock)]
    [InlineData(PageSkeletonBlock.Table)]
    public void Reduced_motion_keeps_the_same_structure(PageSkeletonBlock block)
    {
        PageSkeletonProjection full = Project(block, reduceMotion: false);
        PageSkeletonProjection reduced = Project(block, reduceMotion: true);

        // Reduced motion only suppresses the pulse; the shaped structure is identical.
        Assert.Equal(full.Rows.Count, reduced.Rows.Count);
        for (var r = 0; r < full.Rows.Count; r++)
        {
            Assert.Equal(full.Rows[r].Cells.Count, reduced.Rows[r].Cells.Count);
            Assert.Equal(full.Rows[r].Columns, reduced.Rows[r].Columns);
        }
    }

    [Theory]
    [InlineData(PageSkeletonBlock.PageHeader)]
    [InlineData(PageSkeletonBlock.StatGrid)]
    [InlineData(PageSkeletonBlock.ChartBlock)]
    [InlineData(PageSkeletonBlock.Table)]
    public void Accessible_name_is_never_empty(PageSkeletonBlock block) =>
        Assert.False(string.IsNullOrWhiteSpace(Project(block).AccessibleName));

    [Fact]
    public void Projection_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(
            () => PageSkeletonProjection.Project(
                PageSkeletonBlock.PageHeader, PageSkeletonParameters.Default, reduceMotion: false, localizer: null!));

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("PageSkeleton", PageSkeletonViewModel.Slug);

    [Fact]
    public void ViewModel_default_ctor_uses_the_page_header_block_and_prop_defaults()
    {
        using var viewModel = new PageSkeletonViewModel(Localizer, StaticMotionPreferenceSource.FullMotion);

        Assert.Equal(PageSkeletonBlock.PageHeader, viewModel.Block);
        Assert.Equal(PageSkeletonParameters.Default, viewModel.Parameters);
        Assert.Equal("Loading page header", viewModel.AccessibleName);
        Assert.Equal("page-header-skeleton", viewModel.AutomationId);
        Assert.True(viewModel.Animate);
        Assert.Equal(2, viewModel.Rows.Count);
    }

    [Fact]
    public void ViewModel_starts_reduced_when_the_motion_source_reports_reduced()
    {
        using var viewModel = new PageSkeletonViewModel(
            PageSkeletonBlock.StatGrid, Localizer, StaticMotionPreferenceSource.Reduced);

        Assert.False(viewModel.Animate);
    }

    [Fact]
    public void ViewModel_set_block_switches_the_rendered_block_and_raises_changes()
    {
        using var viewModel = new PageSkeletonViewModel(
            PageSkeletonBlock.PageHeader, Localizer, StaticMotionPreferenceSource.FullMotion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetBlock(PageSkeletonBlock.ChartBlock);

        Assert.Equal(PageSkeletonBlock.ChartBlock, viewModel.Block);
        Assert.Equal("Loading chart", viewModel.AccessibleName);
        Assert.Contains(nameof(PageSkeletonViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_set_block_is_a_no_op_for_an_unchanged_block()
    {
        using var viewModel = new PageSkeletonViewModel(
            PageSkeletonBlock.Table, Localizer, StaticMotionPreferenceSource.FullMotion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetBlock(PageSkeletonBlock.Table);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_set_parameters_reprojects_and_raises()
    {
        using var viewModel = new PageSkeletonViewModel(
            PageSkeletonBlock.StatGrid, Localizer, StaticMotionPreferenceSource.FullMotion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.SetParameters(PageSkeletonParameters.Default with { Cards = 8 });

        Assert.Equal(2, viewModel.Rows.Count); // 8 cards over 4 columns => 2 rows
        Assert.Contains(nameof(PageSkeletonViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_set_parameters_is_a_no_op_for_an_unchanged_set()
    {
        using var viewModel = new PageSkeletonViewModel(
            PageSkeletonBlock.StatGrid, Localizer, StaticMotionPreferenceSource.FullMotion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.SetParameters(PageSkeletonParameters.Default);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_reacts_to_a_runtime_reduce_motion_change()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new PageSkeletonViewModel(PageSkeletonBlock.ChartBlock, Localizer, motion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        motion.Set(reduceMotion: true);

        Assert.False(viewModel.Animate);
        Assert.Contains(nameof(PageSkeletonViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_does_not_raise_when_a_motion_change_is_a_no_op()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new PageSkeletonViewModel(PageSkeletonBlock.ChartBlock, Localizer, motion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        motion.Set(reduceMotion: false);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_motion_source()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var viewModel = new PageSkeletonViewModel(PageSkeletonBlock.ChartBlock, Localizer, motion);
        Assert.Equal(1, motion.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, motion.ObserverCount);

        // After dispose a late change must not move the projection.
        motion.Set(reduceMotion: true);
        Assert.True(viewModel.Animate);
    }

    [Fact]
    public void ViewModel_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(
            () => new PageSkeletonViewModel(
                PageSkeletonBlock.PageHeader, localizer: null!, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(
            () => new PageSkeletonViewModel(PageSkeletonBlock.PageHeader, Localizer, motion: null!));
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new PageSkeletonDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PageSkeleton", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new PageSkeletonDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new PageSkeletonDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(PageSkeletonRegistration.Slug, line, StringComparison.Ordinal);
    }

    private static PageSkeletonProjection Project(PageSkeletonBlock block, bool reduceMotion = false) =>
        PageSkeletonProjection.Project(block, PageSkeletonParameters.Default, reduceMotion, Localizer);

    private static PageSkeletonProjection Project(PageSkeletonBlock block, PageSkeletonParameters parameters) =>
        PageSkeletonProjection.Project(block, parameters, reduceMotion: false, Localizer);

    private sealed class FakeMotionSource : IMotionPreferenceSource
    {
        private readonly List<Action<bool>> _observers = new();
        private bool _reduceMotion;

        public FakeMotionSource(bool reduceMotion) => _reduceMotion = reduceMotion;

        public bool ReduceMotion => _reduceMotion;

        public int ObserverCount => _observers.Count;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            _observers.Add(onChanged);
            return new Subscription(this, onChanged);
        }

        public void Set(bool reduceMotion)
        {
            _reduceMotion = reduceMotion;
            foreach (var observer in _observers.ToArray())
            {
                observer(reduceMotion);
            }
        }

        private sealed class Subscription : IDisposable
        {
            private readonly FakeMotionSource _owner;
            private readonly Action<bool> _observer;
            private bool _disposed;

            public Subscription(FakeMotionSource owner, Action<bool> observer)
            {
                _owner = owner;
                _observer = observer;
            }

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                _owner._observers.Remove(_observer);
            }
        }
    }
}
