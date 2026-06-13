using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Onboarding;

/// <summary>
/// The generated-client-backed <see cref="IOnboardingStatusFeed"/> — the native data adapter for the first-run setup
/// checklist. It binds to the generated OpenAPI contract client (ADR-004): <c>GET /onboarding/status</c> for the
/// status read (web <c>useOnboardingStatus</c>). No HTTP touches the view; the response JSON round-trips through the
/// tolerant <see cref="OnboardingStatusSnapshot.FromJson"/> parser (which accepts the platform <c>{data:…}</c>
/// envelope and missing fields). A non-success response surfaces as the client's exception so the view-model can apply
/// the web pessimistic-gate fallback (an undefined status reads as "nothing connected").
/// </summary>
public sealed class OnboardingStatusClientFeed : IOnboardingStatusFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public OnboardingStatusClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<OnboardingStatusSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(OnboardingRegistration.StatusOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return OnboardingStatusSnapshot.FromJson(json);
    }
}
