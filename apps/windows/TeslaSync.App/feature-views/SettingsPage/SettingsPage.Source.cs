using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// The generated-client-backed <see cref="ISettingsFeed"/> — the native data adapter for the settings surface. It
/// binds to the generated OpenAPI contract client (ADR-004): <c>GET /settings</c> for the read query (web
/// <c>useSettings</c>), routing through the same auth + resilience pipeline the rest of the app shares. No HTTP touches
/// the view; the read JSON round-trips through the tolerant <see cref="SettingsSnapshot.FromJson"/> parser (which
/// accepts the bare settings object and the platform <c>{data:…}</c> envelope). A non-success response surfaces as the
/// client's <see cref="ApiException"/> so the view-model resolves the load (the static settings content always renders,
/// mirroring the web page, where <c>useSettings</c> only gates the initial spinner).
/// </summary>
public sealed class SettingsClientFeed : ISettingsFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public SettingsClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<SettingsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SettingsRegistration.GetOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return SettingsSnapshot.FromJson(json);
    }
}
