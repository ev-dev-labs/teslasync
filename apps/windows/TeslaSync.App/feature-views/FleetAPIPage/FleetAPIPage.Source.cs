using System.Collections.Generic;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The generated-client-backed <see cref="IFleetApiFeed"/> — the native data adapter for the Fleet API admin surface.
/// It binds to the generated OpenAPI contract client (ADR-004), routing every read and write through the same auth +
/// resilience pipeline the rest of the app shares: <c>GET /settings</c> (web <c>useSettings</c>),
/// <c>GET /settings/polling-config</c> (web <c>usePollingConfig</c>),
/// <c>GET /dev-tools/telemetry-capture/stats</c> (web <c>useCaptureStats</c>), <c>GET /system/version</c>
/// (web <c>useVersionInfo</c>), <c>POST /settings/suspend-api</c> (web <c>useToggleAPISuspend</c>, body
/// <c>{ suspended }</c>) and <c>PUT /settings/polling-config</c> (web <c>useUpdatePollingConfig</c>, the full
/// snake_case config object). No HTTP touches the view; each read JSON round-trips through the tolerant snapshot
/// parsers (which accept the bare object and the platform <c>{data:…}</c> envelope). Reads surface a non-success
/// response as the client's <see cref="ApiException"/> so the view-model resolves its loading state; mutations classify
/// any fault into a <see cref="FleetMutationOutcome"/> (web parity: the mutation resolves to a toast, never an
/// unhandled rejection).
/// </summary>
public sealed class FleetApiClientFeed : IFleetApiFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public FleetApiClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<FleetSettingsSnapshot> FetchSettingsAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(
            new ApiRequest(FleetApiRegistration.SettingsOperation), cancellationToken).ConfigureAwait(false);
        return FleetSettingsSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<PollingConfigSnapshot> FetchPollingConfigAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(
            new ApiRequest(FleetApiRegistration.PollingConfigOperation), cancellationToken).ConfigureAwait(false);
        return PollingConfigSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<CaptureStatsSnapshot> FetchCaptureStatsAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(
            new ApiRequest(FleetApiRegistration.CaptureStatsOperation), cancellationToken).ConfigureAwait(false);
        return CaptureStatsSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<FleetVersionSnapshot> FetchVersionAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(
            new ApiRequest(FleetApiRegistration.VersionOperation), cancellationToken).ConfigureAwait(false);
        return FleetVersionSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<FleetMutationOutcome> ToggleSuspendAsync(bool suspended, CancellationToken cancellationToken)
    {
        var body = new Dictionary<string, object> { ["suspended"] = suspended };
        var request = new ApiRequest(FleetApiRegistration.SuspendOperation, Body: body);
        return await SendMutationAsync(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task<FleetMutationOutcome> UpdatePollingConfigAsync(
        IReadOnlyDictionary<string, object> payload,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(payload);
        var request = new ApiRequest(FleetApiRegistration.PollingConfigUpdateOperation, Body: payload);
        return await SendMutationAsync(request, cancellationToken).ConfigureAwait(false);
    }

    private async Task<FleetMutationOutcome> SendMutationAsync(ApiRequest request, CancellationToken cancellationToken)
    {
        try
        {
            await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return FleetMutationOutcome.Ok;
        }
        catch (ApiException)
        {
            return FleetMutationOutcome.Fail;
        }
        catch (HttpRequestException)
        {
            return FleetMutationOutcome.Fail;
        }
    }
}
