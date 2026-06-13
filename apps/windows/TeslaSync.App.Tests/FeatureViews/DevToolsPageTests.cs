using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DevToolsPage</c> shell's Microsoft.UI-free logic — the parity port of the
/// web page (web/src/features/admin/pages/DevToolsPage.tsx). The web page is a thin shell: a title + subtitle
/// header (the two parity strings <c>devtools.title</c> / <c>devtools.subtitle</c>) over a five-tab navigator
/// whose tabs mirror the web <c>TABS</c> array in order. These tests assert the i18n key coverage, the web
/// English defaults and the tab catalog the <see cref="DevToolsPageViewModel"/> binds; the WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class DevToolsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The two manifest string keys the page resolves (PARITY: string).
    private static readonly string[] ManifestStringKeys =
    [
        "devtools.title",
        "devtools.subtitle",
    ];

    // ---- i18n key coverage (PARITY: string) ----------------------------------------

    [Fact]
    public void Catalog_resolves_every_manifest_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = DevToolsCatalog.Title(recorder);
        _ = DevToolsCatalog.Subtitle(recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Manifest_keys_match_the_web_source()
    {
        Assert.Equal("devtools.title", DevToolsCatalog.TitleKey);
        Assert.Equal("devtools.subtitle", DevToolsCatalog.SubtitleKey);
    }

    [Fact]
    public void Manifest_strings_resolve_the_web_defaults()
    {
        Assert.Equal("Developer Tools", DevToolsCatalog.Title(Localizer));
        Assert.Equal("Fleet API, telemetry, infrastructure & utilities", DevToolsCatalog.Subtitle(Localizer));
    }

    // ---- tab catalog (web TABS) ----------------------------------------------------

    [Fact]
    public void Tabs_mirror_the_web_order_and_defaults()
    {
        var keys = DevToolsCatalog.Tabs.Select(t => t.Key).ToArray();

        Assert.Equal(
            new[]
            {
                DevToolsTabKey.FleetApi,
                DevToolsTabKey.Telemetry,
                DevToolsTabKey.Infrastructure,
                DevToolsTabKey.Utilities,
                DevToolsTabKey.Reference,
            },
            keys);
        Assert.Equal(DevToolsTabKey.FleetApi, DevToolsCatalog.DefaultTab);
    }

    [Fact]
    public void Tab_labels_resolve_the_web_text()
    {
        var labels = DevToolsCatalog.Tabs.ToDictionary(t => t.Key, t => t.Label(Localizer));

        Assert.Equal("Fleet API", labels[DevToolsTabKey.FleetApi]);
        Assert.Equal("Telemetry", labels[DevToolsTabKey.Telemetry]);
        Assert.Equal("Infrastructure", labels[DevToolsTabKey.Infrastructure]);
        Assert.Equal("Utilities", labels[DevToolsTabKey.Utilities]);
        Assert.Equal("Reference", labels[DevToolsTabKey.Reference]);
    }

    // ---- view-model state holder ---------------------------------------------------

    [Fact]
    public void ViewModel_exposes_title_subtitle_and_tabs()
    {
        var viewModel = new DevToolsPageViewModel(Localizer);

        Assert.Equal("Developer Tools", viewModel.Title);
        Assert.Equal("Fleet API, telemetry, infrastructure & utilities", viewModel.Subtitle);
        Assert.Equal(5, viewModel.Tabs.Count);
        Assert.Equal(DevToolsTabKey.FleetApi, viewModel.ActiveTab);
    }

    [Fact]
    public void ViewModel_active_tab_change_raises_notification()
    {
        var viewModel = new DevToolsPageViewModel(Localizer);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.ActiveTab = DevToolsTabKey.Reference;

        Assert.Equal(DevToolsTabKey.Reference, viewModel.ActiveTab);
        Assert.Contains(nameof(DevToolsPageViewModel.ActiveTab), changed);
    }

    [Fact]
    public void ViewModel_reload_renotifies_the_header_and_tabs()
    {
        var viewModel = new DevToolsPageViewModel(Localizer);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Reload();

        Assert.Contains(nameof(DevToolsPageViewModel.Title), changed);
        Assert.Contains(nameof(DevToolsPageViewModel.Subtitle), changed);
        Assert.Contains(nameof(DevToolsPageViewModel.Tabs), changed);
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
