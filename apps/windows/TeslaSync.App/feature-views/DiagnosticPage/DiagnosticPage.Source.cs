using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.SystemDiagnostics;

/// <summary>
/// The generated-client-backed <see cref="IDiagnosticRunner"/> — the native data adapter for the system-diagnostic
/// surface. It binds to the generated OpenAPI contract client (ADR-004): <c>POST /system/diagnostic</c> for the
/// aggregated self-test (web <c>useRunDiagnostic</c>), which takes no parameters and no body. No HTTP touches the view;
/// the response JSON round-trips through the tolerant <see cref="DiagnosticReport.FromJson"/> parser so the snake_case
/// wire shape is preserved losslessly. A non-success response surfaces as the client's <see cref="ApiException"/>
/// (carrying the HTTP status) so the view-model surfaces the diagnostic-failed panel exactly as the web
/// <c>onError</c> path does.
/// </summary>
public sealed class DiagnosticClientRunner : IDiagnosticRunner
{
    private readonly IApiClient _api;

    /// <summary>Creates the runner over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public DiagnosticClientRunner(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<DiagnosticReport> RunAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DiagnosticRegistration.Operation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return DiagnosticReport.FromJson(json);
    }
}
