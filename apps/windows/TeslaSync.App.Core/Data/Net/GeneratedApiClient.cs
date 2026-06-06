using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Auth;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Core.Data.Net;

/// <summary>
/// <see cref="IApiClient"/> implemented over the generated OpenAPI endpoint table
/// (<see cref="GeneratedApi.ApiEndpoints"/>) — the only contract client in the app.
///
/// Responsibilities:
/// <list type="bullet">
///   <item>Resolve an operation id to its generated <see cref="GeneratedApi.EndpointDescriptor"/>.</item>
///   <item>Fill <c>{path}</c> parameters and append snake_case query parameters.</item>
///   <item>Prepend the <c>/api/v1</c> version segment exactly once for versioned routes.</item>
///   <item>Send through the supplied <see cref="HttpClient"/> (whose pipeline carries the
///         W4 auth handler and the resilience handler) and deserialize the JSON body.</item>
/// </list>
/// Diagnostics are emitted through a redacting sink so a URL or error body can never leak
/// token material.
/// </summary>
public sealed class GeneratedApiClient : IApiClient
{
    private static readonly IReadOnlyDictionary<string, GeneratedApi.EndpointDescriptor> Endpoints =
        BuildIndex();

    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly Action<string>? _diagnostics;

    /// <summary>Creates the client over a configured <see cref="HttpClient"/> pipeline.</summary>
    public GeneratedApiClient(HttpClient http, ApiClientOptions options, Action<string>? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(options);
        _http = http;
        _options = options;
        _diagnostics = diagnostics;
    }

    /// <inheritdoc />
    public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId)
    {
        ArgumentException.ThrowIfNullOrEmpty(operationId);
        if (!Endpoints.TryGetValue(operationId, out var descriptor))
        {
            throw new ApiException($"Unknown API operation '{operationId}'.");
        }

        return descriptor;
    }

    /// <inheritdoc />
    public async Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var descriptor = ResolveEndpoint(request.OperationId);
        var uri = BuildUri(descriptor, request);

        using var message = new HttpRequestMessage(ToHttpMethod(descriptor.Method), uri);
        if (request.Body is not null)
        {
            var json = JsonSerializer.Serialize(request.Body, _options.Json);
            message.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        _diagnostics?.Invoke(TokenRedaction.Redact($"api → {descriptor.Method} {uri}"));

        using var response = await _http.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            await ThrowForErrorAsync(response, cancellationToken).ConfigureAwait(false);
        }

        return await DeserializeAsync<T>(response, cancellationToken).ConfigureAwait(false);
    }

    private Uri BuildUri(GeneratedApi.EndpointDescriptor descriptor, ApiRequest request)
    {
        var path = descriptor.Path;
        foreach (var name in descriptor.PathParams)
        {
            if (request.PathParams is null || !request.PathParams.TryGetValue(name, out var value))
            {
                throw new ApiException($"Missing path parameter '{name}' for '{descriptor.OperationId}'.");
            }

            path = path.Replace("{" + name + "}", Uri.EscapeDataString(value), StringComparison.Ordinal);
        }

        // Apply the version segment exactly once for versioned routes (no double prefix).
        if (descriptor.Versioned)
        {
            path = _options.VersionBasePath.TrimEnd('/') + "/" + path.TrimStart('/');
        }

        var builder = new UriBuilder(_options.BaseAddress)
        {
            Path = CombinePath(_options.BaseAddress.AbsolutePath, path),
            Query = BuildQuery(descriptor, request),
        };
        return builder.Uri;
    }

    private static string CombinePath(string basePath, string requestPath)
    {
        if (string.IsNullOrEmpty(basePath) || basePath == "/")
        {
            return requestPath;
        }

        return basePath.TrimEnd('/') + "/" + requestPath.TrimStart('/');
    }

    private static string BuildQuery(GeneratedApi.EndpointDescriptor descriptor, ApiRequest request)
    {
        if (request.Query is null || request.Query.Count == 0)
        {
            return string.Empty;
        }

        var allowed = descriptor.QueryParams.Select(static q => q.Name).ToHashSet(StringComparer.Ordinal);
        var parts = new List<string>();
        foreach (var (key, value) in request.Query)
        {
            if (value is null)
            {
                continue;
            }

            if (allowed.Count > 0 && !allowed.Contains(key))
            {
                throw new ApiException($"Unknown query parameter '{key}' for '{descriptor.OperationId}'.");
            }

            parts.Add(Uri.EscapeDataString(key) + "=" + Uri.EscapeDataString(Stringify(value)));
        }

        return string.Join("&", parts);
    }

    private static string Stringify(object value) => value switch
    {
        bool b => b ? "true" : "false",
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };

    private async Task ThrowForErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        var status = (int)response.StatusCode;
        string? body = null;
        string? code = null;
        try
        {
            body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(body))
            {
                var error = JsonSerializer.Deserialize<GeneratedApi.Error>(body, _options.Json);
                code = error?.Code;
            }
        }
        catch (JsonException)
        {
            // Non-JSON error body; fall back to the status line.
        }

        var snippet = body is { Length: > 0 } ? TokenRedaction.Redact(Truncate(body, 256)) : null;
        _diagnostics?.Invoke(TokenRedaction.Redact($"api ✗ {status} {response.RequestMessage?.RequestUri}"));
        throw new ApiException($"API request failed with status {status}.", status, snippet, code);
    }

    private async Task<T> DeserializeAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        if (stream.CanSeek && stream.Length == 0)
        {
            if (default(T) is null)
            {
                return default!;
            }

            throw new ApiException("The server returned an empty body for a required value.");
        }

        try
        {
            var value = await JsonSerializer.DeserializeAsync<T>(stream, _options.Json, cancellationToken)
                .ConfigureAwait(false);
            return value!;
        }
        catch (JsonException ex)
        {
            throw new ApiException("The server response could not be decoded.", innerException: ex);
        }
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max];

    private static System.Net.Http.HttpMethod ToHttpMethod(GeneratedApi.HttpMethod method) => method switch
    {
        GeneratedApi.HttpMethod.Get => System.Net.Http.HttpMethod.Get,
        GeneratedApi.HttpMethod.Post => System.Net.Http.HttpMethod.Post,
        GeneratedApi.HttpMethod.Put => System.Net.Http.HttpMethod.Put,
        GeneratedApi.HttpMethod.Patch => System.Net.Http.HttpMethod.Patch,
        GeneratedApi.HttpMethod.Delete => System.Net.Http.HttpMethod.Delete,
        GeneratedApi.HttpMethod.Head => System.Net.Http.HttpMethod.Head,
        GeneratedApi.HttpMethod.Options => System.Net.Http.HttpMethod.Options,
        GeneratedApi.HttpMethod.Trace => System.Net.Http.HttpMethod.Trace,
        _ => System.Net.Http.HttpMethod.Get,
    };

    private static IReadOnlyDictionary<string, GeneratedApi.EndpointDescriptor> BuildIndex()
    {
        var map = new Dictionary<string, GeneratedApi.EndpointDescriptor>(StringComparer.Ordinal);
        foreach (var descriptor in GeneratedApi.ApiEndpoints.All)
        {
            map[descriptor.OperationId] = descriptor;
        }

        return map;
    }
}
