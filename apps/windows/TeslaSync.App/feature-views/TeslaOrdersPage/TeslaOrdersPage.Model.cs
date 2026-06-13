using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Canonical registry metadata for the Tesla Orders page — the native mirror of the web page
/// (web/src/features/admin/pages/TeslaOrdersPage.tsx, route <c>/tesla-orders</c>). The web page is a thin
/// wrapper that renders a <c>PageContainer</c> header (its <c>title</c> / <c>subtitle</c> — the two parity
/// strings) around the shared <c>ActiveOrdersSection</c>. It centralises the deep-link route name, the
/// diagnostics slug and the localized title/subtitle so the view and view-model stay free of literal copy. The
/// title/subtitle resolve from the <em>same</em> web i18n keys the hosted <see cref="ActiveOrdersSection"/> uses
/// (the web repeats <c>t('orders.title')</c> / <c>t('orders.subtitle')</c> in both the page and the section), so
/// the page header and the section header show identical copy.
/// </summary>
public static class TeslaOrdersRegistration
{
    /// <summary>The deep-link route name (RouteTable <c>Page("TeslaOrders","tesla-orders", …)</c>).</summary>
    public const string RouteName = "TeslaOrders";

    /// <summary>Diagnostics surface slug for the page surface (P1/S11).</summary>
    public const string Slug = "TeslaOrdersPage";

    /// <summary>i18n key for the page title (web <c>orders.title</c>; shared with the hosted section).</summary>
    public const string TitleKey = "translation.orders.title";

    /// <summary>i18n key for the page subtitle (web <c>orders.subtitle</c>; shared with the hosted section).</summary>
    public const string SubtitleKey = "translation.orders.subtitle";

    /// <summary>Resolve the page title (web <c>t('orders.title', 'Active Orders')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, "Active Orders");
    }

    /// <summary>Resolve the page subtitle (web <c>t('orders.subtitle', 'Vehicle orders and delivery tracking from Tesla')</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubtitleKey, "Vehicle orders and delivery tracking from Tesla");
    }
}

/// <summary>
/// The default local-state <see cref="IActiveOrdersSource"/> the page hosts when no live data layer is wired —
/// the host-injection precedent every feature page follows (the page's parameterless constructor defaults to an
/// empty feed; an explicit constructor accepts the generated-client-backed source for tests / dependency
/// injection). It resolves a single successful-but-empty snapshot so the hosted <see cref="ActiveOrdersSection"/>
/// renders its pre-fetch empty body ("No order data yet. Click Refresh to fetch from Tesla.", web parity: the
/// query has no data and no fetch time), and the refresh is a no-op success. The view never performs HTTP.
/// </summary>
public sealed class EmptyActiveOrdersSource : IActiveOrdersSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyActiveOrdersSource Instance { get; } = new();

    private EmptyActiveOrdersSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<OrdersSnapshot>> StreamOrdersAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<OrdersSnapshot>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task<OrdersRefreshOutcome> RefreshAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(OrdersRefreshOutcome.Success());
    }
}
