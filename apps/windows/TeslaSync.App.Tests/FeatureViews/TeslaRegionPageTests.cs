using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Tesla Region page's Microsoft.UI-free logic — the page chrome the web
/// <c>TeslaRegionPage</c> owns (web/src/features/admin/pages/TeslaRegionPage.tsx): the two parity strings resolved
/// through the localizer (<c>region.title</c> / <c>region.subtitle</c>, the same web keys the hosted
/// <c>RegionSettings</c> component uses), the view-model's title/subtitle projection + language <c>Reload</c>, and
/// the default local-state region source the page hosts (a single empty snapshot + a no-op success refresh). The
/// Fluent view itself is a thin renderer exercised by the app build / UI-automation tier. Mirrors the web spec.
/// </summary>
public sealed class TeslaRegionPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Registration (the two parity strings + the route metadata) -----------------

    [Fact]
    public void Registration_resolves_the_two_parity_strings()
    {
        Assert.Equal("Region & API", TeslaRegionRegistration.Title(Localizer));
        Assert.Equal(
            "Tesla account region and Fleet API endpoint",
            TeslaRegionRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Registration_keeps_the_web_region_keys_and_route_name()
    {
        Assert.Equal("translation.region.title", TeslaRegionRegistration.TitleKey);
        Assert.Equal("translation.region.subtitle", TeslaRegionRegistration.SubtitleKey);
        Assert.Equal("TeslaRegion", TeslaRegionRegistration.RouteName);
        Assert.Equal("TeslaRegionPage", TeslaRegionRegistration.Slug);
    }

    [Fact]
    public void Registration_routes_every_string_through_the_localizer()
    {
        var recording = new RecordingLocalizer();
        _ = TeslaRegionRegistration.Title(recording);
        _ = TeslaRegionRegistration.Subtitle(recording);
        Assert.Contains("translation.region.title", recording.Keys);
        Assert.Contains("translation.region.subtitle", recording.Keys);
    }

    [Fact]
    public void Registration_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => TeslaRegionRegistration.Title(null!));
        Assert.Throws<ArgumentNullException>(() => TeslaRegionRegistration.Subtitle(null!));
    }

    // ---- View-model (the page chrome the thin view binds to) ------------------------

    [Fact]
    public void ViewModel_exposes_the_resolved_title_and_subtitle()
    {
        var vm = new TeslaRegionPageViewModel(Localizer);
        Assert.Equal("Region & API", vm.Title);
        Assert.Equal("Tesla account region and Fleet API endpoint", vm.Subtitle);
    }

    [Fact]
    public void ViewModel_reload_raises_title_and_subtitle()
    {
        var vm = new TeslaRegionPageViewModel(Localizer);
        var raised = new List<string>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName ?? string.Empty);

        vm.Reload();

        Assert.Contains(nameof(TeslaRegionPageViewModel.Title), raised);
        Assert.Contains(nameof(TeslaRegionPageViewModel.Subtitle), raised);
    }

    [Fact]
    public void ViewModel_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => new TeslaRegionPageViewModel(null!));
    }

    // ---- Default local-state source (the host-injection empty feed) -----------------

    [Fact]
    public async Task EmptySource_streams_a_single_empty_snapshot()
    {
        var results = new List<RepositoryResult<RegionConfig>>();
        await foreach (var result in EmptyRegionSettingsSource.Instance.StreamRegionAsync())
        {
            results.Add(result);
        }

        var only = Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, only.Status);
        Assert.Null(only.Error);
    }

    [Fact]
    public async Task EmptySource_refresh_is_a_noop_success()
    {
        var outcome = await EmptyRegionSettingsSource.Instance.RefreshAsync();
        Assert.True(outcome.Success);
        Assert.Null(outcome.Error);
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
