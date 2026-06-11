using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.SharedSurfaces;

// The AI-feature visibility gate (IAiFeatureGate) and its predicate/AI-off implementations
// (DelegateAiFeatureGate, StaticAiFeatureGate) are defined once for all AI shared surfaces in
// AICabinTemperatureImpactNarrative.Source.cs (the canonical home, which also defines StaticAiFeatureGate);
// this surface reuses them, mirroring how AIGeofenceAwareAutomationSuggestions and AINLGrafanaPanel consume the
// shared gate rather than redeclaring it.

/// <summary>
/// The streaming transport the coaching state holder consumes (P1/S8 data seam) — the native analogue of the
/// <c>fetch + ReadableStream</c> the web <c>useAiStream</c> opens (web/src/hooks/useAiStream.ts L237). It opens
/// the per-drive coaching SSE stream and yields the raw <c>text/event-stream</c> body as newline-preserving text
/// chunks, which the holder feeds to the shared <see cref="TeslaSync.App.Core.Live.SseFrameParser"/>. Production
/// uses <see cref="HttpClientAiCoachTransport"/>; tests inject a scripted fake so no socket is opened. The view
/// never performs HTTP.
/// </summary>
public interface IAiCoachTransport
{
    /// <summary>
    /// Open the coaching stream for <paramref name="driveId"/> (web <c>POST /api/v1/ai/drives/{id}/coach</c>) and
    /// yield the response body as text chunks with newlines preserved. A non-success status throws an
    /// <see cref="HttpRequestException"/> whose message is the web <c>stream_http_{status}</c> code so the holder
    /// surfaces the off-mode / failure path and the caller falls back to its non-AI baseline.
    /// </summary>
    /// <param name="driveId">The drive id the coaching narrative is generated for.</param>
    /// <param name="cancellationToken">Cancels the stream (the web AbortController).</param>
    /// <returns>The streamed text chunks, newline-preserving.</returns>
    IAsyncEnumerable<string> OpenAsync(string driveId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The production <see cref="IAiCoachTransport"/>: streams <c>text/event-stream</c> over an
/// <see cref="HttpClient"/>, mirroring the shared <c>HttpClientSseTransport</c> but POSTing the empty
/// <c>"{}"</c> body the web hook sends (web <c>JSON.stringify({})</c>). Each call reads the current bearer token
/// from the <see cref="ITokenProvider"/> so a refreshed credential is honoured, builds the versioned
/// <c>ai/drives/{id}/coach</c> URI from the <see cref="ApiClientOptions"/> base path, and re-emits the body line
/// by line with the newline restored so the holder's frame parser sees intact frame boundaries. A non-success
/// status is surfaced as the web <c>stream_http_{status}</c> code (404 is the off-mode / feature-off contract).
/// The bearer token is never logged.
/// </summary>
public sealed class HttpClientAiCoachTransport : IAiCoachTransport
{
    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly ITokenProvider _tokenProvider;

    /// <summary>Creates the transport over a configured client, API options and token provider.</summary>
    /// <param name="http">The HTTP client (base address + handler supplied by the host composition root).</param>
    /// <param name="options">The API options carrying the version base path and fallback base address.</param>
    /// <param name="tokenProvider">The bearer-token source (W4).</param>
    public HttpClientAiCoachTransport(HttpClient http, ApiClientOptions options, ITokenProvider tokenProvider)
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
        string driveId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(driveId);

        var uri = BuildUri(driveId);
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
            // and the caller falls back to its deterministic baseline.
            throw new HttpRequestException($"stream_http_{(int)response.StatusCode}");
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

    private Uri BuildUri(string driveId)
    {
        string path = $"ai/drives/{Uri.EscapeDataString(driveId)}/coach";
        string versioned = _options.VersionBasePath.TrimEnd('/') + "/" + path;
        return new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);
    }
}
