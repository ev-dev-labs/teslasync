using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.SharedSurfaces;

// The AI-feature visibility gate (IAiFeatureGate) and its predicate / AI-off implementations
// (DelegateAiFeatureGate, StaticAiFeatureGate) are defined once for all AI shared surfaces in
// AICabinTemperatureImpactNarrative.Source.cs (the canonical home); this surface reuses them, mirroring how
// AIDriveCoaching, AISafetySettingExplainer and AISignalExplorerNlFilter consume the shared gate rather than
// redeclaring it.

/// <summary>
/// The streaming transport the trip-postcard drafter state holder consumes (P1/S8 data seam) — the native
/// analogue of the <c>fetch + ReadableStream</c> reader the web <c>useAiStream</c> opens
/// (web/src/hooks/useAiStream.ts L237). It POSTs the <see cref="AiTripPostcardRequest"/> body
/// (<c>{ trip_id, style_hint? }</c>) and yields the raw <c>text/event-stream</c> body as newline-preserving text
/// chunks, which the holder feeds to the shared <see cref="TeslaSync.App.Core.Live.SseFrameParser"/>. Production
/// uses <see cref="HttpClientAiTripPostcardTransport"/>; tests inject a scripted fake so no socket is opened. The
/// view never performs HTTP.
/// </summary>
public interface IAiTripPostcardTransport
{
    /// <summary>
    /// Open the trip-postcard draft stream (web <c>POST /api/v1/ai/share-cards/trip-image/draft</c> with the
    /// <c>{ trip_id, style_hint? }</c> body) and yield the response body as text chunks with newlines preserved.
    /// A non-success status throws an <see cref="HttpRequestException"/> whose message is the web
    /// <c>stream_http_{status}</c> code, so the holder surfaces the off-mode / failure path; a connectivity fault
    /// propagates as a bare <see cref="HttpRequestException"/> / <see cref="IOException"/> the holder classifies
    /// as offline.
    /// </summary>
    /// <param name="request">The draft request body (in-scope trip + optional style hint).</param>
    /// <param name="cancellationToken">Cancels the stream (the web AbortController).</param>
    /// <returns>The streamed text chunks, newline-preserving.</returns>
    IAsyncEnumerable<string> OpenAsync(AiTripPostcardRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// The production <see cref="IAiTripPostcardTransport"/>: streams <c>text/event-stream</c> over an
/// <see cref="HttpClient"/>, POSTing the JSON <see cref="AiTripPostcardRequest"/> body the web hook sends (web
/// <c>JSON.stringify(body)</c>, useAiStream.ts) so the propose-only drafter is grounded in the selected trip.
/// Each call reads the current bearer token from the <see cref="ITokenProvider"/> so a refreshed credential is
/// honoured, builds the versioned <c>ai/share-cards/trip-image/draft</c> URI from the
/// <see cref="ApiClientOptions"/> base path, serializes the body with the shared
/// <see cref="ApiClientOptions.Json"/> settings (whose <c>WhenWritingNull</c> policy omits a blank
/// <c>style_hint</c>, mirroring the web payload), and re-emits the response body line by line with the newline
/// restored so the holder's frame parser sees intact frame boundaries. A non-success status is surfaced as the
/// web <c>stream_http_{status}</c> code (404 is the off-mode / feature-off contract). The bearer token is never
/// logged. WinUI-free.
/// </summary>
public sealed class HttpClientAiTripPostcardTransport : IAiTripPostcardTransport
{
    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly ITokenProvider _tokenProvider;

    /// <summary>Creates the transport over a configured client, API options and token provider.</summary>
    /// <param name="http">The HTTP client (base address + handler supplied by the host composition root).</param>
    /// <param name="options">The API options carrying the version base path, fallback base address and JSON settings.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    public HttpClientAiTripPostcardTransport(HttpClient http, ApiClientOptions options, ITokenProvider tokenProvider)
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
        AiTripPostcardRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var uri = BuildUri();
        var json = JsonSerializer.Serialize(request, _options.Json);
        using var message = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            // web useAiStream: `body: JSON.stringify(body)` with `Content-Type: application/json`.
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
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
            // and the caller falls back to its deterministic baseline (the manual share-link controls remain).
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
        string path = AITripPostcardShareCardImageGenerationRegistration.DraftPath.TrimStart('/');
        string versioned = string.Concat(_options.VersionBasePath.TrimEnd('/'), "/", path);
        return new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);
    }
}
