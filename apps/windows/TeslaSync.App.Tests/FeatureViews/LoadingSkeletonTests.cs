using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LoadingSkeleton</c> feature surface's UI-thread-free logic — the layout spec
/// that ports the web scaffold row for row, the shimmer-block geometry helpers, the accessible-name i18n binding
/// and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx), which is a pure presentational
/// scaffold with a single render path; the WinUI view itself is exercised by the app build.
/// </summary>
public sealed class LoadingSkeletonTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static LoadingSkeletonSpec Spec => LoadingSkeletonSpec.Default;

    // ── Outer scaffold: web space-y-6 (24) + p-6 (24) ────────────────────────────────────────────────────

    [Fact]
    public void Default_outer_spacing_matches_the_web_source()
    {
        Assert.Equal(24, Spec.ContentSpacing);
        Assert.Equal(24, Spec.OuterPadding);
    }

    [Fact]
    public void Default_exposes_all_four_regions_so_no_surface_is_hidden()
    {
        Assert.NotNull(Spec.Header);
        Assert.NotNull(Spec.Cards);
        Assert.NotNull(Spec.Charts);
        Assert.NotNull(Spec.Table);
    }

    // ── Header: title 220x28, subtitle 340x16 (mt-2), pill action 200x36 (gap-4) ──────────────────────────

    [Fact]
    public void Header_title_matches_the_web_skeleton()
    {
        var title = Spec.Header.Title;

        Assert.Equal(28, title.Height);
        Assert.Equal(SkeletonWidth.Fixed, title.WidthMode);
        Assert.Equal(220, title.Width);
        Assert.False(title.Pill);
    }

    [Fact]
    public void Header_subtitle_matches_the_web_skeleton_with_its_top_gap()
    {
        var subtitle = Spec.Header.Subtitle;

        Assert.Equal(16, subtitle.Height);
        Assert.Equal(SkeletonWidth.Fixed, subtitle.WidthMode);
        Assert.Equal(340, subtitle.Width);
        Assert.Equal(8, Spec.Header.SubtitleGap);
    }

    [Fact]
    public void Header_action_is_a_fixed_width_pill_with_the_column_gap()
    {
        var action = Spec.Header.Action;

        Assert.Equal(36, action.Height);
        Assert.Equal(SkeletonWidth.Fixed, action.WidthMode);
        Assert.Equal(200, action.Width);
        Assert.True(action.Pill);
        Assert.Equal(16, Spec.Header.ColumnGap);
    }

    // ── Cards: six panels, 2/3/6 responsive cols, three stacked blocks (60% / 80% / 40%) ─────────────────

    [Fact]
    public void Cards_grid_renders_six_panels_in_up_to_six_columns()
    {
        Assert.Equal(6, Spec.Cards.Count);
        Assert.Equal(6, Spec.Cards.Columns);
        Assert.Equal(16, Spec.Cards.Gap);
        Assert.Equal(16, Spec.Cards.Padding);
    }

    [Fact]
    public void Card_has_three_fraction_width_lines_with_the_web_rhythm()
    {
        var lines = Spec.Cards.Lines;
        Assert.Equal(3, lines.Count);

        Assert.Equal(14, lines[0].Block.Height);
        Assert.Equal(SkeletonWidth.Fraction, lines[0].Block.WidthMode);
        Assert.Equal(0.60, lines[0].Block.Width);
        Assert.Equal(0, lines[0].TopGap);

        Assert.Equal(24, lines[1].Block.Height);
        Assert.Equal(0.80, lines[1].Block.Width);
        Assert.Equal(8, lines[1].TopGap);

        Assert.Equal(12, lines[2].Block.Height);
        Assert.Equal(0.40, lines[2].Block.Width);
        Assert.Equal(4, lines[2].TopGap);
    }

    // ── Charts: two panels, title 40% over a 200px body (mt-4) ────────────────────────────────────────────

    [Fact]
    public void Charts_row_renders_two_panels_in_two_columns()
    {
        Assert.Equal(2, Spec.Charts.Count);
        Assert.Equal(2, Spec.Charts.Columns);
        Assert.Equal(16, Spec.Charts.Gap);
        Assert.Equal(16, Spec.Charts.Padding);
    }

    [Fact]
    public void Chart_panel_has_a_fraction_title_over_a_tall_stretched_body()
    {
        Assert.Equal(16, Spec.Charts.Title.Height);
        Assert.Equal(SkeletonWidth.Fraction, Spec.Charts.Title.WidthMode);
        Assert.Equal(0.40, Spec.Charts.Title.Width);

        Assert.Equal(16, Spec.Charts.BodyGap);
        Assert.Equal(200, Spec.Charts.Body.Height);
        Assert.Equal(SkeletonWidth.Stretch, Spec.Charts.Body.WidthMode);
    }

    // ── Table: title 30% over five stretched 32px rows (space-y-2) ───────────────────────────────────────

    [Fact]
    public void Table_panel_has_a_fraction_title_over_five_stretched_rows()
    {
        Assert.Equal(16, Spec.Table.Padding);

        Assert.Equal(16, Spec.Table.Title.Height);
        Assert.Equal(SkeletonWidth.Fraction, Spec.Table.Title.WidthMode);
        Assert.Equal(0.30, Spec.Table.Title.Width);

        Assert.Equal(16, Spec.Table.HeaderGap);
        Assert.Equal(5, Spec.Table.RowCount);
        Assert.Equal(8, Spec.Table.RowGap);

        Assert.Equal(32, Spec.Table.Row.Height);
        Assert.Equal(SkeletonWidth.Stretch, Spec.Table.Row.WidthMode);
    }

    // ── SkeletonBlock factories + radius ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Fixed_block_carries_an_absolute_width()
    {
        var block = SkeletonBlock.Fixed(28, 220);

        Assert.Equal(SkeletonWidth.Fixed, block.WidthMode);
        Assert.Equal(220, block.Width);
        Assert.False(block.Pill);
    }

    [Fact]
    public void Fraction_block_carries_a_fraction_width()
    {
        var block = SkeletonBlock.Fraction(14, 0.6);

        Assert.Equal(SkeletonWidth.Fraction, block.WidthMode);
        Assert.Equal(0.6, block.Width);
    }

    [Fact]
    public void Stretch_block_fills_its_row()
    {
        var block = SkeletonBlock.Stretch(200);

        Assert.Equal(SkeletonWidth.Stretch, block.WidthMode);
        Assert.Equal(200, block.Height);
    }

    [Fact]
    public void Non_pill_block_uses_the_default_radius() =>
        Assert.Equal(SkeletonBlock.DefaultRadius, SkeletonBlock.Stretch(32).ResolveRadius());

    [Fact]
    public void Pill_block_resolves_to_a_full_radius() =>
        Assert.Equal(18, SkeletonBlock.Fixed(36, 200, pill: true).ResolveRadius());

    // ── Registration + accessibility: a single localized "Loading" name ──────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("LoadingSkeleton", LoadingSkeletonRegistration.Slug);

    [Fact]
    public void Registration_binds_the_shared_common_loading_key()
    {
        Assert.Equal("common.loading", LoadingSkeletonRegistration.LoadingKey);
        Assert.Equal("Loading", LoadingSkeletonRegistration.LoadingFallback);
    }

    [Fact]
    public void Loading_label_resolves_through_the_localizer() =>
        Assert.Equal("Loading", LoadingSkeletonRegistration.LoadingLabel(Localizer));

    [Fact]
    public void Loading_label_requests_the_shared_loading_key_from_the_facade()
    {
        var recorder = new RecordingLocalizer();

        _ = LoadingSkeletonRegistration.LoadingLabel(recorder);

        Assert.Equal("common.loading", Assert.Single(recorder.RequestedKeys));
    }

    [Fact]
    public void Loading_label_exposes_a_non_empty_accessible_name() =>
        Assert.False(string.IsNullOrWhiteSpace(LoadingSkeletonRegistration.LoadingLabel(Localizer)));

    [Fact]
    public void Loading_label_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => LoadingSkeletonRegistration.LoadingLabel(null!));

    // ── Diagnostics (P1/S11): view.opened slug=LoadingSkeleton, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LoadingSkeletonDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LoadingSkeleton", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_counts_every_open()
    {
        var diagnostics = new LoadingSkeletonDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_line_is_exactly_the_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new LoadingSkeletonDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.StartsWith("view.opened ", line, StringComparison.Ordinal);
        Assert.DoesNotContain('%', line);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }
}
