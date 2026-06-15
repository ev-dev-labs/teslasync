using System.Linq;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SystemOps;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>RoadmapPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/RoadmapPage.tsx), the static curated roadmap catalog, the success data state
/// (plus the defensive empty branch), the per-phase grouping, the always-visible phase progress bar summaries,
/// the per-card icon→glyph / accent-token / badge mapping and the view-model's local-state load flow. The WinUI
/// view is exercised by the app build; its per-region content is driven entirely by the
/// <see cref="RoadmapDisplay"/> projection asserted here.
/// </summary>
public sealed class RoadmapPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The two i18n keys the manifest requires the page to resolve (PARITY_REQUIRED strings).
    private static readonly string[] RequiredStringKeys =
    [
        "roadmap.subtitle",
        "roadmap.title",
    ];

    private static RoadmapModel Model(IReadOnlyList<RoadmapEntry>? catalog = null) =>
        new(catalog ?? RoadmapCatalog.Default);

    // ---- i18n key coverage ---------------------------------------------------------

    [Fact]
    public void Manifest_requires_two_strings()
    {
        Assert.Equal(2, RequiredStringKeys.Length);
        Assert.Equal(RequiredStringKeys.Length, RequiredStringKeys.Distinct().Count());
    }

    [Fact]
    public void Projection_resolves_roadmap_title_and_subtitle()
    {
        var recorder = new RecordingLocalizer();

        _ = RoadmapProjection.Project(Model(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_every_phase_label_key()
    {
        var recorder = new RecordingLocalizer();

        _ = RoadmapProjection.Project(Model(), recorder);

        Assert.Contains("roadmap.phase.done", recorder.Keys);
        Assert.Contains("roadmap.phase.current", recorder.Keys);
        Assert.Contains("roadmap.phase.next", recorder.Keys);
        Assert.Contains("roadmap.phase.future", recorder.Keys);
    }

    [Fact]
    public void Title_and_subtitle_resolve_the_web_defaults()
    {
        var display = RoadmapProjection.Project(Model(), Localizer);

        Assert.Equal("Roadmap", display.Title);
        Assert.Equal("Roadmap", display.DocumentTitle);
        Assert.Equal(
            "What's been built, what's in progress, and what's coming next",
            display.Subtitle);
    }

    // ---- data state (manifest: empty + success) ------------------------------------

    [Fact]
    public void Default_catalog_projects_success_state()
    {
        var display = RoadmapProjection.Project(Model(), Localizer);
        Assert.Equal(RoadmapState.Success, display.State);
    }

    [Fact]
    public void Empty_catalog_projects_the_defensive_empty_state()
    {
        var display = RoadmapProjection.Project(Model([]), Localizer);

        Assert.Equal(RoadmapState.Empty, display.State);
        Assert.Empty(display.Groups);
    }

    [Fact]
    public void Empty_catalog_still_exposes_all_four_zeroed_phase_summaries()
    {
        // GlassPanel1 (the phase progress bar) is always visible — never a blank region (ADR-011).
        var display = RoadmapProjection.Project(Model([]), Localizer);

        Assert.Equal(4, display.PhaseSummaries.Count);
        Assert.All(display.PhaseSummaries, s => Assert.Equal(0, s.Count));
    }

    // ---- catalog + phase grouping (GlassPanel2) ------------------------------------

    [Fact]
    public void Catalog_is_the_seventeen_web_entries()
    {
        Assert.Equal(17, RoadmapCatalog.Default.Count);
    }

    [Fact]
    public void Phase_order_matches_the_web_render_order()
    {
        Assert.Equal(
            new[] { RoadmapPhase.Done, RoadmapPhase.Current, RoadmapPhase.Next, RoadmapPhase.Future },
            RoadmapProjection.PhaseOrder.ToArray());
    }

    [Theory]
    [InlineData(RoadmapPhase.Done, 5)]
    [InlineData(RoadmapPhase.Current, 1)]
    [InlineData(RoadmapPhase.Next, 2)]
    [InlineData(RoadmapPhase.Future, 9)]
    public void Each_phase_has_the_web_entry_count(RoadmapPhase phase, int expected)
    {
        var count = RoadmapCatalog.Default.Count(e => e.Phase == phase);
        Assert.Equal(expected, count);
    }

    [Fact]
    public void Progress_bar_summaries_cover_every_phase_in_order_with_counts()
    {
        var display = RoadmapProjection.Project(Model(), Localizer);

        Assert.Collection(
            display.PhaseSummaries,
            s => AssertSummary(s, RoadmapPhase.Done, "Completed", StatusKind.Success, 5),
            s => AssertSummary(s, RoadmapPhase.Current, "In Progress", StatusKind.Info, 1),
            s => AssertSummary(s, RoadmapPhase.Next, "Up Next", StatusKind.Warning, 2),
            s => AssertSummary(s, RoadmapPhase.Future, "Future", StatusKind.Danger, 9));
    }

    [Fact]
    public void Groups_render_each_non_empty_phase_in_order()
    {
        var display = RoadmapProjection.Project(Model(), Localizer);

        Assert.Collection(
            display.Groups,
            g => Assert.Equal(RoadmapPhase.Done, g.Phase),
            g => Assert.Equal(RoadmapPhase.Current, g.Phase),
            g => Assert.Equal(RoadmapPhase.Next, g.Phase),
            g => Assert.Equal(RoadmapPhase.Future, g.Phase));
    }

    [Fact]
    public void Group_item_counts_match_the_catalog()
    {
        var display = RoadmapProjection.Project(Model(), Localizer);
        var total = display.Groups.Sum(g => g.Items.Count);

        Assert.Equal(RoadmapCatalog.Default.Count, total);
    }

    [Fact]
    public void First_done_card_carries_the_web_content_and_accent()
    {
        var display = RoadmapProjection.Project(Model(), Localizer);
        var card = display.Groups[0].Items[0];

        Assert.Equal("Core Platform", card.Title);
        Assert.Equal("Real-time fleet monitoring, analytics, and vehicle control", card.Description);
        Assert.Equal(RoadmapPhase.Done, card.Phase);
        Assert.Equal("Completed", card.PhaseLabel);
        Assert.Equal(StatusKind.Success, card.BadgeStatus);
        Assert.Equal("TsChartBatteryBrush", card.AccentBrushKey);
        Assert.Equal(RoadmapProjection.Glyph(RoadmapIcon.Rocket), card.Glyph);
        Assert.Equal($"{card.Title}. {card.Description}", card.AutomationName);
        Assert.Equal(11, card.Features.Count);
    }

    [Fact]
    public void Every_feature_row_is_projected_with_the_phase_bullet_glyph()
    {
        var display = RoadmapProjection.Project(Model(), Localizer);

        var totalFeatures = 0;
        foreach (var group in display.Groups)
        {
            var expectedBullet = RoadmapProjection.BulletGlyph(group.Phase);
            foreach (var item in group.Items)
            {
                Assert.NotEmpty(item.Features);
                Assert.All(item.Features, f => Assert.Equal(expectedBullet, f.BulletGlyph));
                totalFeatures += item.Features.Count;
            }
        }

        Assert.Equal(125, totalFeatures);
    }

    // ---- phase → token / status / glyph mapping ------------------------------------

    [Theory]
    [InlineData(RoadmapPhase.Done, "TsChartBatteryBrush", StatusKind.Success)]
    [InlineData(RoadmapPhase.Current, "TsColorInfoBrush", StatusKind.Info)]
    [InlineData(RoadmapPhase.Next, "TsChartPowerBrush", StatusKind.Warning)]
    [InlineData(RoadmapPhase.Future, "TsChartEnergyBrush", StatusKind.Danger)]
    public void Phase_maps_to_its_accent_token_and_badge_status(RoadmapPhase phase, string accentKey, StatusKind status)
    {
        Assert.Equal(accentKey, RoadmapProjection.AccentBrushKey(phase));
        Assert.Equal(status, RoadmapProjection.BadgeStatus(phase));
    }

    [Theory]
    [InlineData(RoadmapPhase.Done, "Completed")]
    [InlineData(RoadmapPhase.Current, "In Progress")]
    [InlineData(RoadmapPhase.Next, "Up Next")]
    [InlineData(RoadmapPhase.Future, "Future")]
    public void Phase_labels_resolve_the_web_fallbacks(RoadmapPhase phase, string expected)
    {
        Assert.Equal(expected, RoadmapProjection.PhaseLabel(phase, Localizer));
    }

    [Theory]
    [InlineData(RoadmapPhase.Done, "\uE930")]
    [InlineData(RoadmapPhase.Current, "\uE945")]
    [InlineData(RoadmapPhase.Next, "\uE823")]
    [InlineData(RoadmapPhase.Future, "\uE823")]
    public void Feature_bullet_glyph_is_keyed_by_phase(RoadmapPhase phase, string glyph)
    {
        Assert.Equal(glyph, RoadmapProjection.BulletGlyph(phase));
    }

    [Theory]
    [InlineData(RoadmapIcon.Rocket, "\uE945")]
    [InlineData(RoadmapIcon.Bell, "\uEA8F")]
    [InlineData(RoadmapIcon.Brain, "\uEA80")]
    [InlineData(RoadmapIcon.Zap, "\uE704")]
    [InlineData(RoadmapIcon.Star, "\uE734")]
    [InlineData(RoadmapIcon.Plug, "\uE945")]
    [InlineData(RoadmapIcon.Cloud, "\uE753")]
    [InlineData(RoadmapIcon.Smartphone, "\uE8EA")]
    [InlineData(RoadmapIcon.BarChart, "\uE9D9")]
    [InlineData(RoadmapIcon.Map, "\uE81E")]
    [InlineData(RoadmapIcon.Shield, "\uEA18")]
    [InlineData(RoadmapIcon.Leaf, "\uE909")]
    [InlineData(RoadmapIcon.Users, "\uE716")]
    [InlineData(RoadmapIcon.Wrench, "\uE90F")]
    [InlineData(RoadmapIcon.Globe, "\uE774")]
    public void Each_icon_maps_to_its_glyph(RoadmapIcon icon, string glyph)
    {
        Assert.Equal(glyph, RoadmapProjection.Glyph(icon));
    }

    // ---- view-model flow -----------------------------------------------------------

    [Fact]
    public async Task ViewModel_default_catalog_is_success_with_all_phase_groups()
    {
        var vm = new RoadmapPageViewModel(Localizer);

        await vm.LoadAsync();

        Assert.Equal(RoadmapState.Success, vm.State);
        Assert.True(vm.HasItems);
        Assert.Equal(4, vm.Groups.Count);
        Assert.Equal(4, vm.PhaseSummaries.Count);
        Assert.Equal("Roadmap", vm.Title);
        Assert.Equal(
            "What's been built, what's in progress, and what's coming next",
            vm.Subtitle);
    }

    [Fact]
    public async Task ViewModel_empty_catalog_degrades_to_empty_with_message()
    {
        var vm = new RoadmapPageViewModel(Localizer, []);

        await vm.RefreshAsync();

        Assert.Equal(RoadmapState.Empty, vm.State);
        Assert.False(vm.HasItems);
        Assert.Empty(vm.Groups);
        Assert.Equal(4, vm.PhaseSummaries.Count);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void ViewModel_reload_reprojects_without_throwing()
    {
        var vm = new RoadmapPageViewModel(Localizer);
        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.Reload();

        Assert.Equal(4, vm.Groups.Count);
        Assert.True(raised);
    }

    // ---- registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_name_slug_and_keys()
    {
        Assert.Equal("Roadmap", RoadmapRegistration.RouteName);
        Assert.Equal("RoadmapPage", RoadmapRegistration.Slug);
        Assert.Equal("Roadmap", RoadmapRegistration.Title(Localizer));
        Assert.Equal("roadmap.title", RoadmapRegistration.TitleKey);
        Assert.Equal("roadmap.subtitle", RoadmapRegistration.SubtitleKey);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        string? captured = null;
        var diagnostics = new RoadmapDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RoadmapPage", captured);
    }

    [Fact]
    public void ViewModel_notify_opened_records_through_diagnostics()
    {
        string? captured = null;
        var diagnostics = new RoadmapDiagnostics(line => captured = line);
        var vm = new RoadmapPageViewModel(Localizer, diagnostics: diagnostics);

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=RoadmapPage", captured);
    }

    // ---- helpers -------------------------------------------------------------------

    private static void AssertSummary(
        RoadmapPhaseSummary summary,
        RoadmapPhase phase,
        string label,
        StatusKind status,
        int count)
    {
        Assert.Equal(phase, summary.Phase);
        Assert.Equal(label, summary.Label);
        Assert.Equal(status, summary.BadgeStatus);
        Assert.Equal(count, summary.Count);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
