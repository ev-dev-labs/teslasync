using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="InfrastructureSectionViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed infrastructure snapshots — the native analogue of the web
/// component's two live queries (<c>getTelemetryStatus</c> on a 2s interval + <c>getExtendedHealth</c> on a 30s
/// interval, see web/src/features/system/components/status/InfrastructureSection.tsx). The view never performs
/// HTTP itself; the concrete <see cref="InfrastructureSectionSource"/> (or a test fake) drives this.
/// </summary>
public interface IInfrastructureSectionSource
{
    /// <summary>Stream the cache-then-network infrastructure snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<InfrastructureSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IInfrastructureSectionSource"/> — the native data adapter for the
/// Infrastructure Section surface. It runs one cache-then-network cycle whose fetch fans out to the same two
/// endpoints the web component reads:
/// <list type="bullet">
///   <item><c>GET /telemetry/</c> (the SSE / polling-engine status, web <c>getTelemetryStatus</c> — the
///   dominant read whose failure surfaces the error/offline state);</item>
///   <item><c>GET /system/health</c> (the extended-health body, web <c>getExtendedHealth</c> — independently
///   fault-tolerant: a failed read just leaves the database-pool metric row absent, mirroring the web
///   <c>{extHealth?.database_pool &amp;&amp; …}</c> gate).</item>
/// </list>
/// The two raw bodies are merged into a single JSON envelope so the snake_case wire shapes round-trip
/// losslessly through the SQLite cache, then each emission is parsed into an <see cref="InfrastructureSnapshot"/>
/// via <see cref="InfrastructureResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class InfrastructureSectionSource : IInfrastructureSectionSource
{
    private static readonly ApiRequest TelemetryRequest = new(InfrastructureSectionRegistration.TelemetryOperation);
    private static readonly ApiRequest HealthRequest = new(Operations.SystemAdmin.Health);

    // A standalone, reusable empty extended-health body for the graceful-degradation path (a failed health read).
    // Cloned off a throwaway document so it survives that document's disposal.
    private static readonly JsonElement EmptyHealth = ParseEmptyHealth();

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public InfrastructureSectionSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<InfrastructureSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            InfrastructureSectionRegistration.CacheKey,
            FetchMergedAsync,
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return InfrastructureResultMapper.Map(emission);
        }
    }

    private async Task<JsonElement> FetchMergedAsync(CancellationToken cancellationToken)
    {
        // Primary read — the telemetry status. A failure here propagates to the engine so the surface shows
        // error/offline, mirroring the dominant web query (getTelemetryStatus on the 2s interval).
        var telemetryBody = await _api
            .SendAsync<JsonElement>(TelemetryRequest, cancellationToken)
            .ConfigureAwait(false);

        // Supplementary read — the extended health. Independently fault-tolerant (web parity: a separate query
        // whose database_pool is consumed only when present).
        var healthBody = await TryHealthAsync(cancellationToken).ConfigureAwait(false);

        var merged = new Dictionary<string, JsonElement>(StringComparer.Ordinal)
        {
            [InfrastructureSnapshot.TelemetryKey] = telemetryBody.Clone(),
            [InfrastructureSnapshot.HealthKey] = healthBody,
        };

        return JsonSerializer.SerializeToElement(merged, _json);
    }

    private async Task<JsonElement> TryHealthAsync(CancellationToken cancellationToken)
    {
        try
        {
            var body = await _api
                .SendAsync<JsonElement>(HealthRequest, cancellationToken)
                .ConfigureAwait(false);
            return body.Clone();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Web parity: a failed extended-health read just leaves the database-pool metric row absent — the
            // two diagnostic cards still render from the telemetry body.
            return EmptyHealth;
        }
    }

    // Web parity: the cards always render, but with no telemetry body there is nothing to show beyond the
    // disconnected em-dash cards — surface that as the empty state.
    private static bool IsEmptyResponse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty(InfrastructureSnapshot.TelemetryKey, out var telemetry))
        {
            return true;
        }

        return telemetry.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;
    }

    private static JsonElement ParseEmptyHealth()
    {
        using var doc = JsonDocument.Parse("{}");
        return doc.RootElement.Clone();
    }
}
