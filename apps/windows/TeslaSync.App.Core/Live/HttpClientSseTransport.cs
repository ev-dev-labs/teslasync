using System.Net;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.Core.Live;

/// <summary>
/// Production <see cref="ISseTransport"/>: streams <c>text/event-stream</c> over an
/// <see cref="HttpClient"/>. Each <see cref="OpenAsync"/> reads the current bearer token from the
/// W4 <see cref="ITokenProvider"/> (so a reconnect after a refreshed credential carries the new
/// token) and forwards <see cref="SseRequest.LastEventId"/> as the <c>Last-Event-ID</c> header for
/// server-side resume. The response body is read line by line and re-emitted with the newline
/// restored so the client's <see cref="SseFrameParser"/> sees intact frame boundaries.
///
/// <para>A <c>401</c> is surfaced as <see cref="SseUnauthorizedException"/> so the
/// <see cref="SseClient"/> can refresh once and reconnect (and otherwise surface
/// <see cref="LiveConnection.AuthRequired"/>); any other non-success status throws so the client
/// backs off and reconnects. The bearer token is never logged.</para>
/// </summary>
public sealed class HttpClientSseTransport : ISseTransport
{
    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly ITokenProvider _tokenProvider;
    private readonly Action<string>? _diagnostics;

    /// <summary>Creates the transport over a configured <see cref="HttpClient"/> and token provider.</summary>
    public HttpClientSseTransport(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        Action<string>? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(tokenProvider);
        _http = http;
        _options = options;
        _tokenProvider = tokenProvider;
        _diagnostics = diagnostics;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<string> OpenAsync(
        SseRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var uri = BuildUri(request.Path);
        using var message = new HttpRequestMessage(HttpMethod.Get, uri);
        message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        message.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true };

        var token = await _tokenProvider.GetTokenAsync(cancellationToken).ConfigureAwait(false);
        if (!string.IsNullOrEmpty(token))
        {
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        if (!string.IsNullOrEmpty(request.LastEventId))
        {
            message.Headers.TryAddWithoutValidation("Last-Event-ID", request.LastEventId);
        }

        _diagnostics?.Invoke(TokenRedaction.Redact($"sse → GET {uri}"));

        using var response = await _http
            .SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
            .ConfigureAwait(false);

        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            throw new SseUnauthorizedException();
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"The live stream returned status {(int)response.StatusCode}.");
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

        // Read line by line until the server closes the stream. ReadLineAsync honours the
        // cancellation token, so a backgrounded/cancelled subscription unblocks promptly without the
        // synchronous EndOfStream probe (which would block the calling thread on a live socket).
        while (true)
        {
            var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            if (line is null)
            {
                break;
            }

            // Restore the newline the reader stripped so the parser sees intact frame boundaries.
            yield return line + "\n";
        }
    }

    private Uri BuildUri(string path)
    {
        string versioned = _options.VersionBasePath.TrimEnd('/') + "/" + path.TrimStart('/');
        return new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);
    }
}
