using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>HelixPage</c> surface's Microsoft.UI-free logic — the page-tier registration
/// (the three i18n strings the parity manifest requires, the route / slug constants and the integrations / helix
/// breadcrumb-label overrides), the shell-default AI-settings source (the empty data state the embedded
/// <c>AISettings</c> surface renders from), and the page view-model's <c>loading → success</c> state matrix (the web
/// <c>useSettings().isLoading</c> the page hands to its <c>PageContainer</c>). The WinUI view itself is exercised by
/// the app build; it is a thin <c>PageContainer</c> wrapper around the already-tested <c>AISettings</c> surface.
/// Mirrors the web spec (web/src/features/settings/pages/HelixPage.tsx).
/// </summary>
public sealed class HelixPageTests
{
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // The three i18n keys the manifest requires the page to resolve (web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "helix.breadcrumb.integrations",
        "helix.page.subtitle",
        "helix.page.title",
    ];

    // ---- Strings -------------------------------------------------------------------

    [Fact]
    public void Title_resolves_the_web_key_with_the_web_fallback()
    {
        Assert.Equal("helix.page.title", HelixPageRegistration.TitleKey);
        Assert.Equal("Helix", HelixPageRegistration.TitleFallback);
        Assert.Equal("Helix", HelixPageRegistration.Title(PassthroughLocalizer.Instance));
    }

    [Fact]
    public void Subtitle_resolves_the_web_key_with_the_web_fallback()
    {
        Assert.Equal("helix.page.subtitle", HelixPageRegistration.SubtitleKey);
        Assert.Equal(
            "Optional AI integration. Off by default — nothing runs until you opt in here.",
            HelixPageRegistration.SubtitleFallback);
        Assert.Equal(
            "Optional AI integration. Off by default — nothing runs until you opt in here.",
            HelixPageRegistration.Subtitle(PassthroughLocalizer.Instance));
    }

    [Fact]
    public void IntegrationsBreadcrumb_resolves_the_web_key_with_the_web_fallback()
    {
        Assert.Equal("helix.breadcrumb.integrations", HelixPageRegistration.IntegrationsBreadcrumbKey);
        Assert.Equal("Integrations", HelixPageRegistration.IntegrationsBreadcrumbFallback);
        Assert.Equal("Integrations", HelixPageRegistration.IntegrationsBreadcrumb(PassthroughLocalizer.Instance));
    }

    [Fact]
    public void Registration_resolves_every_required_string_key_from_the_catalog()
    {
        var localizer = new RecordingLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["helix.page.title"] = "Catalog title",
            ["helix.page.subtitle"] = "Catalog subtitle",
            ["helix.breadcrumb.integrations"] = "Catalog integrations",
        });

        Assert.Equal("Catalog title", HelixPageRegistration.Title(localizer));
        Assert.Equal("Catalog subtitle", HelixPageRegistration.Subtitle(localizer));
        Assert.Equal("Catalog integrations", HelixPageRegistration.IntegrationsBreadcrumb(localizer));

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, localizer.RequestedKeys);
        }
    }

    // ---- Registration --------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_slug()
    {
        Assert.Equal("Helix", HelixPageRegistration.RouteName);
        Assert.Equal("integrations/helix", HelixPageRegistration.Route);
        Assert.Equal("HelixPage", HelixPageRegistration.Slug);
    }

    [Fact]
    public void BreadcrumbOverrides_map_the_integrations_and_helix_segments()
    {
        var overrides = HelixPageRegistration.BreadcrumbOverrides(PassthroughLocalizer.Instance);

        Assert.Equal(2, overrides.Count);
        Assert.Equal("Integrations", overrides[HelixPageRegistration.IntegrationsSegment]);
        Assert.Equal("Helix", overrides[HelixPageRegistration.HelixSegment]);
    }

    [Fact]
    public void BreadcrumbOverrides_resolve_each_segment_from_the_catalog()
    {
        var localizer = new RecordingLocalizer(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["helix.page.title"] = "Catalog title",
            ["helix.breadcrumb.integrations"] = "Catalog integrations",
        });

        var overrides = HelixPageRegistration.BreadcrumbOverrides(localizer);

        Assert.Equal("Catalog integrations", overrides["integrations"]);
        Assert.Equal("Catalog title", overrides["helix"]);
    }

    // ---- Default AI-settings source ------------------------------------------------

    [Fact]
    public async Task Default_source_resolves_settings_to_the_empty_state()
    {
        var results = new List<RepositoryResult<AiSettingsSnapshot>>();
        await foreach (var result in EmptyAiSettingsSource.Instance.StreamSettingsAsync())
        {
            results.Add(result);
        }

        var only = Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, only.Status);
    }

    [Fact]
    public async Task Default_source_resolves_usage_to_the_empty_state()
    {
        var results = new List<RepositoryResult<AiUsageTodaySnapshot>>();
        await foreach (var result in EmptyAiSettingsSource.Instance.StreamUsageTodayAsync())
        {
            results.Add(result);
        }

        var only = Assert.Single(results);
        Assert.Equal(LoadStatus.Empty, only.Status);
    }

    [Fact]
    public async Task Default_source_accepts_a_save_as_a_no_op()
    {
        // The save path is inert for the shell-default source (web parity — the surface keeps its optimistic value).
        var outcome = await EmptyAiSettingsSource.Instance.SaveAsync(new JsonObject());
        Assert.True(outcome.Success);
    }

    // ---- View-model state matrix (loading → success) -------------------------------

    [Fact]
    public void ViewModel_starts_in_the_loading_state()
    {
        // The first useSettings fetch is pending with no cache — the page shows its spinner.
        using var vm = new HelixPageViewModel(new FakeAiSettingsSource());
        Assert.True(vm.IsLoading);
    }

    [Fact]
    public async Task ViewModel_stays_loading_while_only_a_loading_emission_is_seen()
    {
        using var vm = new HelixPageViewModel(new FakeAiSettingsSource(
            RepositoryResult<AiSettingsSnapshot>.Loading()));

        await vm.LoadAsync();

        Assert.True(vm.IsLoading);
    }

    [Fact]
    public async Task ViewModel_resolves_out_of_loading_when_settings_arrive()
    {
        using var vm = new HelixPageViewModel(new FakeAiSettingsSource(
            RepositoryResult<AiSettingsSnapshot>.Loading(),
            RepositoryResult<AiSettingsSnapshot>.Empty(Now)));

        await vm.LoadAsync();

        Assert.False(vm.IsLoading);
    }

    [Fact]
    public async Task ViewModel_resolves_out_of_loading_on_a_loaded_settings_document()
    {
        // The success state: a settings document resolved, so the container shows the embedded Helix form.
        using var vm = new HelixPageViewModel(new FakeAiSettingsSource(
            RepositoryResult<AiSettingsSnapshot>.Loaded(AiSettingsSnapshot.Empty, Now)));

        await vm.LoadAsync();

        Assert.False(vm.IsLoading);
    }

    [Fact]
    public async Task ViewModel_refresh_re_runs_the_settings_read()
    {
        var source = new FakeAiSettingsSource(
            RepositoryResult<AiSettingsSnapshot>.Loaded(AiSettingsSnapshot.Empty, Now));
        using var vm = new HelixPageViewModel(source);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, source.SettingsStreamCount);
        Assert.False(vm.IsLoading);
    }

    /// <summary>An <see cref="ILocalizer"/> that records requested keys and can map a few of them.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public RecordingLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return _map.TryGetValue(key, out var value) ? value : fallback;
        }
    }

    /// <summary>A controllable <see cref="IAiSettingsSource"/> that replays a fixed settings sequence.</summary>
    private sealed class FakeAiSettingsSource : IAiSettingsSource
    {
        private readonly RepositoryResult<AiSettingsSnapshot>[] _settings;

        public FakeAiSettingsSource(params RepositoryResult<AiSettingsSnapshot>[] settings) =>
            _settings = settings ?? Array.Empty<RepositoryResult<AiSettingsSnapshot>>();

        public int SettingsStreamCount { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<AiSettingsSnapshot>> StreamSettingsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            SettingsStreamCount++;
            foreach (var result in _settings)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }

        public async IAsyncEnumerable<RepositoryResult<AiUsageTodaySnapshot>> StreamUsageTodayAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<AiUsageTodaySnapshot>.Empty();
            await Task.CompletedTask.ConfigureAwait(false);
        }

        public Task<AiSettingsSaveOutcome> SaveAsync(JsonObject document, CancellationToken cancellationToken = default) =>
            Task.FromResult(AiSettingsSaveOutcome.Ok(AiSettingsSnapshot.Empty));
    }
}
