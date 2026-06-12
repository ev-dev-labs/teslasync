using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Status;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>StickyCompactHero</c> shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation ids, the Segoe Fluent arrow / refresh glyphs, the last-checked separator, the three
/// accessible-name i18n keys + their verbatim English fallbacks, and the per-status headline keys whose fallback is
/// the shared <see cref="StatusPresentation.ShortHeadline(HealthStatus)"/>), the pure
/// <see cref="StickyCompactHeroVisibility"/> gate (the web <c>!entry.isIntersecting</c>), the
/// <see cref="StickyCompactHeroProjection"/> (per-status icon / accent / headline, the last-checked suffix, the
/// refresh-affordance rules and the composed Narrator name), the <see cref="StickyCompactHeroViewModel"/> state holder
/// (visibility + prop mutations + the scroll / refresh action seams), the <see cref="NullStickyHeroScroller"/> inert
/// seam and the PII-safe diagnostics. Mirrors the web spec (web/src/components/status/StickyCompactHero.tsx). The
/// WinUI view itself (shared-surfaces/StickyCompactHero.cs, which composes the TsGlassPanel, the scroll Button and the
/// TsButton refresh) is exercised by the app build.
/// </summary>
public sealed class StickyCompactHeroTests
{
    private static readonly ILocalizer Passthrough = PassthroughLocalizer.Instance;

    private static readonly HealthStatus[] AllStatuses =
    [
        HealthStatus.Healthy,
        HealthStatus.Degraded,
        HealthStatus.Unhealthy,
        HealthStatus.Unknown,
        HealthStatus.Maintenance,
    ];

    private static StickyCompactHeroDisplay Project(
        HealthStatus status = HealthStatus.Healthy,
        string? lastCheckedLabel = null,
        bool hasRefresh = false,
        bool refreshing = false,
        bool targetIntersecting = false,
        ILocalizer? localizer = null) =>
        StickyCompactHeroProjection.Project(
            StickyCompactHeroModel.Create(status, lastCheckedLabel, hasRefresh, refreshing, targetIntersecting),
            localizer ?? Passthrough);

    // ── registration: slug / automation ids / glyphs / separator ─────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface()
    {
        Assert.Equal("StickyCompactHero", StickyCompactHeroRegistration.Slug);
        Assert.Equal("StickyCompactHero", StickyCompactHeroViewModel.Slug);
    }

    [Fact]
    public void Registration_pins_the_automation_ids()
    {
        Assert.Equal("sticky-compact-hero", StickyCompactHeroRegistration.RegionAutomationId);
        Assert.Equal("sticky-compact-hero-scroll-top", StickyCompactHeroRegistration.ScrollToTopAutomationId);
        Assert.Equal("sticky-compact-hero-refresh", StickyCompactHeroRegistration.RefreshAutomationId);
    }

    [Fact]
    public void Registration_pins_the_fluent_glyphs_for_the_web_lucide_icons()
    {
        // web Lucide ArrowUp / RefreshCw → the Segoe Fluent "Up" / "Refresh" stand-ins (matching the W2 atomic).
        Assert.Equal("\uE74A", StickyCompactHeroRegistration.ArrowUpGlyph);
        Assert.Equal("\uE72C", StickyCompactHeroRegistration.RefreshGlyph);
    }

    [Fact]
    public void Registration_pins_the_last_checked_separator() =>
        Assert.Equal("\u00B7 ", StickyCompactHeroRegistration.LastCheckedPrefix);

    // ── registration: i18n keys + verbatim english fallbacks (the web aria-labels) ───────────────────────

    [Fact]
    public void Registration_pins_the_accessible_name_keys_and_fallbacks()
    {
        Assert.Equal("translation.status.compactHero.region", StickyCompactHeroRegistration.RegionLabelKey);
        Assert.Equal("Status summary", StickyCompactHeroRegistration.RegionLabelFallback);
        Assert.Equal("translation.status.compactHero.scrollToTop", StickyCompactHeroRegistration.ScrollToTopKey);
        Assert.Equal("Scroll to top of page", StickyCompactHeroRegistration.ScrollToTopFallback);
        Assert.Equal("translation.status.compactHero.refresh", StickyCompactHeroRegistration.RefreshKey);
        Assert.Equal("Refresh status", StickyCompactHeroRegistration.RefreshFallback);
    }

    [Theory]
    [InlineData(HealthStatus.Healthy, "healthy", "All operational")]
    [InlineData(HealthStatus.Degraded, "degraded", "Degraded")]
    [InlineData(HealthStatus.Unhealthy, "unhealthy", "Outage")]
    [InlineData(HealthStatus.Unknown, "unknown", "Status unknown")]
    [InlineData(HealthStatus.Maintenance, "maintenance", "Maintenance")]
    public void Registration_headline_key_and_fallback_match_the_web_short_headline(
        HealthStatus status,
        string token,
        string fallback)
    {
        Assert.Equal(token, StickyCompactHeroRegistration.StatusToken(status));
        Assert.Equal("translation.status.compactHero.headline." + token, StickyCompactHeroRegistration.HeadlineKey(status));
        // The fallback is byte-for-byte the web SHORT_HEADLINE value, sourced from the shared StatusPresentation.
        Assert.Equal(fallback, StickyCompactHeroRegistration.HeadlineFallback(status));
        Assert.Equal(StatusPresentation.ShortHeadline(status), StickyCompactHeroRegistration.HeadlineFallback(status));
    }

    [Fact]
    public void ResolveHeadline_reads_the_per_status_key_with_the_short_headline_fallback()
    {
        var localizer = new RecordingLocalizer();

        string headline = StickyCompactHeroRegistration.ResolveHeadline(localizer, HealthStatus.Healthy);

        (string Key, string Fallback) call = Assert.Single(localizer.Calls);
        Assert.Equal("translation.status.compactHero.headline.healthy", call.Key);
        Assert.Equal("All operational", call.Fallback);
        Assert.Equal("All operational", headline);
    }

    [Fact]
    public void Resolvers_return_the_localized_values_when_the_catalogue_has_them()
    {
        var localizer = new RecordingLocalizer { Translation = "XLATED" };

        Assert.Equal("XLATED", StickyCompactHeroRegistration.ResolveRegionLabel(localizer));
        Assert.Equal("XLATED", StickyCompactHeroRegistration.ResolveScrollToTopLabel(localizer));
        Assert.Equal("XLATED", StickyCompactHeroRegistration.ResolveRefreshLabel(localizer));
        Assert.Equal("XLATED", StickyCompactHeroRegistration.ResolveHeadline(localizer, HealthStatus.Degraded));
    }

    [Fact]
    public void Resolvers_reject_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => StickyCompactHeroRegistration.ResolveRegionLabel(null!));
        Assert.Throws<ArgumentNullException>(() => StickyCompactHeroRegistration.ResolveScrollToTopLabel(null!));
        Assert.Throws<ArgumentNullException>(() => StickyCompactHeroRegistration.ResolveRefreshLabel(null!));
        Assert.Throws<ArgumentNullException>(() => StickyCompactHeroRegistration.ResolveHeadline(null!, HealthStatus.Healthy));
    }

    // ── adapter: visibility gate (the web IntersectionObserver) ──────────────────────────────────────────

    [Fact]
    public void Decide_hides_the_bar_when_the_hero_is_on_screen() =>
        Assert.False(StickyCompactHeroVisibility.Decide(targetIntersecting: true));

    [Fact]
    public void Decide_shows_the_bar_when_the_hero_is_off_screen() =>
        Assert.True(StickyCompactHeroVisibility.Decide(targetIntersecting: false));

    // ── projection: visibility ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_hidden_while_the_hero_is_on_screen() =>
        Assert.False(Project(targetIntersecting: true).IsVisible);

    [Fact]
    public void Projection_is_visible_once_the_hero_scrolls_away() =>
        Assert.True(Project(targetIntersecting: false).IsVisible);

    // ── projection: per-status icon / accent / headline (the five HeroStatus variants) ───────────────────

    [Theory]
    [InlineData(HealthStatus.Healthy)]
    [InlineData(HealthStatus.Degraded)]
    [InlineData(HealthStatus.Unhealthy)]
    [InlineData(HealthStatus.Unknown)]
    [InlineData(HealthStatus.Maintenance)]
    public void Projection_paints_the_shared_status_icon_accent_and_headline(HealthStatus status)
    {
        StickyCompactHeroDisplay display = Project(status);

        Assert.Equal(status, display.Status);
        Assert.Equal(StatusPresentation.Glyph(status), display.Glyph);
        Assert.Equal(StatusPresentation.AccentHex(status), display.AccentHex);
        Assert.Equal(StatusPresentation.ShortHeadline(status), display.Headline);
        Assert.Equal(StickyCompactHeroRegistration.ArrowUpGlyph, display.ArrowUpGlyph);
        Assert.Equal(StickyCompactHeroRegistration.RefreshGlyph, display.RefreshGlyph);
    }

    [Fact]
    public void Projection_headlines_match_the_verbatim_web_short_headline_map()
    {
        Assert.Equal("All operational", Project(HealthStatus.Healthy).Headline);
        Assert.Equal("Degraded", Project(HealthStatus.Degraded).Headline);
        Assert.Equal("Outage", Project(HealthStatus.Unhealthy).Headline);
        Assert.Equal("Status unknown", Project(HealthStatus.Unknown).Headline);
        Assert.Equal("Maintenance", Project(HealthStatus.Maintenance).Headline);
    }

    // ── projection: last-checked label (web `· {lastCheckedLabel}`) ──────────────────────────────────────

    [Fact]
    public void Projection_renders_the_last_checked_label_with_the_dot_separator()
    {
        StickyCompactHeroDisplay display = Project(lastCheckedLabel: "12s ago");

        Assert.True(display.HasLastChecked);
        Assert.Equal("12s ago", display.LastCheckedLabel);
        Assert.Equal("\u00B7 12s ago", display.LastCheckedText);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Projection_omits_the_last_checked_label_when_blank(string? label)
    {
        StickyCompactHeroDisplay display = Project(lastCheckedLabel: label);

        Assert.False(display.HasLastChecked);
        Assert.Equal(string.Empty, display.LastCheckedLabel);
        Assert.Equal(string.Empty, display.LastCheckedText);
    }

    [Fact]
    public void Projection_trims_the_last_checked_label()
    {
        StickyCompactHeroDisplay display = Project(lastCheckedLabel: "  5m ago  ");

        Assert.Equal("5m ago", display.LastCheckedLabel);
        Assert.Equal("\u00B7 5m ago", display.LastCheckedText);
    }

    // ── projection: refresh affordance (web `{onRefresh && ...}` + `disabled={refreshing}`) ──────────────

    [Fact]
    public void Projection_hides_the_refresh_button_when_no_refresh_is_offered()
    {
        StickyCompactHeroDisplay display = Project(hasRefresh: false);

        Assert.False(display.ShowRefresh);
        Assert.False(display.CanRefresh);
    }

    [Fact]
    public void Projection_shows_an_interactive_refresh_button_when_offered_and_idle()
    {
        StickyCompactHeroDisplay display = Project(hasRefresh: true, refreshing: false);

        Assert.True(display.ShowRefresh);
        Assert.False(display.Refreshing);
        Assert.True(display.CanRefresh);
    }

    [Fact]
    public void Projection_disables_the_refresh_button_while_a_refresh_is_in_flight()
    {
        StickyCompactHeroDisplay display = Project(hasRefresh: true, refreshing: true);

        Assert.True(display.ShowRefresh);
        Assert.True(display.Refreshing);
        Assert.False(display.CanRefresh);
    }

    // ── projection: accessibility (every interactive control + the region has a name) ───────────────────

    [Fact]
    public void Projection_resolves_the_localized_accessible_names()
    {
        StickyCompactHeroDisplay display = Project();

        Assert.Equal("Status summary", display.RegionName);
        Assert.Equal("Scroll to top of page", display.ScrollToTopName);
        Assert.Equal("Refresh status", display.RefreshName);
    }

    [Fact]
    public void Projection_region_name_announces_the_status_headline()
    {
        StickyCompactHeroDisplay display = Project(HealthStatus.Unhealthy);

        Assert.Contains("Status summary", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Outage", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_region_name_appends_the_last_checked_label_when_present()
    {
        StickyCompactHeroDisplay withLabel = Project(HealthStatus.Healthy, lastCheckedLabel: "12s ago");
        StickyCompactHeroDisplay withoutLabel = Project(HealthStatus.Healthy);

        Assert.Contains("\u00B7 12s ago", withLabel.AutomationName, StringComparison.Ordinal);
        Assert.DoesNotContain("\u00B7", withoutLabel.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_uses_localized_names_throughout_and_reads_every_key()
    {
        var localizer = new RecordingLocalizer { Translation = "XLATED" };

        StickyCompactHeroDisplay display = Project(HealthStatus.Degraded, lastCheckedLabel: "now", localizer: localizer);

        // Every visible string flowed through the i18n facade — no English literal is hard-coded in the projection.
        string[] keys = localizer.Calls.Select(c => c.Key).ToArray();
        Assert.Contains("translation.status.compactHero.headline.degraded", keys);
        Assert.Contains("translation.status.compactHero.region", keys);
        Assert.Contains("translation.status.compactHero.scrollToTop", keys);
        Assert.Contains("translation.status.compactHero.refresh", keys);
        Assert.Equal("XLATED", display.Headline);
        Assert.Equal("XLATED", display.RegionName);
        Assert.Equal("XLATED", display.ScrollToTopName);
        Assert.Equal("XLATED", display.RefreshName);
    }

    [Fact]
    public void Project_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => StickyCompactHeroProjection.Project(null!, Passthrough));
        Assert.Throws<ArgumentNullException>(() => StickyCompactHeroProjection.Project(StickyCompactHeroModel.Default, null!));
    }

    // ── model ────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Model_default_is_an_unknown_hidden_bar_with_no_refresh()
    {
        StickyCompactHeroModel model = StickyCompactHeroModel.Default;

        Assert.Equal(HealthStatus.Unknown, model.Status);
        Assert.True(model.TargetIntersecting);
        Assert.Null(model.LastCheckedLabel);
        Assert.False(model.HasRefresh);
        Assert.False(model.Refreshing);
    }

    [Fact]
    public void Model_create_round_trips_its_inputs()
    {
        StickyCompactHeroModel model = StickyCompactHeroModel.Create(
            HealthStatus.Maintenance, "1h ago", hasRefresh: true, refreshing: true, targetIntersecting: false);

        Assert.Equal(HealthStatus.Maintenance, model.Status);
        Assert.Equal("1h ago", model.LastCheckedLabel);
        Assert.True(model.HasRefresh);
        Assert.True(model.Refreshing);
        Assert.False(model.TargetIntersecting);
    }

    // ── view-model: construction + initial state ─────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new StickyCompactHeroViewModel(null!));

    [Fact]
    public void ViewModel_initial_state_is_hidden_unknown_and_without_refresh()
    {
        var vm = new StickyCompactHeroViewModel(Passthrough);

        Assert.False(vm.IsVisible);
        Assert.False(vm.Display.IsVisible);
        Assert.Equal(HealthStatus.Unknown, vm.Status);
        Assert.False(vm.HasRefresh);
        Assert.False(vm.Display.ShowRefresh);
    }

    [Fact]
    public void ViewModel_honours_the_initial_props()
    {
        var vm = new StickyCompactHeroViewModel(
            Passthrough,
            initialStatus: HealthStatus.Degraded,
            initialLastCheckedLabel: "30s ago",
            initialRefreshing: true);

        Assert.Equal(HealthStatus.Degraded, vm.Status);
        Assert.Equal("Degraded", vm.Display.Headline);
        Assert.Equal("\u00B7 30s ago", vm.Display.LastCheckedText);
        Assert.True(vm.Display.Refreshing);
    }

    [Fact]
    public void ViewModel_has_refresh_only_when_a_refresher_is_supplied()
    {
        Assert.False(new StickyCompactHeroViewModel(Passthrough).HasRefresh);
        Assert.True(new StickyCompactHeroViewModel(Passthrough, refresher: new FakeRefresher()).HasRefresh);
    }

    // ── view-model: visibility (the IntersectionObserver callback) ───────────────────────────────────────

    [Fact]
    public void SetTargetIntersecting_toggles_visibility_and_notifies()
    {
        var vm = new StickyCompactHeroViewModel(Passthrough);
        var notifications = Subscribe(vm);

        vm.SetTargetIntersecting(false);

        Assert.True(vm.IsVisible);
        Assert.Equal(1, notifications.Count);
    }

    [Fact]
    public void SetTargetIntersecting_is_a_no_op_when_unchanged()
    {
        var vm = new StickyCompactHeroViewModel(Passthrough);
        var notifications = Subscribe(vm);

        vm.SetTargetIntersecting(true); // already true (hidden)

        Assert.False(vm.IsVisible);
        Assert.Equal(0, notifications.Count);
    }

    // ── view-model: prop mutations ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void SetStatus_updates_the_projection_and_notifies()
    {
        var vm = new StickyCompactHeroViewModel(Passthrough);
        var notifications = Subscribe(vm);

        vm.SetStatus(HealthStatus.Unhealthy);

        Assert.Equal(HealthStatus.Unhealthy, vm.Status);
        Assert.Equal("Outage", vm.Display.Headline);
        Assert.Equal(1, notifications.Count);
    }

    [Fact]
    public void SetStatus_is_a_no_op_when_unchanged()
    {
        var vm = new StickyCompactHeroViewModel(Passthrough, initialStatus: HealthStatus.Healthy);
        var notifications = Subscribe(vm);

        vm.SetStatus(HealthStatus.Healthy);

        Assert.Equal(0, notifications.Count);
    }

    [Fact]
    public void SetLastCheckedLabel_updates_the_projection()
    {
        var vm = new StickyCompactHeroViewModel(Passthrough);
        var notifications = Subscribe(vm);

        vm.SetLastCheckedLabel("9s ago");

        Assert.True(vm.Display.HasLastChecked);
        Assert.Equal("\u00B7 9s ago", vm.Display.LastCheckedText);
        Assert.Equal(1, notifications.Count);
    }

    [Fact]
    public void SetRefreshing_updates_the_busy_state()
    {
        var vm = new StickyCompactHeroViewModel(Passthrough, refresher: new FakeRefresher());
        var notifications = Subscribe(vm);

        vm.SetRefreshing(true);

        Assert.True(vm.Display.Refreshing);
        Assert.False(vm.Display.CanRefresh);
        Assert.Equal(1, notifications.Count);
    }

    // ── view-model: scroll-to-top action (web window.scrollTo) ───────────────────────────────────────────

    [Fact]
    public void RequestScrollToTop_invokes_the_scroller_and_records_it()
    {
        var captured = new List<string>();
        var scroller = new FakeScroller();
        var vm = new StickyCompactHeroViewModel(Passthrough, scroller, diagnostics: new StickyCompactHeroDiagnostics(captured.Add));

        vm.RequestScrollToTop();

        Assert.Equal(1, scroller.ScrollToTopCount);
        Assert.Equal("stickyHero.scrollToTop slug=StickyCompactHero", Assert.Single(captured));
    }

    [Fact]
    public void RequestScrollToTop_is_safe_without_a_scroller()
    {
        var vm = new StickyCompactHeroViewModel(Passthrough);

        Exception? error = Record.Exception(() => vm.RequestScrollToTop());

        Assert.Null(error);
    }

    // ── view-model: refresh action (web onRefresh, guarded by disabled={refreshing}) ─────────────────────

    [Fact]
    public void RequestRefresh_invokes_the_refresher_and_records_it()
    {
        var captured = new List<string>();
        var refresher = new FakeRefresher();
        var vm = new StickyCompactHeroViewModel(Passthrough, refresher: refresher, diagnostics: new StickyCompactHeroDiagnostics(captured.Add));

        bool invoked = vm.RequestRefresh();

        Assert.True(invoked);
        Assert.Equal(1, refresher.RefreshCount);
        Assert.Equal("stickyHero.refresh slug=StickyCompactHero", Assert.Single(captured));
    }

    [Fact]
    public void RequestRefresh_does_nothing_when_no_refresher_is_wired()
    {
        var captured = new List<string>();
        var vm = new StickyCompactHeroViewModel(Passthrough, diagnostics: new StickyCompactHeroDiagnostics(captured.Add));

        bool invoked = vm.RequestRefresh();

        Assert.False(invoked);
        Assert.Empty(captured);
    }

    [Fact]
    public void RequestRefresh_is_suppressed_while_a_refresh_is_already_in_flight()
    {
        var refresher = new FakeRefresher();
        var vm = new StickyCompactHeroViewModel(Passthrough, refresher: refresher, initialRefreshing: true);

        bool invoked = vm.RequestRefresh();

        Assert.False(invoked);
        Assert.Equal(0, refresher.RefreshCount);
    }

    // ── view-model: view.opened (web component mount) ────────────────────────────────────────────────────

    [Fact]
    public void MarkOpened_records_the_view_opened_event_once()
    {
        var captured = new List<string>();
        var vm = new StickyCompactHeroViewModel(Passthrough, diagnostics: new StickyCompactHeroDiagnostics(captured.Add));

        vm.MarkOpened();
        vm.MarkOpened();

        Assert.Equal("view.opened slug=StickyCompactHero", Assert.Single(captured));
    }

    // ── NullStickyHeroScroller: inert seam ───────────────────────────────────────────────────────────────

    [Fact]
    public void NullStickyHeroScroller_is_a_safe_no_op_singleton()
    {
        IStickyHeroScroller scroller = NullStickyHeroScroller.Instance;

        Assert.Same(NullStickyHeroScroller.Instance, scroller);
        Assert.Null(Record.Exception(scroller.ScrollToTop));
    }

    // ── diagnostics (P1/S11): slug-only operational counters, never status text ──────────────────────────

    [Fact]
    public void Diagnostics_count_and_emit_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new StickyCompactHeroDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordScrollToTop();
        diagnostics.RecordRefresh();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.ScrollToTops);
        Assert.Equal(1, diagnostics.Refreshes);
        string[] expected =
        [
            "view.opened slug=StickyCompactHero",
            "stickyHero.scrollToTop slug=StickyCompactHero",
            "stickyHero.refresh slug=StickyCompactHero",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Diagnostics_never_leak_the_status_headline_text()
    {
        var captured = new List<string>();
        var refresher = new FakeRefresher();
        var vm = new StickyCompactHeroViewModel(
            Passthrough, new FakeScroller(), refresher, new StickyCompactHeroDiagnostics(captured.Add),
            initialStatus: HealthStatus.Unhealthy);

        vm.MarkOpened();
        vm.RequestScrollToTop();
        vm.RequestRefresh();

        Assert.NotEmpty(captured);
        Assert.All(captured, line => Assert.DoesNotContain("Outage", line, StringComparison.Ordinal));
        Assert.All(captured, line => Assert.EndsWith("slug=StickyCompactHero", line, StringComparison.Ordinal));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count()
    {
        var diagnostics = new StickyCompactHeroDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordScrollToTop();
        diagnostics.RecordScrollToTop();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(2, diagnostics.ScrollToTops);
    }

    // ── helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static NotificationCounter Subscribe(StickyCompactHeroViewModel vm) => new(vm);

    private sealed class NotificationCounter
    {
        public NotificationCounter(StickyCompactHeroViewModel vm) => vm.PropertyChanged += (_, _) => Count++;

        public int Count { get; private set; }
    }

    private sealed class FakeScroller : IStickyHeroScroller
    {
        public int ScrollToTopCount { get; private set; }

        public void ScrollToTop() => ScrollToTopCount++;
    }

    private sealed class FakeRefresher : IStickyHeroRefresher
    {
        public int RefreshCount { get; private set; }

        public void Refresh() => RefreshCount++;
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
