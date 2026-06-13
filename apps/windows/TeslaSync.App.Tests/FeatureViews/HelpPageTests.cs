using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SystemOps;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>HelpPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/HelpPage.tsx), the static curated-link catalog, the single success data state
/// (plus the defensive empty branch), the per-card icon→glyph mapping and Narrator composition, and the
/// view-model's local-state load flow. The WinUI view is exercised by the app build; its per-region content is
/// driven entirely by the <see cref="HelpDisplay"/> projection asserted here.
/// </summary>
public sealed class HelpPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The two i18n keys the manifest requires the page to resolve (PARITY_REQUIRED strings).
    private static readonly string[] RequiredStringKeys =
    [
        "help.intro",
        "help.title",
    ];

    // The curated-link i18n keys the page also resolves (the five GlassPanel2 cards).
    private static readonly string[] LinkStringKeys =
    [
        "help.baseline.links.docsStatusApi.title", "help.baseline.links.docsStatusApi.description",
        "help.baseline.links.onboarding.title", "help.baseline.links.onboarding.description",
        "help.baseline.links.systemStatus.title", "help.baseline.links.systemStatus.description",
        "help.baseline.links.search.title", "help.baseline.links.search.description",
        "help.baseline.links.chatbot.title", "help.baseline.links.chatbot.description",
    ];

    private static HelpModel Model(IReadOnlyList<HelpLink>? catalog = null) =>
        new(catalog ?? HelpLinkCatalog.Default);

    // ---- i18n key coverage ---------------------------------------------------------

    [Fact]
    public void Manifest_requires_two_strings()
    {
        Assert.Equal(2, RequiredStringKeys.Length);
        Assert.Equal(RequiredStringKeys.Length, RequiredStringKeys.Distinct().Count());
    }

    [Fact]
    public void Projection_resolves_help_title_and_help_intro()
    {
        var recorder = new RecordingLocalizer();

        _ = HelpProjection.Project(Model(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_every_curated_link_string()
    {
        var recorder = new RecordingLocalizer();

        _ = HelpProjection.Project(Model(), recorder);

        foreach (var key in LinkStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Title_and_intro_resolve_the_web_defaults()
    {
        var display = HelpProjection.Project(Model(), Localizer);

        Assert.Equal("Help", display.Title);
        Assert.Equal("Help", display.DocumentTitle);
        Assert.StartsWith("Get started with TeslaSync.", display.Intro);
    }

    // ---- success data state --------------------------------------------------------

    [Fact]
    public void Default_catalog_projects_success_state()
    {
        var display = HelpProjection.Project(Model(), Localizer);
        Assert.Equal(HelpState.Success, display.State);
    }

    [Fact]
    public void Empty_catalog_projects_the_defensive_empty_state()
    {
        var display = HelpProjection.Project(Model(Array.Empty<HelpLink>()), Localizer);

        Assert.Equal(HelpState.Empty, display.State);
        Assert.Empty(display.Links);
    }

    // ---- curated link grid (GlassPanel2) -------------------------------------------

    [Fact]
    public void Five_curated_links_render_in_web_order()
    {
        var display = HelpProjection.Project(Model(), Localizer);

        Assert.Collection(
            display.Links,
            l => Assert.Equal("docs-status-api", l.Id),
            l => Assert.Equal("onboarding", l.Id),
            l => Assert.Equal("system-status", l.Id),
            l => Assert.Equal("search", l.Id),
            l => Assert.Equal("chatbot", l.Id));
    }

    [Fact]
    public void Curated_links_carry_the_web_routes()
    {
        var display = HelpProjection.Project(Model(), Localizer);
        var routes = display.Links.Select(l => l.Route).ToArray();

        Assert.Equal(
            new[] { "/docs/status-api", "/onboarding", "/system-status", "/search", "/chatbot" },
            routes);
    }

    [Fact]
    public void Curated_links_resolve_their_titles_and_descriptions()
    {
        var display = HelpProjection.Project(Model(), Localizer);
        var docs = display.Links[0];

        Assert.Equal("Documentation", docs.Title);
        Assert.Equal(
            "Browse the public API documentation including endpoints, schemas, and example requests.",
            docs.Description);
        Assert.Equal($"{docs.Title}. {docs.Description}", docs.AutomationName);
    }

    [Theory]
    [InlineData(HelpLinkIcon.Documentation, "\uE8F1")]
    [InlineData(HelpLinkIcon.Onboarding, "\uE945")]
    [InlineData(HelpLinkIcon.SystemStatus, "\uE950")]
    [InlineData(HelpLinkIcon.Search, "\uE721")]
    [InlineData(HelpLinkIcon.Chatbot, "\uE8F2")]
    public void Each_icon_maps_to_its_glyph(HelpLinkIcon icon, string glyph)
    {
        Assert.Equal(glyph, HelpProjection.Glyph(icon));
    }

    [Fact]
    public void Catalog_is_the_five_canonical_links()
    {
        Assert.Equal(5, HelpLinkCatalog.Default.Count);
        Assert.Equal(
            HelpLinkCatalog.Default.Count,
            HelpLinkCatalog.Default.Select(l => l.Id).Distinct().Count());
    }

    // ---- view-model flow -----------------------------------------------------------

    [Fact]
    public async Task ViewModel_default_catalog_is_success_with_five_links()
    {
        var vm = new HelpPageViewModel(Localizer);

        await vm.LoadAsync();

        Assert.Equal(HelpState.Success, vm.State);
        Assert.True(vm.HasLinks);
        Assert.Equal(5, vm.Links.Count);
        Assert.Equal("Help", vm.Title);
        Assert.StartsWith("Get started with TeslaSync.", vm.Intro);
    }

    [Fact]
    public async Task ViewModel_empty_catalog_degrades_to_empty_with_message()
    {
        var vm = new HelpPageViewModel(Localizer, Array.Empty<HelpLink>());

        await vm.RefreshAsync();

        Assert.Equal(HelpState.Empty, vm.State);
        Assert.False(vm.HasLinks);
        Assert.Empty(vm.Links);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void ViewModel_reload_reprojects_without_throwing()
    {
        var vm = new HelpPageViewModel(Localizer);
        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.Reload();

        Assert.Equal(5, vm.Links.Count);
        Assert.True(raised);
    }

    // ---- registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_slug_and_card_routes()
    {
        Assert.Equal("Help", HelpRegistration.RouteName);
        Assert.Equal("HelpPage", HelpRegistration.Slug);
        Assert.Equal("Help", HelpRegistration.Title(Localizer));
        Assert.Equal("/docs/status-api", HelpRegistration.DocsStatusApiRoute);
        Assert.Equal("/onboarding", HelpRegistration.OnboardingRoute);
        Assert.Equal("/system-status", HelpRegistration.SystemStatusRoute);
        Assert.Equal("/search", HelpRegistration.SearchRoute);
        Assert.Equal("/chatbot", HelpRegistration.ChatbotRoute);
    }

    [Fact]
    public void Registration_card_routes_match_the_catalog()
    {
        var catalogRoutes = HelpLinkCatalog.Default.Select(l => l.Route).ToArray();
        var registrationRoutes = new[]
        {
            HelpRegistration.DocsStatusApiRoute,
            HelpRegistration.OnboardingRoute,
            HelpRegistration.SystemStatusRoute,
            HelpRegistration.SearchRoute,
            HelpRegistration.ChatbotRoute,
        };

        Assert.Equal(catalogRoutes, registrationRoutes);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        string? captured = null;
        var diagnostics = new HelpDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HelpPage", captured);
    }

    [Fact]
    public void ViewModel_notify_opened_records_through_diagnostics()
    {
        string? captured = null;
        var diagnostics = new HelpDiagnostics(line => captured = line);
        var vm = new HelpPageViewModel(Localizer, diagnostics: diagnostics);

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=HelpPage", captured);
    }

    // ---- test doubles --------------------------------------------------------------

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
