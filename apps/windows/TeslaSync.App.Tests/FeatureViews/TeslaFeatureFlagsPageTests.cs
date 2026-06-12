using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TeslaFeatureFlagsPage</c> surface's Microsoft.UI-free logic — the parity port
/// of the web page (web/src/features/admin/pages/TeslaFeatureFlagsPage.tsx, route /tesla-features). The web page
/// is a thin <c>PageContainer</c> wrapper around the shared <c>FeatureToggles</c> surface, so the page's own parity
/// scope is the two header strings (<c>featureConfig.title</c> / <c>featureConfig.subtitle</c>) plus the chrome
/// state holder, the PII-safe diagnostics and the default empty data source that lands the hosted surface on its
/// empty state. The WinUI view is exercised by the app build; the localized copy and the diagnostic are asserted
/// here through the <see cref="ILocalizer"/> facade.
/// </summary>
public sealed class TeslaFeatureFlagsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // The 2 i18n keys the manifest requires the page to resolve (PARITY_REQUIRED=2), with the web key names
    // carried verbatim under the resw 'translation.' namespace.
    private static readonly string[] RequiredStringKeys =
    [
        "translation.featureConfig.subtitle",
        "translation.featureConfig.title",
    ];

    // ---- Registration metadata + parity strings -----------------------------------

    [Fact]
    public void Registration_exposes_stable_slug_route_and_localized_parity_strings()
    {
        Assert.Equal("TeslaFeatureFlagsPage", TeslaFeatureFlagsRegistration.Slug);
        Assert.Equal("TeslaFeatureFlags", TeslaFeatureFlagsRegistration.RouteName);
        Assert.Equal("tesla-features", TeslaFeatureFlagsRegistration.RoutePath);
        Assert.Equal("Feature Flags", TeslaFeatureFlagsRegistration.Title(Localizer));
        Assert.Equal("Tesla account feature configuration", TeslaFeatureFlagsRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Registration_resolves_the_two_parity_string_keys_through_the_facade()
    {
        var recorder = new RecordingLocalizer();

        _ = TeslaFeatureFlagsRegistration.Title(recorder);
        _ = TeslaFeatureFlagsRegistration.Subtitle(recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- View-model chrome (the bound state holder the header renders from) --------

    [Fact]
    public void ViewModel_exposes_localized_title_and_subtitle()
    {
        using var vm = new TeslaFeatureFlagsPageViewModel(Localizer);

        Assert.Equal("Feature Flags", vm.Title);
        Assert.Equal("Tesla account feature configuration", vm.Subtitle);
    }

    [Fact]
    public void ViewModel_title_and_subtitle_resolve_through_the_facade()
    {
        var recorder = new RecordingLocalizer();
        using var vm = new TeslaFeatureFlagsPageViewModel(recorder);

        _ = vm.Title;
        _ = vm.Subtitle;

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public async Task ViewModel_load_records_view_opened_once_and_flips_is_loaded()
    {
        var sink = new List<string>();
        using var vm = new TeslaFeatureFlagsPageViewModel(Localizer, new TeslaFeatureFlagsDiagnostics(sink.Add));
        var changes = new List<string?>();
        vm.PropertyChanged += (_, e) => changes.Add(e.PropertyName);

        Assert.False(vm.IsLoaded);

        await vm.LoadAsync();
        await vm.LoadAsync(); // idempotent — the page has no query, only the one-shot open diagnostic

        Assert.True(vm.IsLoaded);
        Assert.Equal("view.opened slug=TeslaFeatureFlagsPage", Assert.Single(sink));
        Assert.Contains("IsLoaded", changes);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new TeslaFeatureFlagsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TeslaFeatureFlagsPage", Assert.Single(sink));
    }

    // ---- Default empty source (the host-injection default the page constructs with) -

    [Fact]
    public async Task EmptyFeatureTogglesSource_yields_a_single_loaded_empty_snapshot()
    {
        var source = new EmptyFeatureTogglesSource(() => Now);

        var results = await Collect(source.StreamConfigAsync());

        var result = Assert.Single(results);
        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.NotNull(result.Value);
        Assert.Empty(result.Value!.Entries);
    }

    [Fact]
    public async Task EmptyFeatureTogglesSource_refresh_is_a_noop_success()
    {
        var source = new EmptyFeatureTogglesSource(() => Now);

        var outcome = await source.RefreshAsync();

        Assert.True(outcome.Succeeded);
        Assert.Null(outcome.Error);
    }

    [Fact]
    public async Task Default_source_drives_the_hosted_FeatureToggles_surface_to_its_empty_state()
    {
        using var hosted = new FeatureTogglesViewModel(new EmptyFeatureTogglesSource(() => Now), Localizer, () => Now);

        await hosted.LoadAsync();

        Assert.Equal(FeatureTogglesState.Empty, hosted.State);
        Assert.False(hosted.Display.HasRows);
    }

    // ---- helpers -------------------------------------------------------------------

    private static async Task<IReadOnlyList<RepositoryResult<FeatureConfigSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<FeatureConfigSnapshot>> stream)
    {
        var list = new List<RepositoryResult<FeatureConfigSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
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
