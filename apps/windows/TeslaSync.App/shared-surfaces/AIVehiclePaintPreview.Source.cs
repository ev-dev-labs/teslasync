using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.SharedSurfaces;

// The AI-feature visibility gate (IAiFeatureGate) and its predicate / AI-off implementations
// (DelegateAiFeatureGate, StaticAiFeatureGate) are defined once for all AI shared surfaces in
// AICabinTemperatureImpactNarrative.Source.cs (the canonical home); this surface reuses them, mirroring how
// AIDriveCoaching, AISafetySettingExplainer and AINLGrafanaPanel consume the shared gate rather than
// redeclaring it.

/// <summary>
/// The streaming transport the paint-preview state holder consumes (P1/S8 data seam) — the native analogue of
/// the <c>fetch + ReadableStream</c> reader the web <c>useAiStream</c> opens (web/src/hooks/useAiStream.ts L237).
/// It opens the per-vehicle paint-preview SSE stream and yields the raw <c>text/event-stream</c> body as
/// newline-preserving text chunks, which the holder feeds to the shared
/// <see cref="TeslaSync.App.Core.Live.SseFrameParser"/>. The vehicle id is embedded in the URL and the optional
/// one-word style hint is carried in the JSON body, exactly as the web InnerSection derives them (web
/// AIVehiclePaintPreview.tsx L62-L84). Production uses <see cref="HttpClientAiPaintPreviewTransport"/>; tests
/// inject a scripted fake so no socket is opened. The view never performs HTTP.
/// </summary>
public interface IAiPaintPreviewTransport
{
    /// <summary>
    /// Open the paint-preview stream for <paramref name="vehicleId"/> (web
    /// <c>POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft</c>) with the optional
    /// <paramref name="styleHint"/> carried in the body, and yield the response body as text chunks with newlines
    /// preserved. A non-success status throws an <see cref="HttpRequestException"/> whose message is the web
    /// <c>stream_http_{status}</c> code so the holder surfaces the off-mode / failure path and the caller falls
    /// back to its deterministic baseline (the manual per-vehicle Color setting still renders); a connectivity
    /// fault propagates as a bare <see cref="HttpRequestException"/> / <see cref="IOException"/> the holder
    /// classifies as offline.
    /// </summary>
    /// <param name="vehicleId">The resolved (&gt; 0) vehicle id the paint preview is drafted for.</param>
    /// <param name="styleHint">The optional one-word style hint, or null (the body omits <c>style_hint</c>).</param>
    /// <param name="cancellationToken">Cancels the stream (the web AbortController).</param>
    /// <returns>The streamed text chunks, newline-preserving.</returns>
    IAsyncEnumerable<string> OpenAsync(int vehicleId, string? styleHint, CancellationToken cancellationToken = default);
}

/// <summary>
/// The production <see cref="IAiPaintPreviewTransport"/>: streams <c>text/event-stream</c> over an
/// <see cref="HttpClient"/>, mirroring the shared SSE transport but building the URL and body through the tested
/// <see cref="AiPaintPreviewRequest"/> adapter so the per-vehicle path (<c>ai/vehicles/{id}/paint-preview/draft</c>)
/// and the <c>{}</c> / <c>{"style_hint":"…"}</c> body match the web <c>useAiStream</c> call bit-for-bit. Each call
/// reads the current bearer token from the <see cref="ITokenProvider"/> so a refreshed credential is honoured,
/// builds the versioned URI from the <see cref="ApiClientOptions"/> base path, and re-emits the body line by line
/// with the newline restored so the holder's frame parser sees intact frame boundaries. A non-success status is
/// surfaced as the web <c>stream_http_{status}</c> code (404 is the off-mode / feature-off contract). The bearer
/// token is never logged. WinUI-free.
/// </summary>
public sealed class HttpClientAiPaintPreviewTransport : IAiPaintPreviewTransport
{
    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly ITokenProvider _tokenProvider;

    /// <summary>Creates the transport over a configured client, API options and token provider.</summary>
    /// <param name="http">The HTTP client (base address + handler supplied by the host composition root).</param>
    /// <param name="options">The API options carrying the version base path and fallback base address.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    public HttpClientAiPaintPreviewTransport(HttpClient http, ApiClientOptions options, ITokenProvider tokenProvider)
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
        int vehicleId,
        string? styleHint,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = AiPaintPreviewRequest.Create(vehicleId, styleHint);
        var uri = BuildUri(request.DraftPath);
        using var message = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            // web useAiStream: `body: JSON.stringify(body)` with `Content-Type: application/json`. The body is
            // `{}` or `{"style_hint":"…"}` — built once by the tested AiPaintPreviewRequest adapter.
            Content = new StringContent(request.BodyJson, Encoding.UTF8, "application/json"),
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
            // and the caller falls back to its deterministic baseline (the manual Color setting still renders).
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

    private Uri BuildUri(string draftPath)
    {
        string path = draftPath.TrimStart('/');
        string versioned = string.Concat(_options.VersionBasePath.TrimEnd('/'), "/", path);
        return new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);
    }
}
