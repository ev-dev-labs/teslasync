using System.Text.Json;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutation port the <see cref="BackendToolViewModel"/> fires a backend run through (P1/S8 state-holder
/// seam) — the native analogue of the web <c>useMutation({ mutationFn: () =&gt; apiFetch(endpoint, method,
/// bodyBuilder?.()) })</c>. The view never performs HTTP itself; the concrete <see cref="BackendToolRunner"/>
/// (or a test fake) drives this.
/// </summary>
public interface IBackendToolRunner
{
    /// <summary>Run <paramref name="descriptor"/>'s dev-tools operation and return the classified outcome.</summary>
    Task<BackendToolOutcome> RunAsync(BackendToolDescriptor descriptor, CancellationToken cancellationToken = default);
}

/// <summary>
/// The single real <see cref="IBackendToolRunner"/> — the native data adapter for one dev-tools run. It sends
/// the descriptor's generated operation (verb + <c>/dev-tools/…</c> path) through the shared contract client
/// with the optional JSON body, then classifies the response with
/// <see cref="BackendToolOutcome.FromResponse"/>. It is the native mirror of the web <c>apiFetch</c> helper
/// (web/src/features/admin/components/devtools/helpers.ts): a thrown transport fault is caught and folded
/// into a failed outcome (web <c>catch (err) { return { error: err.message } }</c>) rather than propagating,
/// so the view-model always settles into <see cref="BackendToolState.Success"/> or
/// <see cref="BackendToolState.Failed"/>. A genuine cancellation (the surface was disposed) is re-thrown so
/// the view-model can drop the superseded run silently. No HTTP touches the view.
/// </summary>
public sealed class BackendToolRunner : IBackendToolRunner
{
    private readonly IApiClient _api;

    /// <summary>Creates the runner over the generated contract client.</summary>
    public BackendToolRunner(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<BackendToolOutcome> RunAsync(BackendToolDescriptor descriptor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        var request = new ApiRequest(descriptor.OperationId, Body: descriptor.Body);

        try
        {
            var response = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return BackendToolOutcome.FromResponse(response);
        }
        catch (OperationCanceledException)
        {
            // The surface was disposed (or the run superseded): let the view-model drop it silently.
            throw;
        }
        catch (Exception exception)
        {
            // Web parity: apiFetch swallows the fault and resolves { error: message } so the card always
            // settles. The privacy-safe message comes from the shared classifier.
            return BackendToolOutcome.Failed(ApiErrorMapper.Map(exception).Message);
        }
    }
}
