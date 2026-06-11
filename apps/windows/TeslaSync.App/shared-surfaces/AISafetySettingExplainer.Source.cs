using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.SharedSurfaces;

// The AI-feature visibility gate (IAiFeatureGate) and its predicate / AI-off implementations
// (DelegateAiFeatureGate, StaticAiFeatureGate) are defined once for all AI shared surfaces in
// AICabinTemperatureImpactNarrative.Source.cs (the canonical home); this surface reuses them, mirroring how
// AIDriveCoaching, AIGeofenceAwareAutomationSuggestions and AINLGrafanaPanel consume the shared gate rather than
// redeclaring it.

/// <summary>
/// The streaming transport the safety-explainer state holder consumes (P1/S8 data seam) — the native analogue of
/// the <c>fetch + ReadableStream</c> reader the web <c>useAiStream</c> opens (web/src/hooks/useAiStream.ts L237).
/// It opens the settings-safety narration SSE stream and yields the raw <c>text/event-stream</c> body as
/// newline-preserving text chunks, which the holder feeds to the shared
/// <see cref="TeslaSync.App.Core.Live.SseFrameParser"/>. Unlike the per-vehicle surfaces this stream takes no id
/// — the web body is the empty object <c>{}</c> and the backend reads the user identity from the ForwardAuth
/// subject (web AISafetySettingExplainer.tsx L65). Production uses
/// <see cref="HttpClientAiSafetyExplainTransport"/>; tests inject a scripted fake so no socket is opened. The
/// view never performs HTTP.
/// </summary>
public interface IAiSafetyExplainTransport
{
    /// <summary>
    /// Open the safety-setting narration stream (web <c>POST /api/v1/ai/settings/safety/explain</c> with an empty
    /// <c>{}</c> body) and yield the response body as text chunks with newlines preserved. A non-success status
    /// throws an <see cref="HttpRequestException"/> whose message is the web <c>stream_http_{status}</c> code, so
    /// the holder surfaces the off-mode / failure path; a connectivity fault propagates as a bare
    /// <see cref="HttpRequestException"/> / <see cref="IOException"/> the holder classifies as offline.
    /// </summary>
    /// <param name="cancellationToken">Cancels the stream (the web AbortController).</param>
    /// <returns>The streamed text chunks, newline-preserving.</returns>
    IAsyncEnumerable<string> OpenAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The production <see cref="IAiSafetyExplainTransport"/>: streams <c>text/event-stream</c> over an
/// <see cref="HttpClient"/>, mirroring the shared SSE transport but POSTing the empty <c>"{}"</c> body the web
/// hook sends (web <c>JSON.stringify({})</c>, useAiStream.ts) because the explainer derives the user from the
/// authenticated subject rather than a request field. Each call reads the current bearer token from the
/// <see cref="ITokenProvider"/> so a refreshed credential is honoured, builds the versioned
/// <c>ai/settings/safety/explain</c> URI from the <see cref="ApiClientOptions"/> base path, and re-emits the body
/// line by line with the newline restored so the holder's frame parser sees intact frame boundaries. A
/// non-success status is surfaced as the web <c>stream_http_{status}</c> code (404 is the off-mode / feature-off
/// contract). The bearer token is never logged. WinUI-free.
/// </summary>
public sealed class HttpClientAiSafetyExplainTransport : IAiSafetyExplainTransport
{
    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly ITokenProvider _tokenProvider;

    /// <summary>Creates the transport over a configured client, API options and token provider.</summary>
    /// <param name="http">The HTTP client (base address + handler supplied by the host composition root).</param>
    /// <param name="options">The API options carrying the version base path and fallback base address.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    public HttpClientAiSafetyExplainTransport(HttpClient http, ApiClientOptions options, ITokenProvider tokenProvider)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(tokenProvider);
        _http = http;
        _options = options;
        _tokenProvider = tokenProvider;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<string> OpenAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var uri = BuildUri();
        using var message = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            // web useAiStream: `body: JSON.stringify({})` with `Content-Type: application/json`.
            Content = new StringContent("{}", Encoding.UTF8, "application/json"),
        };
        message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        message.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true };

        var token = await _tokenProvider.GetTokenAsync(cancellationToken).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(token))
        {
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        using var response = await _http
            .SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            // web useAiStream: `const msg = stream_http_${res.status}; finalizeError(msg);` — off-mode is 404,
            // and the caller falls back to its deterministic baseline (the safety-settings list still renders).
            throw new HttpRequestException(
                string.Concat("stream_http_", ((int)response.StatusCode).ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }

        await foreach (var chunk in ReadLinesAsync(response, cancellationToken).ConfigureAwait(false))
        {
            yield return chunk;
        }
    }

    private static async IAsyncEnumerable<string> ReadLinesAsync(
        HttpResponseMessage response,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: false);

        while (true)
        {
            var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            if (line is null)
            {
                break;
            }

            // Restore the newline the reader stripped so the frame parser sees intact frame boundaries.
            yield return line + "\n";
        }
    }

    private Uri BuildUri()
    {
        string path = AISafetySettingExplainerRegistration.ExplainPath.TrimStart('/');
        string versioned = string.Concat(_options.VersionBasePath.TrimEnd('/'), "/", path);
        return new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);
    }
}
