using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>QuickLinksSection</c> feature surface's UI-thread-free logic — the canonical
/// quick-link list (the web <c>quickLinks</c>), the item-source → projection adapter, the Ready/Empty state
/// branches, the responsive column breakpoints (web <c>grid-cols-2 sm:grid-cols-3 lg:grid-cols-6</c>), the
/// localized title + labels + i18n key set, the per-tile Narrator names, and the PII-safe diagnostics. Mirrors
/// the web spec (web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx). The WinUI view
/// itself (feature-views\QuickLinksSection\QuickLinksSection.cs) is exercised by the app build.
/// </summary>
public sealed class QuickLinksSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static QuickLinksDisplay ProjectCanonical(ILocalizer? localizer = null) =>
        QuickLinksProjection.Project(new QuickLinksItemSource().GetItems(), localizer ?? Localizer);

    // ── Adapter: the canonical source projects to the six web tiles, in order ─────────────────────────

    [Fact]
    public void Canonical_source_exposes_the_six_web_quick_links_in_order()
    {
        var items = new QuickLinksItemSource().GetItems();

        Assert.Equal(6, items.Count);
        Assert.Collection(
            items,
            i => Assert.Equal("Drives", i.RouteName),
            i => Assert.Equal("Charging", i.RouteName),
            i => Assert.Equal("BatteryHealth", i.RouteName),
            i => Assert.Equal("ClimateControl", i.RouteName),
            i => Assert.Equal("Efficiency", i.RouteName),
            i => Assert.Equal("Settings", i.RouteName));
    }

    [Fact]
    public void Projection_maps_every_catalog_field_onto_the_tile()
    {
        var tiles = ProjectCanonical().Tiles;

        Assert.Collection(
            tiles,
            t =>
            {
                Assert.Equal("Drives", t.RouteName);
                Assert.Equal("\uE7C0", t.Glyph);
                Assert.Equal("Drives", t.Label);
            },
            t =>
            {
                Assert.Equal("Charging", t.RouteName);
                Assert.Equal("\uE945", t.Glyph);
                Assert.Equal("Charging", t.Label);
            },
            t =>
            {
                Assert.Equal("BatteryHealth", t.RouteName);
                Assert.Equal("\uE83E", t.Glyph);
                Assert.Equal("Battery", t.Label);
            },
            t =>
            {
                Assert.Equal("ClimateControl", t.RouteName);
                Assert.Equal("\uE9CA", t.Glyph);
                Assert.Equal("Climate", t.Label);
            },
            t =>
            {
                Assert.Equal("Efficiency", t.RouteName);
                Assert.Equal("\uE9D2", t.Glyph);
                Assert.Equal("Efficiency", t.Label);
            },
            t =>
            {
                Assert.Equal("Settings", t.RouteName);
                Assert.Equal("\uE713", t.Glyph);
                Assert.Equal("Settings", t.Label);
            });
    }

    // ── Per-state "snapshot": Ready (the web grid) vs the defensive Empty branch ──────────────────────

    [Fact]
    public void Canonical_list_renders_the_ready_grid_state()
    {
        var display = ProjectCanonical();

        Assert.Equal(QuickLinksState.Ready, display.State);
        Assert.True(display.HasTiles);
        Assert.Equal(6, display.Tiles.Count);
    }

    [Fact]
    public void Empty_list_renders_the_empty_state_never_a_blank_box()
    {
        var display = QuickLinksProjection.Project(Array.Empty<QuickLinkItem>(), Localizer);

        Assert.Equal(QuickLinksState.Empty, display.State);
        Assert.False(display.HasTiles);
        Assert.Empty(display.Tiles);
    }

    [Fact]
    public void Empty_state_message_resolves_through_the_localizer()
    {
        Assert.Equal("No quick links available", QuickLinksRegistration.EmptyMessage(Localizer));
    }

    [Fact]
    public void Title_is_projected_and_resolves_through_the_localizer()
    {
        Assert.Equal("Quick Links", ProjectCanonical().Title);
        Assert.Equal("Quick Links", QuickLinksRegistration.Title(Localizer));
    }

    // ── Responsive columns (web grid-cols-2 sm:grid-cols-3 lg:grid-cols-6, sm == 640px, lg == 1024px) ─

    [Theory]
    [InlineData(0, 2)]
    [InlineData(320, 2)]
    [InlineData(639, 2)]
    [InlineData(640, 3)]
    [InlineData(641, 3)]
    [InlineData(1023, 3)]
    [InlineData(1024, 6)]
    [InlineData(1280, 6)]
    public void Columns_switch_two_three_six_at_the_sm_and_lg_breakpoints(double width, int expected)
    {
        Assert.Equal(expected, QuickLinksLayout.ColumnsForWidth(width));
    }

    [Fact]
    public void Columns_default_to_narrow_for_an_unmeasured_surface()
    {
        Assert.Equal(QuickLinksLayout.NarrowColumns, QuickLinksLayout.ColumnsForWidth(double.NaN));
    }

    // ── i18n: every key from the web source resolves with the same English default (P1/S10 catalog) ──

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        QuickLinksProjection.Project(new QuickLinksItemSource().GetItems(), recorder);
        QuickLinksRegistration.EmptyMessage(recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["nav.drives"] = "Drives",
            ["nav.charging"] = "Charging",
            ["nav.battery"] = "Battery",
            ["nav.climate"] = "Climate",
            ["nav.efficiency"] = "Efficiency",
            ["nav.settings"] = "Settings",
            ["vehicles.detail.quickLinks"] = "Quick Links",
            ["vehicles.detail.quickLinks.noData"] = "No quick links available",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    [Fact]
    public void Labels_and_title_flow_through_the_localizer_verbatim_with_no_hardcoded_english()
    {
        // A non-ASCII translation must pass through to every tile label and the title so the surface contributes
        // no hardcoded English of its own — the only copy is the keyed nav.* / vehicles.detail.* strings.
        var fake = new RecordingLocalizer(translation: "クイック");

        var display = QuickLinksProjection.Project(new QuickLinksItemSource().GetItems(), fake);

        Assert.Equal("クイック", display.Title);
        Assert.All(display.Tiles, t => Assert.Equal("クイック", t.Label));
    }

    // ── Accessibility: every tile exposes its label as the Narrator name ──────────────────────────────

    [Fact]
    public void Every_tile_exposes_its_label_as_the_automation_name()
    {
        var tiles = ProjectCanonical().Tiles;

        Assert.All(tiles, t => Assert.False(string.IsNullOrWhiteSpace(t.AutomationName)));
        Assert.All(tiles, t => Assert.Equal(t.Label, t.AutomationName));
        Assert.Collection(
            tiles,
            t => Assert.Equal("Drives", t.AutomationName),
            t => Assert.Equal("Charging", t.AutomationName),
            t => Assert.Equal("Battery", t.AutomationName),
            t => Assert.Equal("Climate", t.AutomationName),
            t => Assert.Equal("Efficiency", t.AutomationName),
            t => Assert.Equal("Settings", t.AutomationName));
    }

    // ── Diagnostics (P1/S11): view.opened + navigation, PII-safe ─────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new QuickLinksDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=QuickLinksSection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_records_navigation_without_leaking_the_route()
    {
        var captured = new List<string>();
        var diagnostics = new QuickLinksDiagnostics(captured.Add);

        diagnostics.RecordNavigated();

        Assert.Equal(1, diagnostics.Navigations);
        Assert.Equal("quick-links.activated slug=QuickLinksSection", Assert.Single(captured));
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_stable_slug_title_and_empty_copy()
    {
        Assert.Equal("QuickLinksSection", QuickLinksRegistration.Slug);
        Assert.Equal("vehicles.detail.quickLinks", QuickLinksRegistration.TitleKey);
        Assert.Equal("Quick Links", QuickLinksRegistration.TitleFallback);
        Assert.Equal("vehicles.detail.quickLinks.noData", QuickLinksRegistration.EmptyMessageKey);
        Assert.Equal("No quick links available", QuickLinksRegistration.EmptyMessageFallback);
    }

    [Fact]
    public void Canonical_list_uses_the_route_table_glyphs()
    {
        Assert.Collection(
            QuickLinksRegistration.Canonical,
            i => Assert.Equal(("Drives", "\uE7C0"), (i.RouteName, i.Glyph)),
            i => Assert.Equal(("Charging", "\uE945"), (i.RouteName, i.Glyph)),
            i => Assert.Equal(("BatteryHealth", "\uE83E"), (i.RouteName, i.Glyph)),
            i => Assert.Equal(("ClimateControl", "\uE9CA"), (i.RouteName, i.Glyph)),
            i => Assert.Equal(("Efficiency", "\uE9D2"), (i.RouteName, i.Glyph)),
            i => Assert.Equal(("Settings", "\uE713"), (i.RouteName, i.Glyph)));
    }

    [Fact]
    public void Chevron_glyph_matches_the_web_chevron_right()
    {
        Assert.Equal("\uE76C", QuickLinksProjection.ChevronGlyph);
    }

    // ── Null-argument guards ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_item_list()
    {
        Assert.Throws<ArgumentNullException>(() => QuickLinksProjection.Project(null!, Localizer));
    }

    [Fact]
    public void Project_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() =>
            QuickLinksProjection.Project(new QuickLinksItemSource().GetItems(), null!));
    }

    [Fact]
    public void Registration_helpers_reject_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => QuickLinksRegistration.Title(null!));
        Assert.Throws<ArgumentNullException>(() => QuickLinksRegistration.EmptyMessage(null!));
    }

    /// <summary>An <see cref="ILocalizer"/> that returns the fallback (or a fixed translation) and records each
    /// requested key so the keyed call sites are asserted headlessly.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly string? _override;

        public RecordingLocalizer(string? translation = null) => _override = translation;

        public Dictionary<string, string> Requested { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Requested[key] = fallback;
            return _override ?? fallback;
        }
    }
}
