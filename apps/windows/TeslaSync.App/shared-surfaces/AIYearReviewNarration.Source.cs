using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The streaming data port the <see cref="AIYearReviewNarrationViewModel"/> binds to (P1/S8 state-holder seam) —
/// the native analogue of the web <c>useAiStream</c> hook (web/src/hooks/useAiStream.ts). It opens one narration
/// stream per <see cref="StreamAsync"/> call and yields the parsed lifecycle events (deltas, the terminal
/// done / error) in arrival order; cancelling the token aborts the stream (the native analogue of the hook's
/// <c>AbortController</c>). The view never performs HTTP — the concrete
/// <see cref="HttpYearReviewNarrationStreamTransport"/> (or a test fake) drives this. It reuses the shared
/// <see cref="AiNarrationStreamEvent"/> lifecycle type (the canonical home is
/// AICabinTemperatureImpactNarrative.Model.cs); only the request body
/// (<see cref="AiYearReviewNarrationRequest"/>, which adds the calendar year) is surface-specific.
/// </summary>
public interface IAiYearReviewNarrationStreamTransport
{
    /// <summary>Open a narration stream for the request body and yield its events until the stream closes.</summary>
    /// <param name="request">The in-scope <c>{ vehicle_id, year }</c> body.</param>
    /// <param name="cancellationToken">Cancels the stream (the web <c>AbortController</c>).</param>
    /// <returns>The lifecycle events in arrival order.</returns>
    IAsyncEnumerable<AiNarrationStreamEvent> StreamAsync(
        AiYearReviewNarrationRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The production <see cref="IAiYearReviewNarrationStreamTransport"/>: streams <c>text/event-stream</c> over an
/// <see cref="HttpClient"/> by POSTing the narration request body to
/// <see cref="AIYearReviewNarrationRegistration.NarratePath"/> — the native analogue of the web <c>useAiStream</c>
/// using <c>fetch</c> + a <c>ReadableStream</c> reader (EventSource cannot POST a body,
/// web/src/hooks/useAiStream.ts L9-L17). It reuses the shared <see cref="AiNarrationSseParser"/> +
/// <see cref="AiNarrationStreamEvent"/> primitives (the canonical home is
/// AICabinTemperatureImpactNarrative.{Model,Source}.cs); only the endpoint and the <c>{ vehicle_id, year }</c>
/// body differ. Each call attaches the current bearer token from the <see cref="ITokenProvider"/>, reads the
/// response line by line, reassembles blank-line-delimited frames and parses them. Failures are surfaced as a
/// terminal <see cref="AiNarrationEventKind.Error"/> event (never an exception across the enumerator boundary)
/// with a classified <see cref="AiNarrationErrorReason"/> so the view can show the offline affordance;
/// cancellation propagates as <see cref="OperationCanceledException"/>. The bearer token is never logged.
/// WinUI-free.
/// </summary>
public sealed class HttpYearReviewNarrationStreamTransport : IAiYearReviewNarrationStreamTransport
{
    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly ITokenProvider _tokenProvider;
    private readonly Action<string>? _diagnostics;

    /// <summary>Creates the transport over a configured client, options and token provider.</summary>
    /// <param name="http">The HTTP client (base address + handler supplied by the host composition root).</param>
    /// <param name="options">The API options carrying the version base path and fallback base address.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    /// <param name="diagnostics">An optional PII-safe diagnostics sink (never receives the token or body).</param>
    public HttpYearReviewNarrationStreamTransport(
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
    public async IAsyncEnumerable<AiNarrationStreamEvent> StreamAsync(
        AiYearReviewNarrationRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Open the response. Network faults become a terminal Error event (mirroring the web hook's
        // finalizeError), never an exception across the enumerator boundary. Cancellation propagates.
        var open = await OpenAsync(request, cancellationToken).ConfigureAwait(false);
        if (open.Failure is { } openFailure)
        {
            yield return openFailure;
            yield break;
        }

        using var response = open.Response!;
        if (!response.IsSuccessStatusCode)
        {
            // web: `stream_http_${res.status}` — off-mode 404, feature-off 404, 5xx, rate-limit, etc.
            yield return AiNarrationStreamEvent.Error(
                string.Concat("stream_http_", ((int)response.StatusCode).ToString(CultureInfo.InvariantCulture)),
                AiNarrationErrorReason.Http);
            yield break;
        }

        var readerState = await OpenReaderAsync(response, cancellationToken).ConfigureAwait(false);
        if (readerState.Failure is { } readerFailure)
        {
            yield return readerFailure;
            yield break;
        }

        using var stream = readerState.Stream!;
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: false);

        var frame = new StringBuilder();
        while (true)
        {
            var read = await ReadLineAsync(reader, cancellationToken).ConfigureAwait(false);
            if (read.Failure is { } lineFailure)
            {
                yield return lineFailure;
                yield break;
            }

            if (read.EndOfStream)
            {
                break;
            }

            var line = read.Line ?? string.Empty;
            if (line.Length == 0)
            {
                // Blank line terminates a frame (web split on /\r?\n\r?\n/).
                foreach (var ev in Flush(frame))
                {
                    yield return ev;
                }

                continue;
            }

            if (frame.Length > 0)
            {
                frame.Append('\n');
            }

            frame.Append(line);
        }

        // Drain a final frame that arrived without a trailing blank line.
        foreach (var ev in Flush(frame))
        {
            yield return ev;
        }
    }

    private static IEnumerable<AiNarrationStreamEvent> Flush(StringBuilder frame)
    {
        if (frame.Length == 0)
        {
            yield break;
        }

        var raw = frame.ToString();
        frame.Clear();
        if (raw.Trim().Length == 0)
        {
            yield break;
        }

        var ev = AiNarrationSseParser.ParseFrame(raw);
        if (ev is not null)
        {
            yield return ev;
        }
    }

    private async Task<OpenResult> OpenAsync(AiYearReviewNarrationRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var uri = BuildUri(AIYearReviewNarrationRegistration.NarratePath);
            using var message = new HttpRequestMessage(HttpMethod.Post, uri);
            message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
            message.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true };

            var token = await _tokenProvider.GetTokenAsync(cancellationToken).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(token))
            {
                message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            }

            var json = JsonSerializer.Serialize(request, _options.Json);
            message.Content = new StringContent(json, Encoding.UTF8, "application/json");

            _diagnostics?.Invoke($"ai-narrate \u2192 POST {uri.AbsolutePath}");

            var response = await _http
                .SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);
            return new OpenResult(response, null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (HttpRequestException)
        {
            return new OpenResult(null, AiNarrationStreamEvent.Error("stream_network", AiNarrationErrorReason.Network));
        }
        catch (IOException)
        {
            return new OpenResult(null, AiNarrationStreamEvent.Error("stream_network", AiNarrationErrorReason.Network));
        }
    }

    private static async Task<ReaderResult> OpenReaderAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        try
        {
            var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            return new ReaderResult(stream, null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (HttpRequestException)
        {
            return new ReaderResult(null, AiNarrationStreamEvent.Error("stream_network", AiNarrationErrorReason.Network));
        }
        catch (IOException)
        {
            return new ReaderResult(null, AiNarrationStreamEvent.Error("stream_network", AiNarrationErrorReason.Network));
        }
    }

    private static async Task<LineResult> ReadLineAsync(StreamReader reader, CancellationToken cancellationToken)
    {
        try
        {
            var line = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            return line is null ? new LineResult(null, true, null) : new LineResult(line, false, null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (IOException)
        {
            return new LineResult(null, false, AiNarrationStreamEvent.Error("stream_network", AiNarrationErrorReason.Network));
        }
    }

    private Uri BuildUri(string path)
    {
        var versioned = string.Concat(_options.VersionBasePath.TrimEnd('/'), "/", path.TrimStart('/'));
        return new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);
    }

    private readonly struct OpenResult
    {
        public OpenResult(HttpResponseMessage? response, AiNarrationStreamEvent? failure)
        {
            Response = response;
            Failure = failure;
        }

        public HttpResponseMessage? Response { get; }

        public AiNarrationStreamEvent? Failure { get; }
    }

    private readonly struct ReaderResult
    {
        public ReaderResult(Stream? stream, AiNarrationStreamEvent? failure)
        {
            Stream = stream;
            Failure = failure;
        }

        public Stream? Stream { get; }

        public AiNarrationStreamEvent? Failure { get; }
    }

    private readonly struct LineResult
    {
        public LineResult(string? line, bool endOfStream, AiNarrationStreamEvent? failure)
        {
            Line = line;
            EndOfStream = endOfStream;
            Failure = failure;
        }

        public string? Line { get; }

        public bool EndOfStream { get; }

        public AiNarrationStreamEvent? Failure { get; }
    }
}
