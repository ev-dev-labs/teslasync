using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>QuickNav</c> feature surface's UI-thread-free logic — the canonical
/// navigation catalog (the web <c>NAV_ITEMS</c>), the item-source → projection adapter, the Ready/Empty
/// state branches, the responsive column breakpoint (web <c>grid-cols-2 sm:grid-cols-4</c>), the localized
/// labels + i18n key set, the per-tile Narrator names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/components/QuickNav.tsx). The WinUI view itself
/// (feature-views\QuickNav\QuickNav.cs) is exercised by the app build.
/// </summary>
public sealed class QuickNavTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static QuickNavDisplay ProjectCanonical(ILocalizer? localizer = null) =>
        QuickNavProjection.Project(new QuickNavItemSource().GetItems(), localizer ?? Localizer);

    // ── Adapter: the canonical source projects to the four web tiles, in order ───────────────────────

    [Fact]
    public void Canonical_source_exposes_the_four_web_nav_items_in_order()
    {
        var items = new QuickNavItemSource().GetItems();

        Assert.Equal(4, items.Count);
        Assert.Collection(
            items,
            i => Assert.Equal("Drives", i.RouteName),
            i => Assert.Equal("Charging", i.RouteName),
            i => Assert.Equal("Analytics", i.RouteName),
            i => Assert.Equal("BatteryHealth", i.RouteName));
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
                Assert.Equal("TsColorInfoBrush", t.AccentBrushKey);
                Assert.Equal("Drives", t.Label);
                Assert.Equal("Trip history", t.Description);
            },
            t =>
            {
                Assert.Equal("Charging", t.RouteName);
                Assert.Equal("\uE945", t.Glyph);
                Assert.Equal("TsColorSuccessBrush", t.AccentBrushKey);
                Assert.Equal("Charging", t.Label);
                Assert.Equal("Sessions & costs", t.Description);
            },
            t =>
            {
                Assert.Equal("Analytics", t.RouteName);
                Assert.Equal("\uE9D9", t.Glyph);
                Assert.Equal("TsColorAccentBrush", t.AccentBrushKey);
                Assert.Equal("Analytics", t.Label);
                Assert.Equal("Fleet insights", t.Description);
            },
            t =>
            {
                Assert.Equal("BatteryHealth", t.RouteName);
                Assert.Equal("\uE83E", t.Glyph);
                Assert.Equal("TsColorWarningBrush", t.AccentBrushKey);
                Assert.Equal("Battery", t.Label);
                Assert.Equal("Health & degradation", t.Description);
            });
    }

    // ── Per-state "snapshot": Ready (the web grid) vs the defensive Empty branch ──────────────────────

    [Fact]
    public void Canonical_catalog_renders_the_ready_grid_state()
    {
        var display = ProjectCanonical();

        Assert.Equal(QuickNavState.Ready, display.State);
        Assert.True(display.HasTiles);
        Assert.Equal(4, display.Tiles.Count);
    }

    [Fact]
    public void Empty_catalog_renders_the_empty_state_never_a_blank_box()
    {
        var display = QuickNavProjection.Project(Array.Empty<QuickNavItem>(), Localizer);

        Assert.Equal(QuickNavState.Empty, display.State);
        Assert.False(display.HasTiles);
        Assert.Empty(display.Tiles);
    }

    [Fact]
    public void Empty_state_message_resolves_through_the_localizer()
    {
        Assert.Equal("No navigation links available", QuickNavRegistration.EmptyMessage(Localizer));
    }

    // ── Responsive columns (web `grid-cols-2 sm:grid-cols-4`, sm == 640px) ───────────────────────────

    [Theory]
    [InlineData(0, 2)]
    [InlineData(320, 2)]
    [InlineData(639, 2)]
    [InlineData(640, 4)]
    [InlineData(641, 4)]
    [InlineData(1280, 4)]
    public void Columns_switch_two_to_four_at_the_sm_breakpoint(double width, int expected)
    {
        Assert.Equal(expected, QuickNavLayout.ColumnsForWidth(width));
    }

    [Fact]
    public void Columns_default_to_narrow_for_an_unmeasured_surface()
    {
        Assert.Equal(QuickNavLayout.NarrowColumns, QuickNavLayout.ColumnsForWidth(double.NaN));
    }

    // ── i18n: every key from the web source resolves with the same English default (P1/S10 catalog) ──

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        QuickNavProjection.Project(new QuickNavItemSource().GetItems(), recorder);
        QuickNavRegistration.EmptyMessage(recorder);
        QuickNavRegistration.GroupName(recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["nav.drives"] = "Drives",
            ["nav.drivesDesc"] = "Trip history",
            ["nav.charging"] = "Charging",
            ["nav.chargingDesc"] = "Sessions & costs",
            ["nav.analytics"] = "Analytics",
            ["nav.analyticsDesc"] = "Fleet insights",
            ["nav.battery"] = "Battery",
            ["nav.batteryDesc"] = "Health & degradation",
            ["widget.quickNav.noData"] = "No navigation links available",
            ["widget.quickNav.title"] = "Quick Navigation",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    [Fact]
    public void Labels_flow_through_the_localizer_verbatim_with_no_hardcoded_english()
    {
        // A non-ASCII translation must pass through to the tile label so the surface contributes no
        // hardcoded English of its own — the only copy is the keyed nav.* strings.
        var fake = new RecordingLocalizer(translation: "ナビ");

        var tiles = QuickNavProjection.Project(new QuickNavItemSource().GetItems(), fake).Tiles;

        Assert.All(tiles, t => Assert.Equal("ナビ", t.Label));
        Assert.All(tiles, t => Assert.Equal("ナビ", t.Description));
    }

    // ── Accessibility: every tile exposes a descriptive (label + description) Narrator name ───────────

    [Fact]
    public void Every_tile_exposes_a_label_and_description_automation_name()
    {
        var tiles = ProjectCanonical().Tiles;

        Assert.All(tiles, t => Assert.False(string.IsNullOrWhiteSpace(t.AutomationName)));
        Assert.Collection(
            tiles,
            t => Assert.Equal("Drives, Trip history", t.AutomationName),
            t => Assert.Equal("Charging, Sessions & costs", t.AutomationName),
            t => Assert.Equal("Analytics, Fleet insights", t.AutomationName),
            t => Assert.Equal("Battery, Health & degradation", t.AutomationName));
    }

    [Fact]
    public void Surface_group_name_resolves_through_the_localizer()
    {
        Assert.Equal("Quick Navigation", QuickNavRegistration.GroupName(Localizer));
    }

    // ── Diagnostics (P1/S11): view.opened + navigation, PII-safe ─────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new QuickNavDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=QuickNav", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_records_navigation_without_leaking_the_route()
    {
        var captured = new List<string>();
        var diagnostics = new QuickNavDiagnostics(captured.Add);

        diagnostics.RecordNavigated();

        Assert.Equal(1, diagnostics.Navigations);
        Assert.Equal("quick-nav.activated slug=QuickNav", Assert.Single(captured));
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_stable_slug_and_empty_copy()
    {
        Assert.Equal("QuickNav", QuickNavRegistration.Slug);
        Assert.Equal("widget.quickNav.noData", QuickNavRegistration.EmptyMessageKey);
        Assert.Equal("No navigation links available", QuickNavRegistration.EmptyMessageFallback);
        Assert.Equal("widget.quickNav.title", QuickNavRegistration.GroupNameKey);
        Assert.Equal("Quick Navigation", QuickNavRegistration.GroupNameFallback);
    }

    [Fact]
    public void Canonical_catalog_uses_the_route_table_glyphs_and_accent_tokens()
    {
        Assert.Collection(
            QuickNavRegistration.Canonical,
            i => Assert.Equal(("Drives", "\uE7C0", "TsColorInfoBrush"), (i.RouteName, i.Glyph, i.AccentBrushKey)),
            i => Assert.Equal(("Charging", "\uE945", "TsColorSuccessBrush"), (i.RouteName, i.Glyph, i.AccentBrushKey)),
            i => Assert.Equal(("Analytics", "\uE9D9", "TsColorAccentBrush"), (i.RouteName, i.Glyph, i.AccentBrushKey)),
            i => Assert.Equal(("BatteryHealth", "\uE83E", "TsColorWarningBrush"), (i.RouteName, i.Glyph, i.AccentBrushKey)));
    }

    [Fact]
    public void Chevron_glyph_matches_the_web_chevron_right()
    {
        Assert.Equal("\uE76C", QuickNavProjection.ChevronGlyph);
    }

    // ── Null-argument guards ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_item_list()
    {
        Assert.Throws<ArgumentNullException>(() => QuickNavProjection.Project(null!, Localizer));
    }

    [Fact]
    public void Project_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() =>
            QuickNavProjection.Project(new QuickNavItemSource().GetItems(), null!));
    }

    [Fact]
    public void Registration_helpers_reject_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => QuickNavRegistration.EmptyMessage(null!));
        Assert.Throws<ArgumentNullException>(() => QuickNavRegistration.GroupName(null!));
    }

    /// <summary>An <see cref="ILocalizer"/> that returns the fallback (or a fixed translation) and records
    /// each requested key so the keyed call sites are asserted headlessly.</summary>
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
