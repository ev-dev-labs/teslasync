using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IEnergySiteInfoSource"/> — the native data adapter for the Energy Site
/// surface. It is the native analogue of the web component's two-hook composition
/// (web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx): one cache-then-network read that first
/// resolves the Tesla Energy site list (generated operation
/// <see cref="EnergySiteInfoRegistration.SitesOperationId"/>, web <c>useTeslaEnergySites</c>), takes the
/// first site's <c>energy_site_id</c>, then — only when a site exists — reads that site's site info
/// (operation <see cref="EnergySiteInfoRegistration.SiteInfoOperationId"/>, web
/// <c>useTeslaEnergySiteInfo(siteId)</c>). The combined <see cref="EnergySiteInfoSnapshot"/> is cached so the
/// whole surface restores instantly, and no HTTP ever touches the view.
/// </summary>
public sealed class EnergySiteInfoSource : IEnergySiteInfoSource
{
    private const string CacheKey = "tesla:energy-site-info";

    private static readonly ApiRequest SitesRequest = new(EnergySiteInfoRegistration.SitesOperationId);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public EnergySiteInfoSource(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<EnergySiteInfoSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        // The combined snapshot is always a meaningful value (a "no site" / "no info" result is rendered as
        // its own empty surface, not the engine's generic Empty), so nothing is treated as empty here — the
        // view-model derives the NoSite / NoData / Loaded distinction from the snapshot's content.
        var stream = _engine.StreamAsync(
            CacheKey,
            FetchAsync,
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in stream.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<EnergySiteInfoSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var sites = await _api.SendAsync<JsonElement>(SitesRequest, cancellationToken).ConfigureAwait(false);
        if (EnergySiteInfoSnapshot.ParseFirstSiteId(sites) is not { } siteId)
        {
            // Web parity: with no linked site the site-info query is disabled (enabled: !!siteId).
            return EnergySiteInfoSnapshot.NoSites;
        }

        var infoRequest = new ApiRequest(
            EnergySiteInfoRegistration.SiteInfoOperationId,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [EnergySiteInfoRegistration.SitePathParam] = siteId.ToString(CultureInfo.InvariantCulture),
            });

        var info = await _api.SendAsync<JsonElement>(infoRequest, cancellationToken).ConfigureAwait(false);
        return EnergySiteInfoSnapshot.FromSiteAndInfo(siteId, info);
    }
}
