using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Push;

/// <summary>
/// The single real <see cref="IDeviceRegistrationClient"/> (P2/W6-0002). It POSTs/DELETEs against
/// TeslaSync's additive <c>/api/v1/devices</c> endpoint (ADR-009) over the same configured
/// <see cref="HttpClient"/> pipeline the generated client uses — so registration carries the W4
/// bearer token and the W5 resilience handler — applying the <c>/api/v1</c> version segment exactly
/// once, exactly like <c>GeneratedApiClient</c>.
///
/// <para><b>Contract note (no silent drift):</b> the device-registration endpoint is an additive
/// ADR-009 contract that the OpenAPI source-of-truth (<c>api/openapi/teslasync.openapi.json</c>) does
/// not yet expose, so it is absent from the generated <see cref="GeneratedApi.ApiEndpoints"/> table
/// (the runbook defers it for ADR review). This client therefore targets the ADR-009 path
/// directly via <see cref="DevicesPath"/>; it is the one seam to migrate to a generated
/// <see cref="GeneratedApi.EndpointDescriptor"/> the moment the contract is emitted — no other code
/// hardcodes the path.</para>
/// </summary>
public sealed class DeviceRegistrationClient : IDeviceRegistrationClient
{
    /// <summary>The additive ADR-009 device-registration route (versioned; the version is added once).</summary>
    public const string DevicesPath = "/devices";

    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly Action<string>? _diagnostics;

    /// <summary>Creates the client over the shared (auth + resilience) <see cref="HttpClient"/> pipeline.</summary>
    public DeviceRegistrationClient(HttpClient http, ApiClientOptions options, Action<string>? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(options);
        _http = http;
        _options = options;
        _diagnostics = diagnostics;
    }

    /// <inheritdoc />
    public async Task<DeviceRegistrationResponse> RegisterAsync(
        DeviceRegistrationRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var uri = BuildUri(DevicesPath);
        using var message = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(request, _options.Json),
                Encoding.UTF8,
                "application/json"),
        };

        Emit($"devices → POST {DevicesPath}");
        using var response = await _http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            await ThrowForErrorAsync("register", response, cancellationToken).ConfigureAwait(false);
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var decoded = await JsonSerializer
                .DeserializeAsync<DeviceRegistrationResponse>(stream, _options.Json, cancellationToken)
                .ConfigureAwait(false);
            if (decoded is null || string.IsNullOrEmpty(decoded.RegistrationId))
            {
                throw new ApiException("Device registration returned no registration id.");
            }

            return decoded;
        }
        catch (JsonException ex)
        {
            throw new ApiException("The device-registration response could not be decoded.", innerException: ex);
        }
    }

    /// <inheritdoc />
    public async Task UnregisterAsync(string registrationId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(registrationId);

        var uri = BuildUri(DevicesPath + "/" + Uri.EscapeDataString(registrationId));
        using var message = new HttpRequestMessage(HttpMethod.Delete, uri);

        Emit($"devices → DELETE {DevicesPath}/{{id}}");
        using var response = await _http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);

        // A missing registration is a successful unregister (idempotent sign-out cleanup).
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return;
        }

        if (!response.IsSuccessStatusCode)
        {
            await ThrowForErrorAsync("unregister", response, cancellationToken).ConfigureAwait(false);
        }
    }

    private Uri BuildUri(string route)
    {
        var path = _options.VersionBasePath.TrimEnd('/') + "/" + route.TrimStart('/');
        var basePath = _options.BaseAddress.AbsolutePath;
        var combined = string.IsNullOrEmpty(basePath) || basePath == "/"
            ? path
            : basePath.TrimEnd('/') + "/" + path.TrimStart('/');

        return new UriBuilder(_options.BaseAddress) { Path = combined }.Uri;
    }

    private async Task ThrowForErrorAsync(string action, HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var status = (int)response.StatusCode;
        string? code = null;
        string? snippet = null;
        try
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(body))
            {
                snippet = Sanitize(body.Length <= 256 ? body : body[..256]);
                code = JsonSerializer.Deserialize<GeneratedApi.Error>(body, _options.Json)?.Code;
            }
        }
        catch (JsonException)
        {
            // Non-JSON error body; the status line is enough for diagnostics.
        }

        Emit($"devices ✗ {action} status={status.ToString(CultureInfo.InvariantCulture)}");
        throw new ApiException(
            $"Device {action} failed with status {status.ToString(CultureInfo.InvariantCulture)}.",
            status,
            snippet,
            code);
    }

    private void Emit(string line) => _diagnostics?.Invoke(Sanitize(line));

    private static string Sanitize(string line) => PushRedaction.Redact(TokenRedaction.Redact(line));
}
