using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the BottomTabBar surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks (<see cref="BottomTabBarRegistration"/>); the canonical tab catalogue
/// (<see cref="BottomTabBarCatalog"/>); the pure active-path / projection adapter with its per-state active
/// contract (<see cref="BottomTabBarProjection"/>); the shared in-memory location seam
/// (<see cref="InMemoryNavLocationSource"/>); the state-holder view-model's location-change / activation /
/// reload / dispose transitions (<see cref="BottomTabBarViewModel"/>); and the PII-safe diagnostics
/// (<see cref="BottomTabBarDiagnostics"/>). Mirrors the web spec one-for-one
/// (web/src/components/layout/BottomTabBar.tsx). The WinUI view (BottomTabBar.cs, which composes the glass
/// bar + per-tab glyph/label/active-pill + navigation landmark + the empty state) is exercised by the app
/// build.
/// </summary>
public sealed class BottomTabBarTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static BottomTabBarDisplay Project(
        string? path = "/",
        ILocalizer? localizer = null,
        IReadOnlyList<BottomTab>? tabs = null) =>
        BottomTabBarProjection.Project(tabs ?? BottomTabBarCatalog.Default, path, localizer ?? Localizer);

    // ---- Registration: slug + keys + fallbacks -----------------------------------------------------

    [Fact]
    public void Registration_Slug_IsBottomTabBar() =>
        Assert.Equal("BottomTabBar", BottomTabBarRegistration.Slug);

    [Fact]
    public void Registration_QuickNav_MatchesWebSource()
    {
        Assert.Equal("translation.nav.quickNav", BottomTabBarRegistration.QuickNavKey);
        Assert.Equal("Quick navigation", BottomTabBarRegistration.QuickNavFallback);
    }

    [Fact]
    public void Registration_EmptyMessage_ReusesSharedCatalogKey()
    {
        Assert.Equal("translation.common.noData", BottomTabBarRegistration.EmptyMessageKey);
        Assert.Equal("No data available", BottomTabBarRegistration.EmptyMessageFallback);
    }

    [Fact]
    public void Registration_RootPath_IsSlash() =>
        Assert.Equal("/", BottomTabBarRegistration.RootPath);

    // ---- Catalogue: the five tabs, in order, verbatim from the web TABS constant -------------------

    [Fact]
    public void Catalogue_HasFiveTabs_InWebOrder()
    {
        IReadOnlyList<BottomTab> tabs = BottomTabBarCatalog.Default;
        Assert.Equal(
            new[] { "/", "/drives", "/charging", "/battery", "/live" },
            tabs.Select(t => t.Path).ToArray());
    }

    [Fact]
    public void Catalogue_KeysAndFallbacks_MatchWebSource()
    {
        IReadOnlyList<BottomTab> tabs = BottomTabBarCatalog.Default;

        Assert.Equal(
            new[]
            {
                "translation.nav.dashboard",
                "translation.nav.drives",
                "translation.nav.charging",
                "translation.nav.battery",
                "translation.nav.liveMap",
            },
            tabs.Select(t => t.TitleKey).ToArray());

        Assert.Equal(
            new[] { "Home", "Drives", "Charging", "Battery", "Map" },
            tabs.Select(t => t.Fallback).ToArray());
    }

    [Fact]
    public void Catalogue_Glyphs_AreShellCanonicalCodePoints() =>
        Assert.Equal(
            new[] { "\uE80F", "\uE7C0", "\uE945", "\uE83E", "\uE707" },
            BottomTabBarCatalog.Default.Select(t => t.Glyph).ToArray());

    [Fact]
    public void Catalogue_EveryTitleKey_CarriesCatalogPrefix() =>
        Assert.All(BottomTabBarCatalog.Default, t => Assert.StartsWith("translation.", t.TitleKey, System.StringComparison.Ordinal));

    // ---- Projection: the active-path rule, per state ----------------------------------------------

    [Theory]
    [InlineData("/", "/", true)]                 // web: root active only on exact match
    [InlineData("/drives", "/", false)]          // web: root not active off-root
    [InlineData("/", "/drives", false)]          // web: non-root not active at root
    [InlineData("/drives", "/drives", true)]     // web: exact match
    [InlineData("/drives/42", "/drives", true)]  // web: descendant keeps the parent tab lit
    [InlineData("/battery/cells", "/battery", true)]
    [InlineData("/drivesomething", "/drives", false)] // web: prefix without a path separator is NOT a descendant
    [InlineData("/charging", "/drives", false)]  // web: unrelated route
    [InlineData(null, "/", true)]                // normalize: null path is the root
    [InlineData("", "/", true)]                  // normalize: empty path is the root
    public void IsActive_MatchesWebRule(string? currentPath, string tabPath, bool expected) =>
        Assert.Equal(expected, BottomTabBarProjection.IsActive(currentPath, tabPath));

    [Fact]
    public void Project_AtRoot_LightsOnlyDashboard()
    {
        BottomTabBarDisplay display = Project("/");

        Assert.False(display.IsEmpty);
        Assert.Equal(5, display.Tabs.Count);
        Assert.True(display.Tabs[0].IsActive);
        Assert.All(display.Tabs.Skip(1), t => Assert.False(t.IsActive));
    }

    [Fact]
    public void Project_OnNestedRoute_LightsTheParentTab()
    {
        BottomTabBarDisplay display = Project("/drives/42");

        BottomTabDisplay drives = display.Tabs.Single(t => t.Path == "/drives");
        Assert.True(drives.IsActive);
        Assert.Equal(1, display.Tabs.Count(t => t.IsActive));
    }

    [Fact]
    public void Project_ResolvesNavNameAndLabels_ThroughFacade()
    {
        BottomTabBarDisplay display = Project("/charging");

        Assert.Equal("Quick navigation", display.NavAutomationName);
        Assert.Equal(
            new[] { "Home", "Drives", "Charging", "Battery", "Map" },
            display.Tabs.Select(t => t.Label).ToArray());
        Assert.True(display.Tabs.Single(t => t.Path == "/charging").IsActive);
    }

    [Fact]
    public void Project_RequestsEverySourceKey_ThroughFacade()
    {
        var recording = new RecordingLocalizer();
        _ = Project("/", recording);

        Assert.Contains("translation.nav.quickNav", recording.RequestedKeys);
        Assert.Contains("translation.nav.dashboard", recording.RequestedKeys);
        Assert.Contains("translation.nav.drives", recording.RequestedKeys);
        Assert.Contains("translation.nav.charging", recording.RequestedKeys);
        Assert.Contains("translation.nav.battery", recording.RequestedKeys);
        Assert.Contains("translation.nav.liveMap", recording.RequestedKeys);
    }

    [Fact]
    public void Project_EmptyCatalogue_RendersFriendlyEmptyState()
    {
        BottomTabBarDisplay display = Project("/", tabs: System.Array.Empty<BottomTab>());

        Assert.True(display.IsEmpty);
        Assert.Empty(display.Tabs);
        Assert.Equal("No data available", display.EmptyMessage);
        Assert.Equal("Quick navigation", display.NavAutomationName);
    }

    // ---- Accessibility: every tab carries a non-empty name; the landmark is named ------------------

    [Fact]
    public void Project_EveryTab_HasAnAccessibleName()
    {
        BottomTabBarDisplay display = Project("/");

        Assert.False(string.IsNullOrWhiteSpace(display.NavAutomationName));
        Assert.All(display.Tabs, t => Assert.False(string.IsNullOrWhiteSpace(t.Label)));
    }

    // ---- Shared in-memory location seam ------------------------------------------------------------

    [Fact]
    public void InMemoryLocation_DefaultsToRoot() =>
        Assert.Equal("/", new InMemoryNavLocationSource().CurrentPath);

    [Fact]
    public void InMemoryLocation_Navigate_RaisesOnlyOnChange()
    {
        var source = new InMemoryNavLocationSource("/");
        int raised = 0;
        source.PathChanged += (_, _) => raised++;

        source.Navigate("/drives");
        source.Navigate("/drives");

        Assert.Equal("/drives", source.CurrentPath);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void InMemoryLocation_Navigate_NullNormalizesToRoot()
    {
        var source = new InMemoryNavLocationSource("/drives");
        source.Navigate(null);
        Assert.Equal("/", source.CurrentPath);
    }

    // ---- View-model: location-change / activation / reload / dispose -------------------------------

    [Fact]
    public void ViewModel_Display_ReflectsSeamPath()
    {
        using var vm = new BottomTabBarViewModel(Localizer, location: new InMemoryNavLocationSource("/charging"));

        Assert.Equal("/charging", vm.EffectivePath);
        Assert.True(vm.Display.Tabs.Single(t => t.Path == "/charging").IsActive);
    }

    [Fact]
    public void ViewModel_DefaultCatalogue_HasFiveTabs()
    {
        using var vm = new BottomTabBarViewModel(Localizer);
        Assert.Equal(5, vm.Display.Tabs.Count);
        Assert.Equal("/", vm.EffectivePath);
    }

    [Fact]
    public void ViewModel_LocationChange_RaisesAndReprojects()
    {
        var source = new InMemoryNavLocationSource("/");
        using var vm = new BottomTabBarViewModel(Localizer, location: source);
        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Navigate("/drives");

        Assert.True(raised >= 1);
        Assert.True(vm.Display.Tabs.Single(t => t.Path == "/drives").IsActive);
    }

    [Fact]
    public void ViewModel_SelectTab_RaisesActivationWithRoute()
    {
        using var vm = new BottomTabBarViewModel(Localizer);
        string? activated = null;
        vm.TabActivated += (_, route) => activated = route;

        vm.SelectTab("/battery");

        Assert.Equal("/battery", activated);
    }

    [Fact]
    public void ViewModel_Reload_RaisesPropertyChanged()
    {
        using var vm = new BottomTabBarViewModel(Localizer);
        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.Reload();

        Assert.Equal(1, raised);
    }

    [Fact]
    public void ViewModel_Dispose_DetachesFromSeam()
    {
        var source = new InMemoryNavLocationSource("/");
        var vm = new BottomTabBarViewModel(Localizer, location: source);
        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.Dispose();
        source.Navigate("/drives");

        Assert.Equal(0, raised);
    }

    // ---- PII-safe diagnostics ----------------------------------------------------------------------

    [Fact]
    public void Diagnostics_RecordViewOpened_EmitsSluggedSignal()
    {
        var signals = new List<string>();
        var diagnostics = new BottomTabBarDiagnostics(signals.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BottomTabBar", Assert.Single(signals));
    }

    [Fact]
    public void Diagnostics_CountsRepeatedOpens()
    {
        var diagnostics = new BottomTabBarDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
