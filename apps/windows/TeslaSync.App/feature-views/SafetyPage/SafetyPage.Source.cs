using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The generated-client-backed <see cref="ISafetySettingsSource"/> — the native data adapter for the safety-settings
/// listing. It binds to the generated OpenAPI contract client (ADR-004): <c>GET /settings</c> for the read query (web
/// <c>useSettings</c>), routing through the same auth + resilience pipeline the rest of the app shares. No HTTP touches
/// the view; the read JSON round-trips through the tolerant <see cref="SafetySettingsSnapshot.FromJson"/> parser (which
/// accepts the bare settings object and the platform <c>{data:…}</c> envelope and merges the web defaults for any
/// absent field). A non-success response surfaces as the client's <see cref="ApiException"/>, which the view-model
/// folds back to the defaults snapshot — the deterministic listing always renders, mirroring the web page where
/// <c>useSettings</c> hands back the defaults-merged object and the static-help surface is never blank.
/// </summary>
public sealed class SafetySettingsClientSource : ISafetySettingsSource
{
    private readonly IApiClient _api;

    /// <summary>Creates the source over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SafetySettingsClientSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<SafetySettingsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SafetyPageRegistration.GetOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SafetySettingsSnapshot.FromJson(json);
    }
}
