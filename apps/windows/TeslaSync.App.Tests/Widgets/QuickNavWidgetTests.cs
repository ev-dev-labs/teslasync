using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the QuickNavWidget's UI-thread-free logic — the canonical navigation catalog
/// (web <c>NAV_ITEMS</c>), the projection (tiles, responsive columns, i18n labels, a11y names), the
/// registry metadata + footprint bounds, the diagnostics, and the state-holder view-model's per-state
/// transitions (ready / empty), navigation forwarding, and size-driven re-projection. Mirrors the web spec
/// (web/src/features/dashboard/widgets/QuickNavWidget.tsx delegating to
/// web/src/features/dashboard/components/QuickNav.tsx).
/// </summary>
public sealed class QuickNavWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static QuickNavViewModel NewViewModel(
        IQuickNavItemSource? source = null,
        IQuickNavNavigator? navigator = null,
        QuickNavSize? size = null) =>
        new(
            source ?? new QuickNavItemSource(),
            navigator ?? new RecordingNavigator(),
            Localizer,
            size ?? QuickNavRegistration.DefaultSize);

    // ---- Canonical catalog (web NAV_ITEMS parity) ----------------------------------

    [Fact]
    public void Catalog_has_four_entries_in_web_order()
    {
        var routes = QuickNavItemSource.Canonical.Select(i => i.RouteName).ToArray();
        Assert.Equal(new[] { "Drives", "Charging", "Analytics", "BatteryHealth" }, routes);
    }

    [Fact]
    public void Catalog_label_and_description_keys_match_web()
    {
        var byRoute = QuickNavItemSource.Canonical.ToDictionary(i => i.RouteName);

        Assert.Equal("nav.drives", byRoute["Drives"].LabelKey);
        Assert.Equal("nav.drivesDesc", byRoute["Drives"].DescriptionKey);
        Assert.Equal("nav.charging", byRoute["Charging"].LabelKey);
        Assert.Equal("nav.chargingDesc", byRoute["Charging"].DescriptionKey);
        Assert.Equal("nav.analytics", byRoute["Analytics"].LabelKey);
        Assert.Equal("nav.analyticsDesc", byRoute["Analytics"].DescriptionKey);
        Assert.Equal("nav.battery", byRoute["BatteryHealth"].LabelKey);
        Assert.Equal("nav.batteryDesc", byRoute["BatteryHealth"].DescriptionKey);
    }

    [Fact]
    public void Catalog_english_fallbacks_match_web()
    {
        var byRoute = QuickNavItemSource.Canonical.ToDictionary(i => i.RouteName);

        Assert.Equal("Drives", byRoute["Drives"].LabelFallback);
        Assert.Equal("Trip history", byRoute["Drives"].DescriptionFallback);
        Assert.Equal("Charging", byRoute["Charging"].LabelFallback);
        Assert.Equal("Sessions & costs", byRoute["Charging"].DescriptionFallback);
        Assert.Equal("Analytics", byRoute["Analytics"].LabelFallback);
        Assert.Equal("Fleet insights", byRoute["Analytics"].DescriptionFallback);
        Assert.Equal("Battery", byRoute["BatteryHealth"].LabelFallback);
        Assert.Equal("Health & degradation", byRoute["BatteryHealth"].DescriptionFallback);
    }

    [Theory]
    [InlineData("Drives", "TsColorInfoBrush")]
    [InlineData("Charging", "TsColorSuccessBrush")]
    [InlineData("Analytics", "TsColorAccentBrush")]
    [InlineData("BatteryHealth", "TsColorWarningBrush")]
    public void Catalog_accent_tokens_map_web_colors(string route, string token) =>
        Assert.Equal(token, QuickNavItemSource.Canonical.Single(i => i.RouteName == route).AccentBrushKey);

    [Fact]
    public void Catalog_accents_use_semantic_tokens_not_neon()
    {
        foreach (var item in QuickNavItemSource.Canonical)
        {
            Assert.StartsWith("TsColor", item.AccentBrushKey, StringComparison.Ordinal);
            Assert.EndsWith("Brush", item.AccentBrushKey, StringComparison.Ordinal);
            Assert.DoesNotContain("neon", item.AccentBrushKey, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void Catalog_glyphs_are_non_empty()
    {
        foreach (var item in QuickNavItemSource.Canonical)
        {
            Assert.False(string.IsNullOrEmpty(item.Glyph));
        }
    }

    // ---- Projection adapter --------------------------------------------------------

    [Fact]
    public void Project_produces_a_tile_per_catalog_entry_in_order()
    {
        var display = QuickNavProjection.Project(QuickNavItemSource.Canonical, QuickNavRegistration.DefaultSize, Localizer);

        Assert.Equal(4, display.Tiles.Count);
        Assert.Equal(
            new[] { "Drives", "Charging", "Analytics", "BatteryHealth" },
            display.Tiles.Select(t => t.RouteName).ToArray());
    }

    [Fact]
    public void Project_resolves_labels_and_descriptions_through_localizer()
    {
        var display = QuickNavProjection.Project(QuickNavItemSource.Canonical, QuickNavRegistration.DefaultSize, Localizer);
        var drives = display.Tiles[0];

        Assert.Equal("Drives", drives.Label);
        Assert.Equal("Trip history", drives.Description);
    }

    [Fact]
    public void Project_uses_resolved_label_keys_when_localizer_translates()
    {
        var display = QuickNavProjection.Project(QuickNavItemSource.Canonical, QuickNavRegistration.DefaultSize, new PrefixLocalizer());

        // Every tile label/description came through the i18n facade (prefixed), not a hard-coded literal.
        Assert.Equal("L:nav.drives", display.Tiles[0].Label);
        Assert.Equal("L:nav.drivesDesc", display.Tiles[0].Description);
        Assert.Equal("L:nav.battery", display.Tiles[3].Label);
    }

    [Theory]
    [InlineData(1, 2)]
    [InlineData(2, 2)]
    [InlineData(3, 4)]
    [InlineData(4, 4)]
    public void Project_column_count_is_responsive(int cols, int expected)
    {
        var display = QuickNavProjection.Project(QuickNavItemSource.Canonical, new QuickNavSize(cols, 2), Localizer);
        Assert.Equal(expected, display.Columns);
    }

    [Fact]
    public void Project_with_empty_source_yields_no_tiles()
    {
        var display = QuickNavProjection.Project(Array.Empty<QuickNavItem>(), QuickNavRegistration.DefaultSize, Localizer);
        Assert.Empty(display.Tiles);
    }

    // ---- Accessibility (Narrator names on every tile) ------------------------------

    [Fact]
    public void Project_every_tile_has_a_non_empty_automation_name()
    {
        var display = QuickNavProjection.Project(QuickNavItemSource.Canonical, QuickNavRegistration.DefaultSize, Localizer);

        Assert.All(display.Tiles, tile => Assert.False(string.IsNullOrWhiteSpace(tile.AutomationName)));
    }

    [Fact]
    public void Project_automation_name_joins_label_and_description()
    {
        var display = QuickNavProjection.Project(QuickNavItemSource.Canonical, QuickNavRegistration.DefaultSize, Localizer);

        Assert.Equal("Drives, Trip history", display.Tiles[0].AutomationName);
        Assert.Equal("Charging, Sessions & costs", display.Tiles[1].AutomationName);
        Assert.Equal("Analytics, Fleet insights", display.Tiles[2].AutomationName);
        Assert.Equal("Battery, Health & degradation", display.Tiles[3].AutomationName);
    }

    // ---- Registry metadata (web registry parity) -----------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("quick-nav", QuickNavRegistration.Id);
        Assert.Equal("system", QuickNavRegistration.Category);
        Assert.Equal("QuickNavWidget", QuickNavRegistration.Slug);
        Assert.Equal(new QuickNavSize(4, 2), QuickNavRegistration.DefaultSize);
        Assert.Equal(new QuickNavSize(2, 2), QuickNavRegistration.MinSize);
        Assert.Equal(new QuickNavSize(4, 40), QuickNavRegistration.MaxSize);
        Assert.Equal("Quick Navigation", QuickNavRegistration.Name(Localizer));
        Assert.Equal("Shortcut links to key pages", QuickNavRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(4, 2, true)]
    [InlineData(4, 40, true)]
    [InlineData(1, 2, false)]
    [InlineData(2, 1, false)]
    [InlineData(4, 41, false)]
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, QuickNavRegistration.IsWithinBounds(new QuickNavSize(cols, rows)));

    [Theory]
    [InlineData(1, 1, 2, 2)]
    [InlineData(8, 99, 4, 40)]
    [InlineData(3, 6, 3, 6)]
    public void Registration_clamp_respects_bounds(int cols, int rows, int expectedCols, int expectedRows)
    {
        var clamped = QuickNavRegistration.Clamp(new QuickNavSize(cols, rows));
        Assert.Equal(new QuickNavSize(expectedCols, expectedRows), clamped);
    }

    // ---- View-model: ready / empty states ------------------------------------------

    [Fact]
    public void ViewModel_ready_with_canonical_source()
    {
        var vm = NewViewModel();

        Assert.Equal(QuickNavState.Ready, vm.State);
        Assert.True(vm.HasTiles);
        Assert.Equal(4, vm.Display.Tiles.Count);
    }

    [Fact]
    public void ViewModel_empty_when_no_tiles_resolve()
    {
        var vm = NewViewModel(source: new EmptyItemSource());

        Assert.Equal(QuickNavState.Empty, vm.State);
        Assert.False(vm.HasTiles);
        Assert.Empty(vm.Display.Tiles);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void ViewModel_title_is_localized()
    {
        Assert.Equal("Quick Navigation", NewViewModel().Title);
    }

    // ---- View-model: navigation forwarding -----------------------------------------

    [Fact]
    public void ViewModel_navigate_forwards_route_to_navigator()
    {
        var navigator = new RecordingNavigator();
        var vm = NewViewModel(navigator: navigator);

        foreach (var tile in vm.Display.Tiles)
        {
            vm.Navigate(tile.RouteName);
        }

        Assert.Equal(new[] { "Drives", "Charging", "Analytics", "BatteryHealth" }, navigator.Routes.ToArray());
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void ViewModel_navigate_rejects_empty_route(string? route)
    {
        var vm = NewViewModel();
        Assert.ThrowsAny<ArgumentException>(() => vm.Navigate(route!));
    }

    // ---- View-model: size re-projection --------------------------------------------

    [Fact]
    public void ViewModel_resize_reprojects_columns_and_raises_change()
    {
        var vm = NewViewModel(size: new QuickNavSize(2, 2));
        Assert.Equal(2, vm.Display.Columns);

        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Size = new QuickNavSize(4, 2);

        Assert.Equal(4, vm.Display.Columns);
        Assert.Contains(nameof(QuickNavViewModel.Display), raised);
        Assert.Contains(nameof(QuickNavViewModel.Size), raised);
    }

    [Fact]
    public void ViewModel_resize_to_same_size_is_a_noop()
    {
        var vm = NewViewModel(size: new QuickNavSize(4, 2));

        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Size = new QuickNavSize(4, 2);

        Assert.Empty(raised);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new QuickNavDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=QuickNavWidget", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new QuickNavDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ---- Test doubles --------------------------------------------------------------

    private sealed class RecordingNavigator : IQuickNavNavigator
    {
        public List<string> Routes { get; } = new();

        public void Navigate(string routeName) => Routes.Add(routeName);
    }

    private sealed class EmptyItemSource : IQuickNavItemSource
    {
        public IReadOnlyList<QuickNavItem> GetItems() => Array.Empty<QuickNavItem>();
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
