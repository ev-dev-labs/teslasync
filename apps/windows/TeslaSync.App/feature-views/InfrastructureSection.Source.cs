using System.Text.Json;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Infrastructure;

/// <summary>
/// The data port the tool view-models run through (P1/S8 state-holder seam) — the native analogue of the
/// web <c>apiFetch</c> helper that backs every <c>useMutation</c> in
/// web/src/features/admin/components/devtools. The view never performs HTTP itself; the concrete
/// <see cref="InfrastructureToolRunner"/> (or a test fake) drives this.
/// </summary>
public interface IInfrastructureToolRunner
{
    /// <summary>
    /// Run one dev-tools operation. <paramref name="body"/> is serialized as the JSON request body for write
    /// tools (the MQTT topic/message) and is null for the read tools. Never throws for an API failure — it
    /// maps the fault to a classified <see cref="InfrastructureToolOutcome"/> (the web's <c>{ error }</c>
    /// envelope) — but propagates <see cref="OperationCanceledException"/> so a superseding run can cancel.
    /// </summary>
    Task<InfrastructureToolOutcome> RunAsync(
        InfrastructureToolDescriptor descriptor,
        object? body,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-style <see cref="IInfrastructureToolRunner"/> — the native data adapter for the
/// Infrastructure tools. It resolves the descriptor's <see cref="InfrastructureToolDescriptor.OperationId"/>
/// against the generated endpoint table and sends it through the shared <see cref="IApiClient"/> pipeline
/// (auth + resilience), deserializing the response into a raw <see cref="JsonElement"/> — exactly the web
/// <c>request&lt;Record&lt;string, unknown&gt;&gt;('/dev-tools/{endpoint}', …)</c> call. Any transport/HTTP
/// fault is classified through <see cref="ApiErrorMapper"/> into a failure outcome so the surface can pick
/// the failed-vs-offline state, mirroring <c>apiFetch</c>'s <c>catch</c> returning <c>{ error }</c>.
/// </summary>
public sealed class InfrastructureToolRunner : IInfrastructureToolRunner
{
    private readonly IApiClient _api;

    /// <summary>Creates the runner over the shared contract client.</summary>
    public InfrastructureToolRunner(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<InfrastructureToolOutcome> RunAsync(
        InfrastructureToolDescriptor descriptor,
        object? body,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        try
        {
            var request = new ApiRequest(descriptor.OperationId, Body: body);
            var value = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return InfrastructureToolOutcome.Success(value);
        }
        catch (OperationCanceledException)
        {
            // A superseding run (or disposal) cancelled this one — let the caller drop it silently.
            throw;
        }
        catch (Exception ex)
        {
            var error = ApiErrorMapper.Map(ex);
            return InfrastructureToolOutcome.Failure(error.Message, error.Kind);
        }
    }
}
