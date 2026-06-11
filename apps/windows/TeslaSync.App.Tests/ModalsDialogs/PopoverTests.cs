using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the Popover modal-dialog surface's UI-thread-free logic — the dismiss-reason wire
/// mapping, the ported positioner (<c>resolvedSide</c> auto-flip, cross-axis alignment, viewport clamp), the
/// pointer-outside hit-test, the <c>Escape</c> check and the <c>aria-label</c> resolution, the state-holder
/// view-model's per-state flows (closed / open-but-unpositioned / open-and-positioned, the Escape +
/// pointer-outside + programmatic dismissals, and the focus-restore signal that mirrors the web focus-restore
/// effect), the i18n key + fallback contract that doubles as the Narrator-label source, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/components/ui/Popover.tsx). The WinUI view itself (Popover.cs)
/// is exercised by the app build.
/// </summary>
public sealed class PopoverTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Dismiss-reason wire mapping ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(PopoverDismissReason.Escape, "escape")]
    [InlineData(PopoverDismissReason.PointerOutside, "pointer-outside")]
    [InlineData(PopoverDismissReason.Programmatic, "programmatic")]
    public void DismissReason_round_trips_through_wire(PopoverDismissReason reason, string wire)
    {
        Assert.Equal(wire, PopoverDismissReasons.ToWire(reason));
        Assert.True(PopoverDismissReasons.TryFromWire(wire, out var parsed));
        Assert.Equal(reason, parsed);
    }

    [Fact]
    public void Wire_from_unknown_token_is_false_and_defaults_to_programmatic()
    {
        Assert.False(PopoverDismissReasons.TryFromWire("nope", out var reason));
        Assert.Equal(PopoverDismissReason.Programmatic, reason);
        Assert.False(PopoverDismissReasons.TryFromWire(null, out var fromNull));
        Assert.Equal(PopoverDismissReason.Programmatic, fromNull);
    }

    // ── Geometry: PopoverRect ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Rect_derives_right_and_bottom_like_a_dom_rect()
    {
        var rect = new PopoverRect(100, 50, 30, 20);

        Assert.Equal(130, rect.Right);
        Assert.Equal(70, rect.Bottom);
    }

    [Theory]
    [InlineData(110, 60, true)]   // inside
    [InlineData(100, 50, true)]   // top-left corner (inclusive)
    [InlineData(130, 70, true)]   // bottom-right corner (inclusive)
    [InlineData(99, 60, false)]   // left of
    [InlineData(110, 71, false)]  // below
    public void Rect_contains_is_inclusive(double x, double y, bool inside) =>
        Assert.Equal(inside, new PopoverRect(100, 50, 30, 20).Contains(x, y));

    // ── Projection: side auto-flip (web resolvedSide) ────────────────────────────────────────────────────

    [Fact]
    public void ResolveSide_keeps_bottom_when_content_fits_below() =>
        Assert.Equal(PopoverSide.Bottom, PopoverProjection.ResolveSide(PopoverSide.Bottom, 100, spaceAbove: 50, spaceBelow: 200));

    [Fact]
    public void ResolveSide_flips_bottom_to_top_when_more_room_above() =>
        Assert.Equal(PopoverSide.Top, PopoverProjection.ResolveSide(PopoverSide.Bottom, 300, spaceAbove: 250, spaceBelow: 200));

    [Fact]
    public void ResolveSide_keeps_bottom_when_below_has_more_room_even_if_overflowing() =>
        Assert.Equal(PopoverSide.Bottom, PopoverProjection.ResolveSide(PopoverSide.Bottom, 300, spaceAbove: 150, spaceBelow: 200));

    [Fact]
    public void ResolveSide_flips_top_to_bottom_when_more_room_below() =>
        Assert.Equal(PopoverSide.Bottom, PopoverProjection.ResolveSide(PopoverSide.Top, 300, spaceAbove: 200, spaceBelow: 250));

    [Fact]
    public void ResolveSide_keeps_top_when_content_fits_above() =>
        Assert.Equal(PopoverSide.Top, PopoverProjection.ResolveSide(PopoverSide.Top, 100, spaceAbove: 200, spaceBelow: 50));

    // ── Projection: full placement (web compute()) ───────────────────────────────────────────────────────

    [Fact]
    public void ResolvePlacement_bottom_start_with_room_sits_below_left_aligned()
    {
        var placement = PopoverProjection.ResolvePlacement(
            new PopoverRect(100, 100, 50, 20),
            new PopoverSize(200, 80),
            new PopoverViewport(1000, 800),
            PopoverSide.Bottom,
            PopoverAlign.Start,
            sideOffset: 6,
            margin: 8);

        Assert.Equal(PopoverSide.Bottom, placement.ResolvedSide);
        Assert.Equal(126, placement.Top);  // anchor.Bottom (120) + sideOffset (6)
        Assert.Equal(100, placement.Left); // anchor.Left
    }

    [Fact]
    public void ResolvePlacement_flips_to_top_when_below_is_cramped()
    {
        var placement = PopoverProjection.ResolvePlacement(
            new PopoverRect(100, 700, 50, 20),
            new PopoverSize(200, 200),
            new PopoverViewport(1000, 800),
            PopoverSide.Bottom,
            PopoverAlign.Start,
            sideOffset: 6,
            margin: 8);

        Assert.Equal(PopoverSide.Top, placement.ResolvedSide);
        Assert.Equal(494, placement.Top); // anchor.Top (700) - sideOffset (6) - content.Height (200)
        Assert.Equal(100, placement.Left);
    }

    [Fact]
    public void ResolvePlacement_end_align_pins_right_edges()
    {
        var placement = PopoverProjection.ResolvePlacement(
            new PopoverRect(500, 100, 50, 20),
            new PopoverSize(200, 40),
            new PopoverViewport(1000, 800),
            PopoverSide.Bottom,
            PopoverAlign.End,
            sideOffset: 6,
            margin: 8);

        Assert.Equal(350, placement.Left); // anchor.Right (550) - content.Width (200)
    }

    [Fact]
    public void ResolvePlacement_center_align_centers_on_anchor_midpoint()
    {
        var placement = PopoverProjection.ResolvePlacement(
            new PopoverRect(500, 100, 50, 20),
            new PopoverSize(200, 40),
            new PopoverViewport(1000, 800),
            PopoverSide.Bottom,
            PopoverAlign.Center,
            sideOffset: 6,
            margin: 8);

        Assert.Equal(425, placement.Left); // 500 + 25 - 100
    }

    [Fact]
    public void ResolvePlacement_clamps_right_edge_into_viewport()
    {
        var placement = PopoverProjection.ResolvePlacement(
            new PopoverRect(900, 100, 50, 20),
            new PopoverSize(200, 40),
            new PopoverViewport(1000, 800),
            PopoverSide.Bottom,
            PopoverAlign.Start,
            sideOffset: 6,
            margin: 8);

        Assert.Equal(792, placement.Left); // 1000 - 200 - 8
    }

    [Fact]
    public void ResolvePlacement_clamps_left_edge_to_margin()
    {
        var placement = PopoverProjection.ResolvePlacement(
            new PopoverRect(-50, 100, 40, 20),
            new PopoverSize(100, 40),
            new PopoverViewport(1000, 800),
            PopoverSide.Bottom,
            PopoverAlign.Start,
            sideOffset: 6,
            margin: 8);

        Assert.Equal(8, placement.Left); // clamped to margin
    }

    [Fact]
    public void ResolvePlacement_clamps_vertically_to_margin_without_flipping()
    {
        // Anchor pinned to the top, content taller than the viewport: stays Bottom (above has no room) and the
        // bottom-overflow guard then the top-margin guard pin the top to the margin.
        var placement = PopoverProjection.ResolvePlacement(
            new PopoverRect(10, 10, 50, 20),
            new PopoverSize(120, 320),
            new PopoverViewport(1000, 300),
            PopoverSide.Bottom,
            PopoverAlign.Start,
            sideOffset: 6,
            margin: 8);

        Assert.Equal(PopoverSide.Bottom, placement.ResolvedSide);
        Assert.Equal(8, placement.Top);
    }

    // ── Projection: pointer-outside hit-test (web onPointerDown) ─────────────────────────────────────────

    [Fact]
    public void IsPointerOutside_is_false_inside_the_content()
    {
        var content = new PopoverRect(100, 100, 200, 80);
        var anchor = new PopoverRect(100, 60, 50, 20);

        Assert.False(PopoverProjection.IsPointerOutside(content, anchor, 150, 130));
    }

    [Fact]
    public void IsPointerOutside_is_false_inside_the_anchor()
    {
        var content = new PopoverRect(100, 100, 200, 80);
        var anchor = new PopoverRect(100, 60, 50, 20);

        Assert.False(PopoverProjection.IsPointerOutside(content, anchor, 120, 70));
    }

    [Fact]
    public void IsPointerOutside_is_true_away_from_both()
    {
        var content = new PopoverRect(100, 100, 200, 80);
        var anchor = new PopoverRect(100, 60, 50, 20);

        Assert.True(PopoverProjection.IsPointerOutside(content, anchor, 800, 700));
    }

    // ── Projection: Escape + aria-label ──────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Escape", true)]
    [InlineData("Enter", false)]
    [InlineData("escape", false)]
    [InlineData(null, false)]
    public void IsEscape_matches_only_the_escape_key(string? key, bool expected) =>
        Assert.Equal(expected, PopoverProjection.IsEscape(key));

    [Fact]
    public void ResolveAriaLabel_uses_the_consumer_label_when_present() =>
        Assert.Equal("Filters", PopoverProjection.ResolveAriaLabel("Filters", Localizer));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveAriaLabel_falls_back_to_the_region_label(string? ariaLabel) =>
        Assert.Equal("Popover", PopoverProjection.ResolveAriaLabel(ariaLabel, Localizer));

    // ── Registration constants + key ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_matches_the_web_constants()
    {
        Assert.Equal("Popover", PopoverRegistration.Slug);
        Assert.Equal(6.0, PopoverRegistration.DefaultSideOffset);
        Assert.Equal(8.0, PopoverRegistration.ViewportMargin);
        Assert.Equal(60, PopoverRegistration.ZIndex);
        Assert.Equal(-9999.0, PopoverRegistration.OffscreenCoordinate);
    }

    [Fact]
    public void RegionLabel_routes_through_the_popover_key_with_english_fallback()
    {
        var recorder = new RecordingLocalizer();

        string label = PopoverRegistration.RegionLabel(recorder);

        Assert.Equal("Popover", label);
        Assert.Equal("popover.region", Assert.Single(recorder.Keys));
    }

    // ── View-model: initial (closed) state ───────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_matches_web_defaults()
    {
        var vm = new PopoverViewModel(Localizer);

        Assert.False(vm.IsOpen);
        Assert.False(vm.IsPositioned);
        Assert.Null(vm.Placement);
        Assert.Equal(PopoverSide.Bottom, vm.Side);
        Assert.Equal(PopoverAlign.Start, vm.Align);
        Assert.Equal(6.0, vm.SideOffset);
        Assert.Equal("Popover", vm.ResolvedAriaLabel);
    }

    // ── View-model: open (web open=true) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Open_marks_open_unpositioned_emits_diagnostics_and_raises_opened()
    {
        var diag = new PopoverDiagnostics();
        var vm = new PopoverViewModel(Localizer, diag);
        int opens = 0;
        var changed = new List<string?>();
        vm.Opened += (_, _) => opens++;
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Open();

        Assert.True(vm.IsOpen);
        Assert.False(vm.IsPositioned); // hidden until measured (web pos == null)
        Assert.Equal(1, opens);
        Assert.Equal(1, diag.ViewsOpened);
        Assert.Contains(nameof(PopoverViewModel.IsOpen), changed);
    }

    [Fact]
    public void Open_is_idempotent()
    {
        var diag = new PopoverDiagnostics();
        var vm = new PopoverViewModel(Localizer, diag);
        int opens = 0;
        vm.Opened += (_, _) => opens++;

        vm.Open();
        vm.Open();

        Assert.Equal(1, opens);
        Assert.Equal(1, diag.ViewsOpened);
    }

    // ── View-model: positioned (web compute() → pos) ─────────────────────────────────────────────────────

    [Fact]
    public void UpdatePlacement_while_open_positions_the_content()
    {
        var vm = new PopoverViewModel(Localizer);
        vm.Open();

        vm.UpdatePlacement(
            new PopoverRect(100, 100, 50, 20),
            new PopoverSize(200, 80),
            new PopoverViewport(1000, 800));

        Assert.True(vm.IsPositioned);
        Assert.NotNull(vm.Placement);
        Assert.Equal(126, vm.Placement!.Value.Top);
        Assert.Equal(100, vm.Placement.Value.Left);
    }

    [Fact]
    public void UpdatePlacement_while_closed_is_a_no_op()
    {
        var vm = new PopoverViewModel(Localizer);

        vm.UpdatePlacement(
            new PopoverRect(100, 100, 50, 20),
            new PopoverSize(200, 80),
            new PopoverViewport(1000, 800));

        Assert.False(vm.IsPositioned);
        Assert.Null(vm.Placement);
    }

    [Fact]
    public void Open_clears_a_stale_placement()
    {
        var vm = new PopoverViewModel(Localizer);
        vm.Open();
        vm.UpdatePlacement(new PopoverRect(0, 0, 10, 10), new PopoverSize(20, 20), new PopoverViewport(500, 500));
        vm.Close(PopoverDismissReason.Programmatic);

        vm.Open();

        Assert.True(vm.IsOpen);
        Assert.False(vm.IsPositioned); // re-measured before showing again
        Assert.Null(vm.Placement);
    }

    // ── View-model: close (web onClose) + focus restore ──────────────────────────────────────────────────

    [Fact]
    public void Close_clears_state_restores_focus_and_records_the_reason()
    {
        var diag = new PopoverDiagnostics();
        var vm = new PopoverViewModel(Localizer, diag);
        PopoverDismissReason? closedWith = null;
        int focusRestores = 0;
        vm.CloseRequested += (_, r) => closedWith = r;
        vm.FocusRestoreRequested += (_, _) => focusRestores++;
        vm.Open();
        vm.UpdatePlacement(new PopoverRect(0, 0, 10, 10), new PopoverSize(20, 20), new PopoverViewport(500, 500));

        bool closed = vm.Close(PopoverDismissReason.Escape);

        Assert.True(closed);
        Assert.False(vm.IsOpen);
        Assert.Null(vm.Placement);
        Assert.False(vm.IsPositioned);
        Assert.Equal(PopoverDismissReason.Escape, closedWith);
        Assert.Equal(1, focusRestores); // web restores focus to the anchor on close
        Assert.Equal(1, diag.Dismissals);
    }

    [Fact]
    public void Close_while_closed_is_a_no_op()
    {
        var diag = new PopoverDiagnostics();
        var vm = new PopoverViewModel(Localizer, diag);
        int closes = 0;
        int focusRestores = 0;
        vm.CloseRequested += (_, _) => closes++;
        vm.FocusRestoreRequested += (_, _) => focusRestores++;

        bool closed = vm.Close(PopoverDismissReason.Programmatic);

        Assert.False(closed);
        Assert.Equal(0, closes);
        Assert.Equal(0, focusRestores);
        Assert.Equal(0, diag.Dismissals);
    }

    // ── View-model: Escape key (web onKeyDown) ───────────────────────────────────────────────────────────

    [Fact]
    public void HandleKey_escape_closes_with_escape_reason()
    {
        var vm = new PopoverViewModel(Localizer);
        PopoverDismissReason? reason = null;
        vm.CloseRequested += (_, r) => reason = r;
        vm.Open();

        bool handled = vm.HandleKey("Escape");

        Assert.True(handled);
        Assert.False(vm.IsOpen);
        Assert.Equal(PopoverDismissReason.Escape, reason);
    }

    [Fact]
    public void HandleKey_other_keys_keep_the_popover_open()
    {
        var vm = new PopoverViewModel(Localizer);
        vm.Open();

        Assert.False(vm.HandleKey("Enter"));
        Assert.True(vm.IsOpen);
    }

    [Fact]
    public void HandleKey_while_closed_is_a_no_op() =>
        Assert.False(new PopoverViewModel(Localizer).HandleKey("Escape"));

    // ── View-model: pointer-outside (web onPointerDown) ──────────────────────────────────────────────────

    [Fact]
    public void HandlePointerDown_outside_closes_with_pointer_reason()
    {
        var vm = new PopoverViewModel(Localizer);
        PopoverDismissReason? reason = null;
        vm.CloseRequested += (_, r) => reason = r;
        vm.Open();

        bool handled = vm.HandlePointerDown(
            new PopoverRect(100, 100, 200, 80),
            new PopoverRect(100, 60, 50, 20),
            x: 800,
            y: 700);

        Assert.True(handled);
        Assert.False(vm.IsOpen);
        Assert.Equal(PopoverDismissReason.PointerOutside, reason);
    }

    [Fact]
    public void HandlePointerDown_inside_content_or_anchor_keeps_open()
    {
        var content = new PopoverRect(100, 100, 200, 80);
        var anchor = new PopoverRect(100, 60, 50, 20);
        var vm = new PopoverViewModel(Localizer);
        vm.Open();

        Assert.False(vm.HandlePointerDown(content, anchor, 150, 130)); // inside content
        Assert.True(vm.IsOpen);
        Assert.False(vm.HandlePointerDown(content, anchor, 120, 70));  // inside anchor
        Assert.True(vm.IsOpen);
    }

    // ── View-model: configuration setters raise change ───────────────────────────────────────────────────

    [Fact]
    public void Configuration_setters_raise_property_changed()
    {
        var vm = new PopoverViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Side = PopoverSide.Top;
        vm.Align = PopoverAlign.Center;
        vm.SideOffset = 12;
        vm.AriaLabel = "Sort options";

        Assert.Contains(nameof(PopoverViewModel.Side), changed);
        Assert.Contains(nameof(PopoverViewModel.Align), changed);
        Assert.Contains(nameof(PopoverViewModel.SideOffset), changed);
        Assert.Contains(nameof(PopoverViewModel.AriaLabel), changed);
        Assert.Contains(nameof(PopoverViewModel.ResolvedAriaLabel), changed);
        Assert.Equal("Sort options", vm.ResolvedAriaLabel);
    }

    // ── Diagnostics (PII-safe, P1/S11) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Open_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var vm = new PopoverViewModel(Localizer, new PopoverDiagnostics(lines.Add));

        vm.Open();

        Assert.Equal("view.opened slug=Popover", Assert.Single(lines));
    }

    [Theory]
    [InlineData(PopoverDismissReason.Escape, "popover.dismissed slug=Popover reason=escape")]
    [InlineData(PopoverDismissReason.PointerOutside, "popover.dismissed slug=Popover reason=pointer-outside")]
    [InlineData(PopoverDismissReason.Programmatic, "popover.dismissed slug=Popover reason=programmatic")]
    public void Dismissal_emits_slug_and_reason_without_content(PopoverDismissReason reason, string expected)
    {
        var lines = new List<string>();
        var diag = new PopoverDiagnostics(lines.Add);

        diag.RecordDismissed(reason);

        Assert.Equal(expected, Assert.Single(lines));
    }

    // ── i18n / a11y label contract ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_label_is_always_present()
    {
        var withLabel = new PopoverViewModel(Localizer) { AriaLabel = "Bell notifications" };
        var withoutLabel = new PopoverViewModel(Localizer);

        Assert.Equal("Bell notifications", withLabel.ResolvedAriaLabel);
        Assert.False(string.IsNullOrWhiteSpace(withoutLabel.ResolvedAriaLabel));
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
