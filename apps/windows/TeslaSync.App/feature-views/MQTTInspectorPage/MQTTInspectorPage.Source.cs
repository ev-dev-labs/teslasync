using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The data port the <see cref="MQTTInspectorPageViewModel"/> reads the Fleet Telemetry broker status through
/// (P1/S8 state-holder seam) — the native analogue of the web page's live query
/// (<c>useMQTTStatus</c> → <c>GET /telemetry</c>, web/src/api/hooks/useTelemetry.ts). The view never performs HTTP
/// itself; the generated-client-backed <see cref="MqttStatusClientFeed"/> drives this in the app, while the default
/// <see cref="EmptyMqttStatusFeed"/> resolves to the empty broker state for the headless / pre-wiring path and a host
/// can inject a fake for tests.
/// </summary>
public interface IMqttStatusFeed
{
    /// <summary>Resolve the current broker status snapshot.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    Task<MqttStatusSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every read to the absent (no-status) snapshot (the empty data state).</summary>
public sealed class EmptyMqttStatusFeed : IMqttStatusFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyMqttStatusFeed Instance { get; } = new();

    private EmptyMqttStatusFeed()
    {
    }

    /// <inheritdoc />
    public Task<MqttStatusSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(MqttStatusSnapshot.Empty);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IMqttStatusFeed"/> — the native data adapter for the MQTT Inspector
/// surface. It binds to the generated OpenAPI contract client (ADR-004) for the single live query the web page runs:
/// <c>GET /telemetry</c> (generated operation <c>get_api_v1_telemetry</c>, web <c>useMQTTStatus</c>), which takes no
/// parameters. No HTTP touches the view; the response JSON round-trips through <see cref="MqttStatusSnapshot.FromJson"/>
/// so the snake_case / camelCase Go wire shape is preserved losslessly. A non-success response surfaces as the
/// client's <see cref="ApiException"/> so the view-model can surface the error banner / empty branch.
/// </summary>
public sealed class MqttStatusClientFeed : IMqttStatusFeed
{
    private static readonly ApiRequest StatusRequest = new(MqttInspectorRegistration.TelemetryOperation);

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public MqttStatusClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<MqttStatusSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(StatusRequest, cancellationToken).ConfigureAwait(false);
        return MqttStatusSnapshot.FromJson(json);
    }
}
