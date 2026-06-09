using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ReferenceLinksSection's UI-thread-free logic — the static catalog parity, the
/// localized projection (title resolution, glyph mapping, Narrator-name composition), the state-holder
/// view-model's Ready/Empty branches and language re-projection, the registration metadata, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/admin/components/devtools/ReferenceLinksSection.tsx +
/// constants.ts). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class ReferenceLinksSectionTests
{
    private static readonly ILocalizer Passthrough = PassthroughLocalizer.Instance;

    // ---- Catalog parity ------------------------------------------------------------

    [Fact]
    public void Catalog_default_reproduces_the_four_web_links_in_order()
    {
        var catalog = ReferenceLinkCatalog.Default;

        Assert.Collection(
            catalog,
            link => AssertLink(link, "devtools.ref.fleetOverview", "https://developer.tesla.com/docs/fleet-api", ReferenceLinkIcon.BookOpen),
            link => AssertLink(link, "devtools.ref.partnerEndpoints", "https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register", ReferenceLinkIcon.Globe),
            link => AssertLink(link, "devtools.ref.devPortal", "https://developer.tesla.com", ReferenceLinkIcon.ExternalLink),
            link => AssertLink(link, "devtools.ref.telemetryGuide", "https://developer.tesla.com/docs/fleet-api/fleet-telemetry", ReferenceLinkIcon.Radio));
    }

    private static void AssertLink(ReferenceLink link, string key, string url, ReferenceLinkIcon icon)
    {
        Assert.Equal(key, link.TitleKey);
        Assert.Equal(url, link.Url);
        Assert.Equal(icon, link.Icon);
        Assert.False(string.IsNullOrWhiteSpace(link.TitleFallback));
    }

    // ---- Projection adapter --------------------------------------------------------

    [Fact]
    public void Project_resolves_titles_and_keeps_urls_verbatim()
    {
        var items = ReferenceLinksProjection.Project(ReferenceLinkCatalog.Default, Passthrough);

        Assert.Collection(
            items,
            i => AssertItem(i, "Fleet API Overview", "https://developer.tesla.com/docs/fleet-api", "\uE8F1"),
            i => AssertItem(i, "Partner Endpoints", "https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register", "\uE774"),
            i => AssertItem(i, "Developer Portal", "https://developer.tesla.com", "\uE8A7"),
            i => AssertItem(i, "Fleet Telemetry Guide", "https://developer.tesla.com/docs/fleet-api/fleet-telemetry", "\uEC05"));
    }

    private static void AssertItem(ReferenceLinkItem item, string title, string url, string glyph)
    {
        Assert.Equal(title, item.Title);
        Assert.Equal(url, item.Url);
        Assert.Equal(glyph, item.Glyph);
        Assert.Equal($"{title}, {url}", item.AutomationName);
    }

    [Fact]
    public void Project_requests_exactly_the_web_i18n_keys_in_order()
    {
        var recorder = new RecordingLocalizer();

        ReferenceLinksProjection.Project(ReferenceLinkCatalog.Default, recorder);

        Assert.Equal(
            new[]
            {
                "devtools.ref.fleetOverview",
                "devtools.ref.partnerEndpoints",
                "devtools.ref.devPortal",
                "devtools.ref.telemetryGuide",
            },
            recorder.Keys);
    }

    [Theory]
    [InlineData(ReferenceLinkIcon.BookOpen, "\uE8F1")]
    [InlineData(ReferenceLinkIcon.Globe, "\uE774")]
    [InlineData(ReferenceLinkIcon.ExternalLink, "\uE8A7")]
    [InlineData(ReferenceLinkIcon.Radio, "\uEC05")]
    public void Glyph_maps_each_icon(ReferenceLinkIcon icon, string glyph) =>
        Assert.Equal(glyph, ReferenceLinksProjection.Glyph(icon));

    [Fact]
    public void Project_null_or_empty_catalog_yields_no_items()
    {
        Assert.Empty(ReferenceLinksProjection.Project(null, Passthrough));
        Assert.Empty(ReferenceLinksProjection.Project(Array.Empty<ReferenceLink>(), Passthrough));
    }

    [Fact]
    public void AutomationName_carries_both_label_and_destination()
    {
        var item = Assert.Single(
            ReferenceLinksProjection.Project(
                new[] { new ReferenceLink("k", "Developer Portal", "https://developer.tesla.com", ReferenceLinkIcon.ExternalLink) },
                Passthrough));

        Assert.Contains("Developer Portal", item.AutomationName, StringComparison.Ordinal);
        Assert.Contains("https://developer.tesla.com", item.AutomationName, StringComparison.Ordinal);
    }

    // ---- View-model state branches -------------------------------------------------

    [Fact]
    public void ViewModel_default_catalog_is_ready_with_four_links()
    {
        var vm = new ReferenceLinksViewModel(Passthrough);

        Assert.Equal(ReferenceLinkState.Ready, vm.State);
        Assert.True(vm.HasLinks);
        Assert.Equal(4, vm.Items.Count);
    }

    [Fact]
    public void ViewModel_empty_catalog_renders_the_empty_state()
    {
        var vm = new ReferenceLinksViewModel(Passthrough, Array.Empty<ReferenceLink>());

        Assert.Equal(ReferenceLinkState.Empty, vm.State);
        Assert.False(vm.HasLinks);
        Assert.Empty(vm.Items);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void ViewModel_region_and_empty_copy_resolve_through_localizer()
    {
        var recorder = new RecordingLocalizer();
        var vm = new ReferenceLinksViewModel(recorder, Array.Empty<ReferenceLink>());

        Assert.Equal("Reference links", vm.RegionName);
        Assert.Equal("No reference links available", vm.EmptyMessage);
        Assert.Contains("devtools.ref.regionLabel", recorder.Keys);
        Assert.Contains("devtools.ref.empty", recorder.Keys);
    }

    [Fact]
    public void ViewModel_reload_reprojects_titles_and_notifies()
    {
        var localizer = new SuffixLocalizer();
        var vm = new ReferenceLinksViewModel(localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        Assert.Equal("Fleet API Overview", vm.Items[0].Title);

        localizer.Suffix = " \u2605";
        vm.Reload();

        Assert.Equal("Fleet API Overview \u2605", vm.Items[0].Title);
        Assert.Contains(nameof(ReferenceLinksViewModel.Items), changed);
        Assert.Equal(ReferenceLinkState.Ready, vm.State);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("ReferenceLinksSection", ReferenceLinksRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var emitted = new List<string>();
        var diagnostics = new ReferenceLinksDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=ReferenceLinksSection", "view.opened slug=ReferenceLinksSection" }, emitted);
    }

    // ---- Test localizers -----------------------------------------------------------

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class SuffixLocalizer : ILocalizer
    {
        public string Suffix { get; set; } = string.Empty;

        public string GetString(string key, string fallback) => fallback + Suffix;
    }
}
