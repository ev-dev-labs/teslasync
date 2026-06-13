using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>TourOverlay</c> shared surface's UI-thread-free logic — the registration metadata
/// (slug, the overlay / dialog / control automation ids, the Segoe Fluent close / back / next glyphs, the six i18n
/// keys + their English fallbacks, the spotlight / tooltip layout constants), the pure spotlight + tooltip geometry
/// (the native port of the web <c>spotlight</c> object and <c>getTooltipPosition</c>), the step-counter, navigation
/// and progress-dot logic, the dialog-label token substitution, the <see cref="TourOverlayProjection"/> across every
/// state (inactive when there is no tour or the target is not measured, active otherwise; every placement; the
/// first / middle / last step; the back-shown and arrow-shown branches), the <see cref="TourOverlayViewModel"/>
/// state holder (initial projection, reprojection on a source change, viewport clamping, the next / back / skip
/// requests gated on an active tour, subscription cleanup), the <see cref="StaticTourOverlaySource"/> seam, and the
/// PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/feedback/TourOverlay.tsx). The WinUI
/// view itself (shared-surfaces/TourOverlay.cs) is exercised by the app build.
/// </summary>
public sealed class TourOverlayTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static readonly TourViewport Viewport = new(1000, 800);

    private static TourTargetRect Target() => new(200, 300, 100, 50);

    private static TourSnapshot ActiveSnapshot(
        TourPlacement placement = TourPlacement.Bottom,
        int currentStep = 1,
        int totalSteps = 5) =>
        TourSnapshot.Create(
            TourStepModel.Create("Title", "Description", placement),
            Target(),
            currentStep,
            totalSteps);

    private static TourOverlayProjection Project(TourSnapshot? snapshot, TourViewport? viewport = null) =>
        TourOverlayProjection.Project(snapshot, viewport ?? Viewport, Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("TourOverlay", TourOverlayRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("tour-overlay", TourOverlayRegistration.OverlayAutomationId);
        Assert.Equal("tour-overlay-dialog", TourOverlayRegistration.DialogAutomationId);
        Assert.Equal("tour-overlay-close", TourOverlayRegistration.CloseAutomationId);
        Assert.Equal("tour-overlay-skip", TourOverlayRegistration.SkipAutomationId);
        Assert.Equal("tour-overlay-back", TourOverlayRegistration.BackAutomationId);
        Assert.Equal("tour-overlay-next", TourOverlayRegistration.NextAutomationId);
    }

    [Fact]
    public void Glyphs_are_the_segoe_fluent_stand_ins_for_the_lucide_icons()
    {
        Assert.Equal("\uE711", TourOverlayRegistration.CloseGlyph); // ChromeClose (Lucide X)
        Assert.Equal("\uE72B", TourOverlayRegistration.BackGlyph);  // Back (Lucide ArrowLeft)
        Assert.Equal("\uE72A", TourOverlayRegistration.NextGlyph);  // Forward (Lucide ArrowRight)
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_source_verbatim()
    {
        Assert.Equal("translation.tour.dialogLabel", TourOverlayRegistration.DialogLabelKey);
        Assert.Equal("Tour step {{current}} of {{total}}", TourOverlayRegistration.DialogLabelFallback);
        Assert.Equal("translation.tour.close", TourOverlayRegistration.CloseKey);
        Assert.Equal("Close tour", TourOverlayRegistration.CloseFallback);
        Assert.Equal("translation.tour.skip", TourOverlayRegistration.SkipKey);
        Assert.Equal("Skip tour", TourOverlayRegistration.SkipFallback);
        Assert.Equal("translation.tour.prev", TourOverlayRegistration.PrevKey);
        Assert.Equal("Back", TourOverlayRegistration.PrevFallback);
        Assert.Equal("translation.tour.next", TourOverlayRegistration.NextKey);
        Assert.Equal("Next", TourOverlayRegistration.NextFallback);
        Assert.Equal("translation.tour.finish", TourOverlayRegistration.FinishKey);
        Assert.Equal("Get Started!", TourOverlayRegistration.FinishFallback);
    }

    [Fact]
    public void Layout_constants_match_the_web_values()
    {
        Assert.Equal(6, TourOverlayRegistration.SpotlightPadding);
        Assert.Equal(16, TourOverlayRegistration.TooltipGap);
        Assert.Equal(16, TourOverlayRegistration.ViewportPad);
        Assert.Equal(72, TourOverlayRegistration.BottomNavReserve);
        Assert.Equal(360, TourOverlayRegistration.TooltipMaxWidthCap);
        Assert.Equal(160, TourOverlayRegistration.ClampBottomReserve);
    }

    // ── placements ────────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("top", TourPlacement.Top)]
    [InlineData("bottom", TourPlacement.Bottom)]
    [InlineData("left", TourPlacement.Left)]
    [InlineData("right", TourPlacement.Right)]
    [InlineData("unrecognised", TourPlacement.Bottom)]
    [InlineData(null, TourPlacement.Bottom)]
    public void Placement_parse_defaults_unknown_to_bottom(string? wire, TourPlacement expected) =>
        Assert.Equal(expected, TourPlacements.Parse(wire));

    [Theory]
    [InlineData(TourPlacement.Top, "top")]
    [InlineData(TourPlacement.Bottom, "bottom")]
    [InlineData(TourPlacement.Left, "left")]
    [InlineData(TourPlacement.Right, "right")]
    public void Placement_wire_round_trips(TourPlacement placement, string wire)
    {
        Assert.Equal(wire, TourPlacements.Wire(placement));
        Assert.Equal(placement, TourPlacements.Parse(wire));
    }

    // ── spotlight geometry (web L29-34) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Spotlight_inflates_the_target_by_the_padding_on_every_side()
    {
        SpotlightRect spot = TourOverlayRegistration.Spotlight(Target());

        Assert.Equal(194, spot.Left);   // 200 - 6
        Assert.Equal(294, spot.Top);    // 300 - 6
        Assert.Equal(112, spot.Width);  // 100 + 12
        Assert.Equal(62, spot.Height);  // 50 + 12
        Assert.Equal(306, spot.Right);  // 194 + 112
        Assert.Equal(356, spot.Bottom); // 294 + 62
    }

    // ── tooltip geometry (web getTooltipPosition L163-191) ────────────────────────────────────────────────

    [Fact]
    public void Tooltip_max_width_caps_at_360_then_tracks_the_viewport()
    {
        Assert.Equal(360, TourOverlayRegistration.MaxTooltipWidth(new TourViewport(1000, 800)));
        Assert.Equal(268, TourOverlayRegistration.MaxTooltipWidth(new TourViewport(300, 800))); // 300 - 32, below the cap
    }

    [Theory]
    [InlineData(700, 624)] // clamps down to vw - maxW - pad = 1000 - 360 - 16
    [InlineData(-50, 16)]  // clamps up to pad
    [InlineData(200, 200)] // within range
    public void Clamp_left_keeps_the_tooltip_within_the_horizontal_padding(double x, double expected) =>
        Assert.Equal(expected, TourOverlayRegistration.ClampLeft(x, Viewport, 360));

    [Theory]
    [InlineData(700, 568)] // clamps down to vh - bottomNav - 160 = 800 - 72 - 160
    [InlineData(-10, 16)]  // clamps up to pad
    [InlineData(300, 300)] // within range
    public void Clamp_top_keeps_the_tooltip_above_the_bottom_reserve(double y, double expected) =>
        Assert.Equal(expected, TourOverlayRegistration.ClampTop(y, Viewport));

    [Fact]
    public void Tooltip_bottom_placement_anchors_top_left()
    {
        TooltipPlacementResult t = TourOverlayRegistration.Tooltip(TourPlacement.Bottom, Target(), Viewport);

        Assert.Equal(TourPlacement.Bottom, t.Placement);
        Assert.Equal(366, t.Top);  // clampTop(bottom 350 + gap 16)
        Assert.Equal(200, t.Left); // clampLeft(left 200)
        Assert.Null(t.Bottom);
        Assert.Null(t.Right);
        Assert.Equal(360, t.MaxWidth);
    }

    [Fact]
    public void Tooltip_top_placement_anchors_bottom_left()
    {
        TooltipPlacementResult t = TourOverlayRegistration.Tooltip(TourPlacement.Top, Target(), Viewport);

        Assert.Null(t.Top);
        Assert.Equal(516, t.Bottom); // max(88, vh 800 - top 300 + gap 16)
        Assert.Equal(200, t.Left);
        Assert.Null(t.Right);
    }

    [Fact]
    public void Tooltip_right_placement_anchors_top_left_past_the_target()
    {
        TooltipPlacementResult t = TourOverlayRegistration.Tooltip(TourPlacement.Right, Target(), Viewport);

        Assert.Equal(300, t.Top);  // clampTop(top 300)
        Assert.Equal(316, t.Left); // clampLeft(right 300 + gap 16)
        Assert.Null(t.Bottom);
        Assert.Null(t.Right);
    }

    [Fact]
    public void Tooltip_left_placement_anchors_top_right()
    {
        TooltipPlacementResult t = TourOverlayRegistration.Tooltip(TourPlacement.Left, Target(), Viewport);

        Assert.Equal(300, t.Top);  // clampTop(top 300)
        Assert.Equal(816, t.Right); // max(pad, vw 1000 - left 200 + gap 16)
        Assert.Null(t.Bottom);
        Assert.Null(t.Left);
    }

    [Fact]
    public void Tooltip_resolve_converts_edge_anchors_to_absolute_canvas_offsets()
    {
        TooltipPlacementResult bottom = TourOverlayRegistration.Tooltip(TourPlacement.Bottom, Target(), Viewport);
        Assert.Equal(200, bottom.ResolveLeft(360, Viewport)); // left set → 200
        Assert.Equal(366, bottom.ResolveTop(200, Viewport));  // top set → 366

        TooltipPlacementResult top = TourOverlayRegistration.Tooltip(TourPlacement.Top, Target(), Viewport);
        Assert.Equal(84, top.ResolveTop(200, Viewport));      // vh 800 - bottom 516 - height 200

        TooltipPlacementResult left = TourOverlayRegistration.Tooltip(TourPlacement.Left, Target(), Viewport);
        Assert.Equal(-176, left.ResolveLeft(360, Viewport));  // vw 1000 - right 816 - width 360
    }

    // ── step counter / navigation logic ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Step_counter_text_is_one_based()
    {
        Assert.Equal("1 / 5", TourOverlayRegistration.StepCounterText(0, 5));
        Assert.Equal("5 / 5", TourOverlayRegistration.StepCounterText(4, 5));
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(4, true)]
    public void Show_back_follows_currentStep_gt_0(int current, bool expected) =>
        Assert.Equal(expected, TourOverlayRegistration.ShowBack(current));

    [Theory]
    [InlineData(0, 5, true)]
    [InlineData(3, 5, true)]
    [InlineData(4, 5, false)]
    [InlineData(0, 1, false)]
    public void Show_next_arrow_follows_currentStep_lt_last(int current, int total, bool expected) =>
        Assert.Equal(expected, TourOverlayRegistration.ShowNextArrow(current, total));

    [Theory]
    [InlineData(0, 5, false)]
    [InlineData(4, 5, true)]
    [InlineData(0, 1, true)]
    public void Is_last_step_follows_currentStep_eq_total_minus_one(int current, int total, bool expected) =>
        Assert.Equal(expected, TourOverlayRegistration.IsLastStep(current, total));

    [Fact]
    public void Progress_dots_mark_only_the_current_step_active()
    {
        IReadOnlyList<TourProgressDot> dots = TourOverlayRegistration.ProgressDots(2, 5);

        Assert.Equal(5, dots.Count);
        for (int i = 0; i < dots.Count; i++)
        {
            Assert.Equal(i, dots[i].Index);
            Assert.Equal(i == 2, dots[i].IsActive);
        }
    }

    // ── i18n label resolution ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Dialog_label_substitutes_the_one_based_counts_into_the_tokens()
    {
        Assert.Equal("Tour step 1 of 5", TourOverlayRegistration.ResolveDialogLabel(Localizer, 0, 5));
        Assert.Equal("Tour step 5 of 5", TourOverlayRegistration.ResolveDialogLabel(Localizer, 4, 5));
    }

    [Fact]
    public void Static_labels_resolve_through_the_facade()
    {
        Assert.Equal("Close tour", TourOverlayRegistration.ResolveCloseLabel(Localizer));
        Assert.Equal("Skip tour", TourOverlayRegistration.ResolveSkipLabel(Localizer));
        Assert.Equal("Back", TourOverlayRegistration.ResolveBackLabel(Localizer));
    }

    [Fact]
    public void Next_label_switches_to_finish_on_the_last_step()
    {
        Assert.Equal("Next", TourOverlayRegistration.ResolveNextLabel(Localizer, 0, 5));
        Assert.Equal("Next", TourOverlayRegistration.ResolveNextLabel(Localizer, 3, 5));
        Assert.Equal("Get Started!", TourOverlayRegistration.ResolveNextLabel(Localizer, 4, 5));
    }

    // ── projection: inactive (the empty / unmeasured state, web `return null`) ────────────────────────────

    [Fact]
    public void Projection_is_inactive_when_there_is_no_snapshot()
    {
        TourOverlayProjection p = Project(snapshot: null);

        Assert.False(p.IsActive);
        Assert.Equal(string.Empty, p.Title);
        Assert.Equal(string.Empty, p.Description);
        Assert.Equal(string.Empty, p.DialogLabel);
        Assert.Empty(p.ProgressDots);
        // labels are still resolved so they are ready the instant a tour starts.
        Assert.Equal("Close tour", p.CloseLabel);
        Assert.Equal("Skip tour", p.SkipLabel);
        Assert.Equal("Back", p.BackLabel);
    }

    [Fact]
    public void Projection_is_inactive_when_the_target_is_not_yet_measured()
    {
        TourSnapshot snapshot = TourSnapshot.Create(
            TourStepModel.Create("Title", "Description"),
            targetRect: null,
            currentStep: 0,
            totalSteps: 3);

        Assert.False(Project(snapshot).IsActive);
    }

    // ── projection: active (web L25-160) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_active_and_carries_the_step_content()
    {
        TourOverlayProjection p = Project(ActiveSnapshot(currentStep: 1, totalSteps: 5));

        Assert.True(p.IsActive);
        Assert.Equal("Title", p.Title);
        Assert.Equal("Description", p.Description);
        Assert.Equal("2 / 5", p.StepCounterText);
        Assert.Equal("Tour step 2 of 5", p.DialogLabel);
        Assert.Equal(1, p.CurrentStep);
        Assert.Equal(5, p.TotalSteps);
    }

    [Fact]
    public void Projection_active_carries_the_spotlight_and_tooltip_geometry()
    {
        TourOverlayProjection p = Project(ActiveSnapshot(TourPlacement.Bottom, currentStep: 0, totalSteps: 3));

        Assert.Equal(194, p.Spotlight.Left);
        Assert.Equal(294, p.Spotlight.Top);
        Assert.Equal(112, p.Spotlight.Width);
        Assert.Equal(62, p.Spotlight.Height);
        Assert.Equal(TourPlacement.Bottom, p.Tooltip.Placement);
        Assert.Equal(366, p.Tooltip.Top);
        Assert.Equal(200, p.Tooltip.Left);
    }

    [Fact]
    public void Projection_first_step_hides_back_and_shows_the_next_arrow()
    {
        TourOverlayProjection p = Project(ActiveSnapshot(currentStep: 0, totalSteps: 5));

        Assert.False(p.ShowBack);
        Assert.True(p.ShowNextArrow);
        Assert.False(p.IsLastStep);
        Assert.Equal("Next", p.NextLabel);
        Assert.Single(p.ProgressDots, d => d.IsActive);
        Assert.True(p.ProgressDots[0].IsActive);
    }

    [Fact]
    public void Projection_middle_step_shows_back_and_the_next_arrow()
    {
        TourOverlayProjection p = Project(ActiveSnapshot(currentStep: 2, totalSteps: 5));

        Assert.True(p.ShowBack);
        Assert.True(p.ShowNextArrow);
        Assert.False(p.IsLastStep);
        Assert.Equal("Back", p.BackLabel);
        Assert.Equal("Next", p.NextLabel);
    }

    [Fact]
    public void Projection_last_step_shows_back_hides_the_arrow_and_finishes()
    {
        TourOverlayProjection p = Project(ActiveSnapshot(currentStep: 4, totalSteps: 5));

        Assert.True(p.ShowBack);
        Assert.False(p.ShowNextArrow);
        Assert.True(p.IsLastStep);
        Assert.Equal("Get Started!", p.NextLabel);
        Assert.True(p.ProgressDots[4].IsActive);
    }

    [Theory]
    [InlineData(TourPlacement.Top)]
    [InlineData(TourPlacement.Bottom)]
    [InlineData(TourPlacement.Left)]
    [InlineData(TourPlacement.Right)]
    public void Projection_honours_every_placement(TourPlacement placement)
    {
        TourOverlayProjection p = Project(ActiveSnapshot(placement, currentStep: 1, totalSteps: 4));

        Assert.True(p.IsActive);
        Assert.Equal(placement, p.Tooltip.Placement);
        Assert.Equal(360, p.Tooltip.MaxWidth);
    }

    // ── snapshot validation ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Snapshot_create_accepts_valid_indices()
    {
        TourSnapshot first = TourSnapshot.Create(TourStepModel.Create("a", "b"), Target(), 0, 1);
        Assert.Equal(0, first.CurrentStep);
        Assert.True(first.HasTarget);

        TourSnapshot last = TourSnapshot.Create(TourStepModel.Create("a", "b"), null, 4, 5);
        Assert.False(last.HasTarget);
    }

    [Fact]
    public void Snapshot_create_rejects_out_of_range_indices()
    {
        Assert.Throws<System.ArgumentOutOfRangeException>(
            () => TourSnapshot.Create(TourStepModel.Create("a", "b"), Target(), 0, 0));
        Assert.Throws<System.ArgumentOutOfRangeException>(
            () => TourSnapshot.Create(TourStepModel.Create("a", "b"), Target(), -1, 5));
        Assert.Throws<System.ArgumentOutOfRangeException>(
            () => TourSnapshot.Create(TourStepModel.Create("a", "b"), Target(), 5, 5));
    }

    [Fact]
    public void Snapshot_and_step_create_reject_null_arguments()
    {
        Assert.Throws<System.ArgumentNullException>(() => TourSnapshot.Create(null!, Target(), 0, 1));
        Assert.Throws<System.ArgumentNullException>(() => TourStepModel.Create(null!, "b"));
        Assert.Throws<System.ArgumentNullException>(() => TourStepModel.Create("a", null!));
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_inactive_with_an_empty_source()
    {
        var source = new StaticTourOverlaySource();
        using var vm = new TourOverlayViewModel(Localizer, source);

        Assert.False(vm.IsActive);
        Assert.Null(vm.Snapshot);
    }

    [Fact]
    public void View_model_reprojects_when_the_source_starts_a_tour()
    {
        var source = new StaticTourOverlaySource();
        using var vm = new TourOverlayViewModel(Localizer, source);

        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(ActiveSnapshot(currentStep: 0, totalSteps: 3));

        Assert.True(vm.IsActive);
        Assert.Equal("Title", vm.Projection.Title);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_set_viewport_reprojects_only_on_a_real_change()
    {
        var source = new StaticTourOverlaySource(ActiveSnapshot(TourPlacement.Bottom, 0, 3));
        using var vm = new TourOverlayViewModel(Localizer, source, new TourViewport(1000, 800));

        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.SetViewport(new TourViewport(1000, 800)); // unchanged → no reproject
        Assert.Equal(0, raised);

        vm.SetViewport(new TourViewport(640, 480)); // changed → reproject
        Assert.Equal(1, raised);
        Assert.Equal(new TourViewport(640, 480), vm.Viewport);
    }

    [Fact]
    public void View_model_next_prev_skip_raise_only_when_active()
    {
        var source = new StaticTourOverlaySource();
        using var vm = new TourOverlayViewModel(Localizer, source);

        int next = 0, prev = 0, skip = 0;
        vm.NextRequested += (_, _) => next++;
        vm.PrevRequested += (_, _) => prev++;
        vm.SkipRequested += (_, _) => skip++;

        // inactive: the overlay is not shown, so its callbacks are inert (web renders no buttons).
        vm.Next();
        vm.Prev();
        vm.Skip();
        Assert.Equal(0, next + prev + skip);

        source.Set(ActiveSnapshot(currentStep: 1, totalSteps: 5));
        vm.Next();
        vm.Prev();
        vm.Skip();

        Assert.Equal(1, next);
        Assert.Equal(1, prev);
        Assert.Equal(1, skip);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new StaticTourOverlaySource();
        var vm = new TourOverlayViewModel(Localizer, source);
        vm.Dispose();

        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(ActiveSnapshot());

        Assert.Equal(0, raised);
    }

    [Fact]
    public void View_model_rejects_null_dependencies()
    {
        var source = new StaticTourOverlaySource();
        Assert.Throws<System.ArgumentNullException>(() => new TourOverlayViewModel(null!, source));
        Assert.Throws<System.ArgumentNullException>(() => new TourOverlayViewModel(Localizer, null!));
    }

    // ── source ────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_set_updates_current_and_raises_changed()
    {
        var source = new StaticTourOverlaySource();
        int raised = 0;
        source.Changed += (_, _) => raised++;

        TourSnapshot snapshot = ActiveSnapshot();
        source.Set(snapshot);

        Assert.Same(snapshot, source.Current);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Static_source_clear_collapses_and_raises_changed()
    {
        var source = new StaticTourOverlaySource(ActiveSnapshot());
        int raised = 0;
        source.Changed += (_, _) => raised++;

        source.Clear();

        Assert.Null(source.Current);
        Assert.Equal(1, raised);
    }

    // ── diagnostics (view.opened, PII-safe — never the step copy) ─────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TourOverlayDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TourOverlay", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new TourOverlayDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(
            () => TourOverlayProjection.Project(null, Viewport, null!));

    [Fact]
    public void Resolve_dialog_label_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(
            () => TourOverlayRegistration.ResolveDialogLabel(null!, 0, 1));
}
