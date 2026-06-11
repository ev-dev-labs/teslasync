using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.SystemStatus;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>StatusPageSkeleton</c> feature surface's UI-thread-free logic — the layout
/// spec that ports the web scaffold region for region, the accessible-name i18n binding and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/StatusPageSkeleton.tsx), which is a pure presentational scaffold
/// with a single render path (it IS the System Status page's loading state, so there are no empty / error /
/// stale / offline branches to exercise); the WinUI view itself is exercised by the app build.
/// </summary>
public sealed class StatusPageSkeletonTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static StatusPageSkeletonSpec Spec => StatusPageSkeletonSpec.Default;

    // ── Outer scaffold: web space-y-5 (20), max-w-3xl (768), no outer padding ────────────────────────────

    [Fact]
    public void Default_outer_layout_matches_the_web_source()
    {
        Assert.Equal(20, Spec.RegionSpacing);
        Assert.Equal(768, Spec.MaxWidth);
        Assert.Equal(0, Spec.OuterPadding);
    }

    [Fact]
    public void Default_exposes_every_region_so_no_surface_is_hidden()
    {
        // The web source has a single render path (the loading scaffold); every region is always present.
        Assert.NotNull(Spec.Hero);
        Assert.NotNull(Spec.Chips);
        Assert.NotNull(Spec.Health);
        Assert.NotNull(Spec.ActionItems);
        Assert.NotNull(Spec.Resources);
        Assert.NotNull(Spec.Accordion);
    }

    // ── Hero: 56px circle, 60% title / 40% subtitle column (space-y-2), 120x36 action (gap-4, p-5) ─────────

    [Fact]
    public void Hero_avatar_is_a_fifty_six_pixel_circle()
    {
        var avatar = Spec.Hero.Avatar;

        Assert.Equal(56, avatar.Height);
        Assert.Equal(SkeletonWidth.Fixed, avatar.WidthMode);
        Assert.Equal(56, avatar.Width);
        Assert.True(avatar.Pill);
        Assert.Equal(28, avatar.ResolveRadius());
    }

    [Fact]
    public void Hero_title_and_subtitle_are_fraction_blocks_with_the_column_gap()
    {
        Assert.Equal(24, Spec.Hero.Title.Height);
        Assert.Equal(SkeletonWidth.Fraction, Spec.Hero.Title.WidthMode);
        Assert.Equal(0.60, Spec.Hero.Title.Width);

        Assert.Equal(14, Spec.Hero.Subtitle.Height);
        Assert.Equal(SkeletonWidth.Fraction, Spec.Hero.Subtitle.WidthMode);
        Assert.Equal(0.40, Spec.Hero.Subtitle.Width);

        Assert.Equal(8, Spec.Hero.LineGap);
    }

    [Fact]
    public void Hero_action_is_a_fixed_block_with_the_panel_gap_and_padding()
    {
        var action = Spec.Hero.Action;

        Assert.Equal(36, action.Height);
        Assert.Equal(SkeletonWidth.Fixed, action.WidthMode);
        Assert.Equal(120, action.Width);
        Assert.False(action.Pill);

        Assert.Equal(16, Spec.Hero.ColumnGap);
        Assert.Equal(20, Spec.Hero.Padding);
    }

    // ── Chip bar: eight 92x32 pills, gap-2 ───────────────────────────────────────────────────────────────

    [Fact]
    public void Chip_bar_renders_eight_fixed_width_pills()
    {
        Assert.Equal(8, Spec.Chips.Count);
        Assert.Equal(8, Spec.Chips.Gap);

        var chip = Spec.Chips.Chip;
        Assert.Equal(32, chip.Height);
        Assert.Equal(SkeletonWidth.Fixed, chip.WidthMode);
        Assert.Equal(92, chip.Width);
        Assert.True(chip.Pill);
        Assert.Equal(16, chip.ResolveRadius());
    }

    // ── Health rows: title 80x18 (mb-2), six 44px rows (space-y-1), p-3 ──────────────────────────────────

    [Fact]
    public void Health_panel_has_a_fixed_title_over_six_full_width_rows()
    {
        var health = Spec.Health;

        Assert.Equal(18, health.Title.Height);
        Assert.Equal(SkeletonWidth.Fixed, health.Title.WidthMode);
        Assert.Equal(80, health.Title.Width);

        Assert.Equal(8, health.HeaderGap);
        Assert.Equal(6, health.RowCount);
        Assert.Equal(4, health.RowGap);
        Assert.Equal(12, health.Padding);

        Assert.Equal(44, health.Row.Height);
        Assert.Equal(SkeletonWidth.Stretch, health.Row.WidthMode);
    }

    // ── Action items: title 180x18, two 32px rows (space-y-2), p-4 ───────────────────────────────────────

    [Fact]
    public void Action_items_panel_has_a_fixed_title_over_two_full_width_rows()
    {
        var actions = Spec.ActionItems;

        Assert.Equal(18, actions.Title.Height);
        Assert.Equal(SkeletonWidth.Fixed, actions.Title.WidthMode);
        Assert.Equal(180, actions.Title.Width);

        Assert.Equal(8, actions.HeaderGap);
        Assert.Equal(2, actions.RowCount);
        Assert.Equal(8, actions.RowGap);
        Assert.Equal(16, actions.Padding);

        Assert.Equal(32, actions.Row.Height);
        Assert.Equal(SkeletonWidth.Stretch, actions.Row.WidthMode);
    }

    // ── Resources: title 120x18, five 28px rows (space-y-3), p-4 ─────────────────────────────────────────

    [Fact]
    public void Resources_panel_has_a_fixed_title_over_five_full_width_rows()
    {
        var resources = Spec.Resources;

        Assert.Equal(18, resources.Title.Height);
        Assert.Equal(SkeletonWidth.Fixed, resources.Title.WidthMode);
        Assert.Equal(120, resources.Title.Width);

        Assert.Equal(12, resources.HeaderGap);
        Assert.Equal(5, resources.RowCount);
        Assert.Equal(12, resources.RowGap);
        Assert.Equal(16, resources.Padding);

        Assert.Equal(28, resources.Row.Height);
        Assert.Equal(SkeletonWidth.Stretch, resources.Row.WidthMode);
    }

    // ── Accordion: four panels, 20px icon, 40% title over a 60% sub-line (mt-1), 60x24 trailing (gap-3, p-5)

    [Fact]
    public void Accordion_renders_four_panels_with_the_web_geometry()
    {
        var accordion = Spec.Accordion;

        Assert.Equal(4, accordion.Count);
        Assert.Equal(12, accordion.ColumnGap);
        Assert.Equal(20, accordion.Padding);

        Assert.Equal(20, accordion.Icon.Height);
        Assert.Equal(SkeletonWidth.Fixed, accordion.Icon.WidthMode);
        Assert.Equal(20, accordion.Icon.Width);
    }

    [Fact]
    public void Accordion_title_and_sub_line_are_fraction_blocks_with_the_top_gap()
    {
        var accordion = Spec.Accordion;

        Assert.Equal(16, accordion.Title.Height);
        Assert.Equal(SkeletonWidth.Fraction, accordion.Title.WidthMode);
        Assert.Equal(0.40, accordion.Title.Width);

        Assert.Equal(12, accordion.Subtitle.Height);
        Assert.Equal(SkeletonWidth.Fraction, accordion.Subtitle.WidthMode);
        Assert.Equal(0.60, accordion.Subtitle.Width);

        Assert.Equal(4, accordion.SubtitleGap);
    }

    [Fact]
    public void Accordion_trailing_is_a_fixed_block()
    {
        var trailing = Spec.Accordion.Trailing;

        Assert.Equal(24, trailing.Height);
        Assert.Equal(SkeletonWidth.Fixed, trailing.WidthMode);
        Assert.Equal(60, trailing.Width);
    }

    // ── SkeletonBlock factories + radius (shared primitive) ──────────────────────────────────────────────

    [Fact]
    public void Fixed_block_carries_an_absolute_width()
    {
        var block = SkeletonBlock.Fixed(36, 120);

        Assert.Equal(SkeletonWidth.Fixed, block.WidthMode);
        Assert.Equal(120, block.Width);
        Assert.False(block.Pill);
    }

    [Fact]
    public void Fraction_block_carries_a_fraction_width()
    {
        var block = SkeletonBlock.Fraction(24, 0.6);

        Assert.Equal(SkeletonWidth.Fraction, block.WidthMode);
        Assert.Equal(0.6, block.Width);
    }

    [Fact]
    public void Stretch_block_fills_its_row()
    {
        var block = SkeletonBlock.Stretch(44);

        Assert.Equal(SkeletonWidth.Stretch, block.WidthMode);
        Assert.Equal(44, block.Height);
    }

    [Fact]
    public void Pill_block_resolves_to_a_full_radius() =>
        Assert.Equal(16, SkeletonBlock.Fixed(32, 92, pill: true).ResolveRadius());

    // ── Registration + accessibility: a single localized "Loading" name ──────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("StatusPageSkeleton", StatusPageSkeletonRegistration.Slug);

    [Fact]
    public void Registration_binds_the_shared_common_loading_key()
    {
        Assert.Equal("common.loading", StatusPageSkeletonRegistration.LoadingKey);
        Assert.Equal("Loading", StatusPageSkeletonRegistration.LoadingFallback);
    }

    [Fact]
    public void Loading_label_resolves_through_the_localizer() =>
        Assert.Equal("Loading", StatusPageSkeletonRegistration.LoadingLabel(Localizer));

    [Fact]
    public void Loading_label_requests_the_shared_loading_key_from_the_facade()
    {
        var recorder = new RecordingLocalizer();

        _ = StatusPageSkeletonRegistration.LoadingLabel(recorder);

        Assert.Equal("common.loading", Assert.Single(recorder.RequestedKeys));
    }

    [Fact]
    public void Loading_label_exposes_a_non_empty_accessible_name() =>
        Assert.False(string.IsNullOrWhiteSpace(StatusPageSkeletonRegistration.LoadingLabel(Localizer)));

    [Fact]
    public void Loading_label_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => StatusPageSkeletonRegistration.LoadingLabel(null!));

    // ── Diagnostics (P1/S11): view.opened slug=StatusPageSkeleton, PII-safe ──────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new StatusPageSkeletonDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StatusPageSkeleton", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_counts_every_open()
    {
        var diagnostics = new StatusPageSkeletonDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_line_is_exactly_the_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new StatusPageSkeletonDiagnostics(captured.Add);

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
