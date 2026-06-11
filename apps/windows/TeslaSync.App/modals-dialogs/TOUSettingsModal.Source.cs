using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The TOU-settings save port the <see cref="TouSettingsModalViewModel"/> binds to (P1/S8 state-holder seam) —
/// the native analogue of the web <c>useUpdateTOUSettings</c> hook (web/src/api/hooks/useEnergy.ts). It drives
/// the single <c>POST /tesla/energy-sites/{siteID}/tou-settings</c> write the modal performs. The view never
/// performs HTTP itself; the concrete <see cref="TouSettingsUpdateSource"/> (or a test fake) drives this.
/// </summary>
public interface ITouSettingsUpdateSource
{
    /// <summary>
    /// Save the TOU settings (web <c>updateMutation.mutateAsync({ siteId, settings })</c>):
    /// <c>POST /tesla/energy-sites/{siteID}/tou-settings</c> with the assembled <paramref name="payload"/> as the
    /// JSON body. Returns success or a classified error — it never throws for an HTTP fault so the caller surfaces
    /// an inline error + toast rather than an unhandled rejection (web parity).
    /// </summary>
    Task<TouSettingsOutcome> UpdateAsync(long siteId, JsonNode payload, CancellationToken cancellationToken = default);
}

/// <summary>
/// The site-info refresh port the <see cref="TouSettingsModalViewModel"/> triggers after a successful save
/// (P1/S8 state-holder seam) — the native analogue of the web <c>useRefreshTeslaEnergySiteInfo</c> hook
/// (web/src/api/hooks/useEnergy.ts). It drives <c>POST /tesla/energy-sites/{siteID}/site-info/refresh</c> so the
/// parent UI reflects the new tariff, mirroring the web modal's <c>refreshSiteInfo.mutate(siteId)</c> in the
/// save's <c>onSuccess</c>. The concrete <see cref="TouSiteInfoRefreshSource"/> (or a test fake) drives this.
/// </summary>
public interface ITouSiteInfoRefreshSource
{
    /// <summary>
    /// Refresh the site info from Tesla (web <c>refreshSiteInfo.mutate(siteId)</c>):
    /// <c>POST /tesla/energy-sites/{siteID}/site-info/refresh</c>. Returns success or a classified error and never
    /// throws for an HTTP fault.
    /// </summary>
    Task<TouSettingsOutcome> RefreshAsync(long siteId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The contract-client-backed <see cref="ITouSettingsUpdateSource"/> — the native data adapter for the TOU save.
/// It POSTs the assembled <c>tou_settings</c> envelope to the generated
/// <c>post_api_v1_tesla_energy_sites_siteID_tou_settings</c> endpoint through the shared <see cref="IApiClient"/>
/// (the same auth + resilience pipeline the rest of the app shares) and classifies any fault through the shared
/// <see cref="ApiErrorMapper"/> rather than throwing. The saved-settings response is discarded — the modal only
/// needs success/failure, exactly like the web mutation, whose <c>onSuccess</c> raises a toast and closes the
/// modal. No HTTP touches the view.
/// </summary>
public sealed class TouSettingsUpdateSource : ITouSettingsUpdateSource
{
    /// <summary>The generated OpenAPI operation id for <c>POST /api/v1/tesla/energy-sites/{siteID}/tou-settings</c>.</summary>
    public const string UpdateOperation = "post_api_v1_tesla_energy_sites_siteID_tou_settings";

    /// <summary>The generated path-parameter name for the energy-site id.</summary>
    public const string SitePathParam = "siteID";

    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared contract client.</summary>
    /// <param name="api">The generated contract client used for the save POST.</param>
    public TouSettingsUpdateSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<TouSettingsOutcome> UpdateAsync(
        long siteId,
        JsonNode payload,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var request = new ApiRequest(
            UpdateOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [SitePathParam] = siteId.ToString(CultureInfo.InvariantCulture),
            },
            Body: payload);

        try
        {
            _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return TouSettingsOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return TouSettingsOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return TouSettingsOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }
}

/// <summary>
/// The contract-client-backed <see cref="ITouSiteInfoRefreshSource"/> — the native data adapter for the
/// post-save site-info refresh. It POSTs to the generated
/// <c>post_api_v1_tesla_energy_sites_siteID_site_info_refresh</c> endpoint through the shared
/// <see cref="IApiClient"/> and classifies any fault through the shared <see cref="ApiErrorMapper"/> rather than
/// throwing. The response is discarded; the refresh only needs success/failure for its toast, exactly like the
/// web mutation.
/// </summary>
public sealed class TouSiteInfoRefreshSource : ITouSiteInfoRefreshSource
{
    /// <summary>The generated OpenAPI operation id for <c>POST /api/v1/tesla/energy-sites/{siteID}/site-info/refresh</c>.</summary>
    public const string RefreshOperation = "post_api_v1_tesla_energy_sites_siteID_site_info_refresh";

    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared contract client.</summary>
    /// <param name="api">The generated contract client used for the refresh POST.</param>
    public TouSiteInfoRefreshSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<TouSettingsOutcome> RefreshAsync(long siteId, CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(
            RefreshOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [TouSettingsUpdateSource.SitePathParam] = siteId.ToString(CultureInfo.InvariantCulture),
            });

        try
        {
            _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return TouSettingsOutcome.Ok();
        }
        catch (ApiException ex)
        {
            return TouSettingsOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return TouSettingsOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }
}
