using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Canonical registry metadata for the Tesla Region page — the native mirror of the web page
/// (web/src/features/admin/pages/TeslaRegionPage.tsx, route <c>/tesla-region</c>). The web page is a thin
/// wrapper that renders a <c>PageContainer</c> header (its <c>title</c> / <c>subtitle</c> — the two parity
/// strings, web <c>t('region.title')</c> / <c>t('region.subtitle')</c>) around the shared
/// <see cref="RegionSettings"/> component. It centralises the deep-link route name, the diagnostics slug and the
/// localized title/subtitle so the view and view-model stay free of literal copy. The title/subtitle resolve
/// from the <em>same</em> web i18n keys the hosted <see cref="RegionSettings"/> uses (the web repeats
/// <c>t('region.title')</c> / <c>t('region.subtitle')</c> in both the page and the component), so the page
/// header and the component header show identical copy. Every English fallback equals its
/// <c>Strings/en/Resources.resw</c> value so a headless <see cref="PassthroughLocalizer"/> renders identically
/// to the app's resource bridge. UI-free so it is asserted in tests without a XAML host.
/// </summary>
public static class TeslaRegionRegistration
{
    /// <summary>The deep-link route name (RouteTable <c>Page("TeslaRegion","tesla-region", …)</c>).</summary>
    public const string RouteName = "TeslaRegion";

    /// <summary>Diagnostics surface slug for the page surface (P1/S11).</summary>
    public const string Slug = "TeslaRegionPage";

    /// <summary>i18n key for the page title (web <c>region.title</c>; shared with the hosted component).</summary>
    public const string TitleKey = "translation.region.title";

    /// <summary>i18n key for the page subtitle (web <c>region.subtitle</c>; shared with the hosted component).</summary>
    public const string SubtitleKey = "translation.region.subtitle";

    /// <summary>Resolve the page title (web <c>t('region.title', 'Region &amp; API')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, "Region & API");
    }

    /// <summary>Resolve the page subtitle (web <c>t('region.subtitle', 'Tesla account region and Fleet API endpoint')</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubtitleKey, "Tesla account region and Fleet API endpoint");
    }
}

/// <summary>
/// The default local-state <see cref="IRegionSettingsSource"/> the page hosts when no live data layer is wired —
/// the host-injection precedent every feature page follows (the page's parameterless constructor defaults to an
/// empty source; an explicit constructor accepts the generated-client-backed <see cref="RegionSettingsSource"/>
/// for tests / dependency injection). It resolves a single successful-but-empty snapshot so the hosted
/// <see cref="RegionSettings"/> renders its friendly empty body ("No region data yet. Click Refresh to fetch from
/// Tesla.", web parity: the query has no region and no fetch time), and the refresh is a no-op success. The view
/// never performs HTTP.
/// </summary>
public sealed class EmptyRegionSettingsSource : IRegionSettingsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyRegionSettingsSource Instance { get; } = new();

    private EmptyRegionSettingsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<RegionConfig>> StreamRegionAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<RegionConfig>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task<RegionRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(RegionRefreshOutcome.Ok());
    }
}
