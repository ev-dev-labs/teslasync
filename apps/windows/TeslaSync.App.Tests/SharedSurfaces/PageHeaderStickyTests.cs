using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>PageHeaderSticky</c> shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation ids, the Segoe Fluent arrow glyph, the region + scroll-to-top i18n keys and their
/// verbatim English fallbacks, and the em-dash separator), the pure <see cref="PageHeaderStickyVisibility"/> gate (the
/// web <c>!entry.isIntersecting &amp;&amp; entry.boundingClientRect.top &lt; 0</c>), the
/// <see cref="PageHeaderStickyProjection"/> (the visibility, scroll-affordance, arrow, offset and composed accessible
/// names), the <see cref="PageHeaderStickyViewModel"/> state holder (visibility callback + prop mutations + the
/// scroll action seam), the <see cref="NullPageScroller"/> inert seam and the PII-safe diagnostics. Mirrors the web
/// spec one-for-one (web/src/components/layout/PageHeaderSticky.tsx): the observer-driven visibility, the
/// <c>scrollToTop ? button : div</c> branch, the <c>handleScrollTop</c> action and the
/// <c>aria-label={`${ariaLabel} — scroll to top`}</c> naming. The WinUI view itself (shared-surfaces/PageHeaderSticky.cs,
/// which composes the TsGlassPanel, the scroll Button, the arrow FontIcon and the content presenter) is exercised by
/// the app build.
/// </summary>
public sealed class PageHeaderStickyTests
{
    private const string RegionLabelKey = "translation.layout.pageHeaderSticky.region";
    private const string RegionLabelFallback = "Page summary";
    private const string ScrollToTopSuffixKey = "translation.layout.pageHeaderSticky.scrollToTop";
    private const string ScrollToTopSuffixFallback = "scroll to top";
    private const string ArrowUpGlyph = "\uE74A";

    private static readonly ILocalizer Passthrough = PassthroughLocalizer.Instance;

    private static PageHeaderStickyDisplay Project(
        bool targetIntersecting = false,
        bool targetAboveViewport = true,
        bool scrollToTop = true,
        double topOffset = 0,
        string? regionLabel = null,
        ILocalizer? localizer = null) =>
        PageHeaderStickyProjection.Project(
            PageHeaderStickyModel.Create(targetIntersecting, targetAboveViewport, scrollToTop, topOffset, regionLabel),
            localizer ?? Passthrough);

    // ── registration: slug / automation ids / glyph / separator ──────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface()
    {
        Assert.Equal("PageHeaderSticky", PageHeaderStickyRegistration.Slug);
        Assert.Equal("PageHeaderSticky", PageHeaderStickyViewModel.Slug);
    }

    [Fact]
    public void Registration_pins_the_automation_ids()
    {
        Assert.Equal("page-header-sticky", PageHeaderStickyRegistration.RegionAutomationId);
        Assert.Equal("page-header-sticky-scroll-top", PageHeaderStickyRegistration.ScrollToTopAutomationId);
    }

    [Fact]
    public void Registration_pins_the_fluent_glyph_for_the_web_lucide_arrow_up() =>
        // web Lucide ArrowUp → the Segoe Fluent "Up" stand-in (matching the W2 atomic).
        Assert.Equal(ArrowUpGlyph, PageHeaderStickyRegistration.ArrowUpGlyph);

    [Fact]
    public void Registration_pins_the_em_dash_separator() =>
        // web aria-label={`${ariaLabel} — scroll to top`} — a spaced em-dash.
        Assert.Equal(" \u2014 ", PageHeaderStickyRegistration.ScrollToTopSeparator);

    [Fact]
    public void Registration_pins_the_i18n_keys_and_verbatim_english_fallbacks()
    {
        Assert.Equal(RegionLabelKey, PageHeaderStickyRegistration.RegionLabelKey);
        Assert.Equal(RegionLabelFallback, PageHeaderStickyRegistration.RegionLabelFallback);
        Assert.Equal(ScrollToTopSuffixKey, PageHeaderStickyRegistration.ScrollToTopSuffixKey);
        Assert.Equal(ScrollToTopSuffixFallback, PageHeaderStickyRegistration.ScrollToTopSuffixFallback);
    }

    // ── registration: region label resolver (web required ariaLabel prop) ────────────────────────────────

    [Fact]
    public void ResolveRegionLabel_uses_the_host_label_when_supplied_without_touching_the_catalogue()
    {
        var localizer = new RecordingLocalizer();

        string label = PageHeaderStickyRegistration.ResolveRegionLabel(localizer, "Drive history summary");

        // The host supplies the per-page aria-label exactly like the web prop; the default key is not consulted.
        Assert.Equal("Drive history summary", label);
        Assert.Empty(localizer.Calls);
    }

    [Fact]
    public void ResolveRegionLabel_trims_the_host_label()
    {
        string label = PageHeaderStickyRegistration.ResolveRegionLabel(Passthrough, "  Charging summary  ");

        Assert.Equal("Charging summary", label);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveRegionLabel_falls_back_to_the_localized_default_when_blank(string? hostLabel)
    {
        var localizer = new RecordingLocalizer();

        string label = PageHeaderStickyRegistration.ResolveRegionLabel(localizer, hostLabel);

        (string Key, string Fallback) call = Assert.Single(localizer.Calls);
        Assert.Equal(RegionLabelKey, call.Key);
        Assert.Equal(RegionLabelFallback, call.Fallback);
        Assert.Equal(RegionLabelFallback, label);
    }

    [Fact]
    public void ResolveRegionLabel_returns_the_localized_default_when_the_catalogue_has_one()
    {
        var localizer = new RecordingLocalizer { Translation = "Seitenzusammenfassung" };

        string label = PageHeaderStickyRegistration.ResolveRegionLabel(localizer, hostLabel: null);

        Assert.Equal("Seitenzusammenfassung", label);
    }

    // ── registration: scroll-to-top suffix + composed name (web `${ariaLabel} — scroll to top`) ───────────

    [Fact]
    public void ResolveScrollToTopSuffix_reads_the_key_with_the_english_fallback()
    {
        var localizer = new RecordingLocalizer();

        string suffix = PageHeaderStickyRegistration.ResolveScrollToTopSuffix(localizer);

        (string Key, string Fallback) call = Assert.Single(localizer.Calls);
        Assert.Equal(ScrollToTopSuffixKey, call.Key);
        Assert.Equal(ScrollToTopSuffixFallback, call.Fallback);
        Assert.Equal(ScrollToTopSuffixFallback, suffix);
    }

    [Fact]
    public void ComposeScrollToTopName_joins_the_region_label_and_suffix_with_the_em_dash() =>
        // web aria-label={`${ariaLabel} — scroll to top`}.
        Assert.Equal(
            "Drive history summary \u2014 scroll to top",
            PageHeaderStickyRegistration.ComposeScrollToTopName("Drive history summary", "scroll to top"));

    [Fact]
    public void Resolvers_reject_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => PageHeaderStickyRegistration.ResolveRegionLabel(null!, "x"));
        Assert.Throws<ArgumentNullException>(() => PageHeaderStickyRegistration.ResolveScrollToTopSuffix(null!));
    }

    // ── adapter: visibility gate (the web IntersectionObserver, L64-72) ──────────────────────────────────

    [Fact]
    public void Decide_shows_the_bar_only_when_the_hero_is_off_screen_and_scrolled_above() =>
        Assert.True(PageHeaderStickyVisibility.Decide(targetIntersecting: false, targetAboveViewport: true));

    [Fact]
    public void Decide_hides_the_bar_while_the_hero_is_on_screen()
    {
        Assert.False(PageHeaderStickyVisibility.Decide(targetIntersecting: true, targetAboveViewport: false));
        Assert.False(PageHeaderStickyVisibility.Decide(targetIntersecting: true, targetAboveViewport: true));
    }

    [Fact]
    public void Decide_hides_the_bar_when_the_hero_is_below_the_viewport_not_yet_scrolled_past() =>
        // The web false-positive guard (L66-70): off-screen but still below the viewport top → stay hidden.
        Assert.False(PageHeaderStickyVisibility.Decide(targetIntersecting: false, targetAboveViewport: false));

    // ── projection: visibility ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_visible_once_the_hero_scrolls_above_the_viewport() =>
        Assert.True(Project(targetIntersecting: false, targetAboveViewport: true).IsVisible);

    [Fact]
    public void Projection_is_hidden_while_the_hero_is_on_screen() =>
        Assert.False(Project(targetIntersecting: true, targetAboveViewport: true).IsVisible);

    [Fact]
    public void Projection_is_hidden_while_the_hero_is_below_the_viewport() =>
        Assert.False(Project(targetIntersecting: false, targetAboveViewport: false).IsVisible);

    // ── projection: scroll-to-top affordance (web `scrollToTop ? button : div` + `{scrollToTop && <ArrowUp/>}`)

    [Fact]
    public void Projection_enables_the_scroll_affordance_and_arrow_by_default()
    {
        PageHeaderStickyDisplay display = Project(scrollToTop: true);

        Assert.True(display.ScrollToTopEnabled);
        Assert.True(display.ShowArrow);
        Assert.Equal(ArrowUpGlyph, display.ArrowGlyph);
    }

    [Fact]
    public void Projection_renders_a_static_row_without_an_arrow_when_scroll_to_top_is_disabled()
    {
        PageHeaderStickyDisplay display = Project(scrollToTop: false);

        Assert.False(display.ScrollToTopEnabled);
        Assert.False(display.ShowArrow);
        // The glyph is still pinned (the view simply collapses the arrow), so the display is fully asserted.
        Assert.Equal(ArrowUpGlyph, display.ArrowGlyph);
    }

    // ── projection: top offset (web style={{ top: topOffset }}) ──────────────────────────────────────────

    [Theory]
    [InlineData(0)]
    [InlineData(64)]
    [InlineData(120.5)]
    public void Projection_carries_the_top_offset(double topOffset) =>
        Assert.Equal(topOffset, Project(topOffset: topOffset).TopOffset);

    // ── projection: accessible names (web aria-label + `${ariaLabel} — scroll to top`) ───────────────────

    [Fact]
    public void Projection_names_the_region_with_the_host_label()
    {
        PageHeaderStickyDisplay display = Project(regionLabel: "Drive history summary");

        Assert.Equal("Drive history summary", display.RegionName);
        Assert.Equal("Drive history summary \u2014 scroll to top", display.ScrollToTopName);
    }

    [Fact]
    public void Projection_names_the_region_with_the_localized_default_when_no_host_label()
    {
        PageHeaderStickyDisplay display = Project(regionLabel: null);

        Assert.Equal(RegionLabelFallback, display.RegionName);
        Assert.Equal("Page summary \u2014 scroll to top", display.ScrollToTopName);
    }

    [Fact]
    public void Projection_resolves_names_through_the_catalogue_when_localized()
    {
        var localizer = new RecordingLocalizer { Translation = "XLATED" };

        PageHeaderStickyDisplay display = Project(regionLabel: null, localizer: localizer);

        // Default region label + suffix both resolve through the facade (the host label is absent).
        Assert.Equal("XLATED", display.RegionName);
        Assert.Equal("XLATED \u2014 XLATED", display.ScrollToTopName);
        Assert.Equal(2, localizer.Calls.Count);
    }

    [Fact]
    public void Projection_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => PageHeaderStickyProjection.Project(null!, Passthrough));
        Assert.Throws<ArgumentNullException>(() => PageHeaderStickyProjection.Project(PageHeaderStickyModel.Default, null!));
    }

    // ── model defaults ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Model_default_is_the_hidden_scroll_to_top_bar()
    {
        PageHeaderStickyModel model = PageHeaderStickyModel.Default;

        Assert.True(model.TargetIntersecting);
        Assert.False(model.TargetAboveViewport);
        Assert.True(model.ScrollToTop);
        Assert.Equal(0, model.TopOffset);
        Assert.Null(model.RegionLabel);
        Assert.False(Project(model.TargetIntersecting, model.TargetAboveViewport).IsVisible);
    }

    // ── NullPageScroller: inert fallback (web window/no-host fallback) ────────────────────────────────────

    [Fact]
    public void NullPageScroller_scroll_is_a_safe_no_op()
    {
        IPageScroller scroller = NullPageScroller.Instance;

        Exception? error = Record.Exception(scroller.ScrollToTop);

        Assert.Null(error);
    }

    [Fact]
    public void NullPageScroller_is_a_shared_singleton() =>
        Assert.Same(NullPageScroller.Instance, NullPageScroller.Instance);

    // ── ViewModel: initial state is hidden (web visible === false) ───────────────────────────────────────

    [Fact]
    public void ViewModel_starts_hidden()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough);

        Assert.False(vm.IsVisible);
        Assert.True(vm.ScrollToTopEnabled);
    }

    [Fact]
    public void ViewModel_exposes_the_constructed_top_offset()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough, topOffset: 64);

        Assert.Equal(64, vm.TopOffset);
    }

    // ── ViewModel: visibility callback (web IntersectionObserver) ────────────────────────────────────────

    [Fact]
    public void SetTargetVisibility_shows_the_bar_once_the_hero_scrolls_above()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough);
        int notifications = 0;
        vm.PropertyChanged += (_, _) => notifications++;

        vm.SetTargetVisibility(targetIntersecting: false, targetAboveViewport: true);

        Assert.True(vm.IsVisible);
        Assert.Equal(1, notifications);
    }

    [Fact]
    public void SetTargetVisibility_keeps_the_bar_hidden_while_the_hero_is_below_the_viewport()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough);

        vm.SetTargetVisibility(targetIntersecting: false, targetAboveViewport: false);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void SetTargetVisibility_hides_the_bar_when_the_hero_returns_to_screen()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough);
        vm.SetTargetVisibility(targetIntersecting: false, targetAboveViewport: true);

        vm.SetTargetVisibility(targetIntersecting: true, targetAboveViewport: false);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void SetTargetVisibility_does_not_notify_when_the_projection_is_unchanged()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough);
        int notifications = 0;
        vm.PropertyChanged += (_, _) => notifications++;

        // Already hidden at construction — re-asserting the resting state must not re-project.
        vm.SetTargetVisibility(targetIntersecting: true, targetAboveViewport: false);

        Assert.Equal(0, notifications);
    }

    // ── ViewModel: prop mutations (web re-render with new props) ──────────────────────────────────────────

    [Fact]
    public void SetScrollToTop_toggles_the_affordance_and_notifies()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough);
        int notifications = 0;
        vm.PropertyChanged += (_, _) => notifications++;

        vm.SetScrollToTop(false);

        Assert.False(vm.ScrollToTopEnabled);
        Assert.False(vm.Display.ShowArrow);
        Assert.Equal(1, notifications);
    }

    [Fact]
    public void SetTopOffset_updates_the_display_offset()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough);

        vm.SetTopOffset(96);

        Assert.Equal(96, vm.TopOffset);
        Assert.Equal(96, vm.Display.TopOffset);
    }

    [Fact]
    public void SetRegionLabel_renames_the_region_and_scroll_control()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough);

        vm.SetRegionLabel("Charging summary");

        Assert.Equal("Charging summary", vm.Display.RegionName);
        Assert.Equal("Charging summary \u2014 scroll to top", vm.Display.ScrollToTopName);
    }

    [Fact]
    public void Setters_are_idempotent_and_do_not_re_notify()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough, scrollToTop: true, topOffset: 10);
        int notifications = 0;
        vm.PropertyChanged += (_, _) => notifications++;

        vm.SetScrollToTop(true);
        vm.SetTopOffset(10);
        vm.SetRegionLabel(null);

        Assert.Equal(0, notifications);
    }

    // ── ViewModel: scroll action seam (web handleScrollTop) ──────────────────────────────────────────────

    [Fact]
    public void RequestScrollToTop_invokes_the_scroller_and_records_when_enabled()
    {
        var captured = new List<string>();
        var scroller = new FakePageScroller();
        var vm = new PageHeaderStickyViewModel(
            Passthrough, scroller, new PageHeaderStickyDiagnostics(captured.Add), scrollToTop: true);

        bool invoked = vm.RequestScrollToTop();

        Assert.True(invoked);
        Assert.Equal(1, scroller.ScrollCount);
        Assert.Equal("pageHeaderSticky.scrollToTop slug=PageHeaderSticky", Assert.Single(captured));
    }

    [Fact]
    public void RequestScrollToTop_is_a_no_op_when_the_affordance_is_disabled()
    {
        var captured = new List<string>();
        var scroller = new FakePageScroller();
        var vm = new PageHeaderStickyViewModel(
            Passthrough, scroller, new PageHeaderStickyDiagnostics(captured.Add), scrollToTop: false);

        bool invoked = vm.RequestScrollToTop();

        Assert.False(invoked);
        Assert.Equal(0, scroller.ScrollCount);
        Assert.Empty(captured);
    }

    [Fact]
    public void RequestScrollToTop_against_the_null_scroller_does_not_throw()
    {
        var vm = new PageHeaderStickyViewModel(Passthrough);

        Exception? error = Record.Exception(() => vm.RequestScrollToTop());

        Assert.Null(error);
    }

    // ── ViewModel: view.opened once (web component mount) ────────────────────────────────────────────────

    [Fact]
    public void MarkOpened_records_the_view_opened_event_once()
    {
        var captured = new List<string>();
        var vm = new PageHeaderStickyViewModel(Passthrough, diagnostics: new PageHeaderStickyDiagnostics(captured.Add));

        vm.MarkOpened();
        vm.MarkOpened();

        Assert.Equal("view.opened slug=PageHeaderSticky", Assert.Single(captured));
    }

    // ── ViewModel: argument validation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new PageHeaderStickyViewModel(null!));

    // ── Diagnostics (P1/S11): slug-only operational counters, never the label or content ─────────────────

    [Fact]
    public void Diagnostics_count_and_emit_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new PageHeaderStickyDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordScrollToTop();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.ScrollToTops);
        string[] expected =
        [
            "view.opened slug=PageHeaderSticky",
            "pageHeaderSticky.scrollToTop slug=PageHeaderSticky",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Diagnostics_never_leak_the_region_label()
    {
        var captured = new List<string>();
        var scroller = new FakePageScroller();
        var vm = new PageHeaderStickyViewModel(
            Passthrough,
            scroller,
            new PageHeaderStickyDiagnostics(captured.Add),
            regionLabel: "Drive history summary",
            scrollToTop: true);

        vm.MarkOpened();
        vm.RequestScrollToTop();

        Assert.All(captured, line => Assert.DoesNotContain("Drive history summary", line, StringComparison.Ordinal));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count()
    {
        var diagnostics = new PageHeaderStickyDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordScrollToTop();
        diagnostics.RecordScrollToTop();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(2, diagnostics.ScrollToTops);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private sealed class FakePageScroller : IPageScroller
    {
        public int ScrollCount { get; private set; }

        public void ScrollToTop() => ScrollCount++;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly List<(string Key, string Fallback)> _calls = [];

        public IReadOnlyList<(string Key, string Fallback)> Calls => _calls;

        public string? Translation { get; init; }

        public string GetString(string key, string fallback)
        {
            _calls.Add((key, fallback));
            return Translation ?? fallback;
        }
    }
}
