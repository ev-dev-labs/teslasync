using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The streaming data port the <see cref="AINLGrafanaPanelViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the web <c>useAiStream</c> hook (web/src/hooks/useAiStream.ts). It opens one draft stream
/// per <see cref="StreamAsync"/> call and yields the parsed lifecycle events (deltas, the captured
/// <c>draft_grafana_panel</c> tool result, the terminal done / error) in arrival order; cancelling the token
/// aborts the stream (the native analogue of the hook's <c>AbortController</c>). The view never performs HTTP —
/// the concrete <see cref="HttpAiGrafanaDraftStreamTransport"/> (or a test fake) drives this. The AI feature
/// gate (<see cref="IAiFeatureGate"/>) is shared with the other AI shared surfaces.
/// </summary>
public interface IAiGrafanaDraftStreamTransport
{
    /// <summary>Open a draft stream for the request body and yield its events until the stream closes.</summary>
    IAsyncEnumerable<AiGrafanaDraftStreamEvent> StreamAsync(
        AiGrafanaDraftRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The production <see cref="IAiGrafanaDraftStreamTransport"/>: streams <c>text/event-stream</c> over an
/// <see cref="HttpClient"/> by POSTing the draft request body — the native analogue of the web
/// <c>useAiStream</c> using <c>fetch</c> + a <c>ReadableStream</c> reader (EventSource cannot POST a body,
/// web/src/hooks/useAiStream.ts L9-L17). Each call attaches the current bearer token from the
/// <see cref="ITokenProvider"/>, reads the response line by line, reassembles blank-line-delimited frames and
/// parses them through <see cref="AiGrafanaDraftSseParser"/>. Failures are surfaced as a terminal
/// <see cref="AiGrafanaDraftEventKind.Error"/> event (never an exception across the enumerator boundary) with a
/// classified <see cref="AiGrafanaDraftErrorReason"/> so the view can show the offline affordance; cancellation
/// propagates as <see cref="OperationCanceledException"/>. The bearer token is never logged. WinUI-free.
/// </summary>
public sealed class HttpAiGrafanaDraftStreamTransport : IAiGrafanaDraftStreamTransport
{
    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly ITokenProvider _tokenProvider;
    private readonly Action<string>? _diagnostics;

    /// <summary>Creates the transport over a configured client, options and token provider.</summary>
    public HttpAiGrafanaDraftStreamTransport(
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
    public async IAsyncEnumerable<AiGrafanaDraftStreamEvent> StreamAsync(
        AiGrafanaDraftRequest request,
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
            yield return AiGrafanaDraftStreamEvent.Error(
                string.Concat("stream_http_", ((int)response.StatusCode).ToString(System.Globalization.CultureInfo.InvariantCulture)),
                AiGrafanaDraftErrorReason.Http);
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

    private static IEnumerable<AiGrafanaDraftStreamEvent> Flush(StringBuilder frame)
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

        var ev = AiGrafanaDraftSseParser.ParseFrame(raw);
        if (ev is not null)
        {
            yield return ev;
        }
    }

    private async Task<OpenResult> OpenAsync(AiGrafanaDraftRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var uri = BuildUri(AINLGrafanaPanelRegistration.DraftPath);
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

            _diagnostics?.Invoke($"ai-grafana-draft \u2192 POST {uri.AbsolutePath}");

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
            return new OpenResult(null, AiGrafanaDraftStreamEvent.Error("stream_network", AiGrafanaDraftErrorReason.Network));
        }
        catch (IOException)
        {
            return new OpenResult(null, AiGrafanaDraftStreamEvent.Error("stream_network", AiGrafanaDraftErrorReason.Network));
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
            return new ReaderResult(null, AiGrafanaDraftStreamEvent.Error("stream_network", AiGrafanaDraftErrorReason.Network));
        }
        catch (IOException)
        {
            return new ReaderResult(null, AiGrafanaDraftStreamEvent.Error("stream_network", AiGrafanaDraftErrorReason.Network));
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
            return new LineResult(null, false, AiGrafanaDraftStreamEvent.Error("stream_network", AiGrafanaDraftErrorReason.Network));
        }
    }

    private Uri BuildUri(string path)
    {
        var versioned = string.Concat(_options.VersionBasePath.TrimEnd('/'), "/", path.TrimStart('/'));
        return new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);
    }

    private readonly struct OpenResult
    {
        public OpenResult(HttpResponseMessage? response, AiGrafanaDraftStreamEvent? failure)
        {
            Response = response;
            Failure = failure;
        }

        public HttpResponseMessage? Response { get; }

        public AiGrafanaDraftStreamEvent? Failure { get; }
    }

    private readonly struct ReaderResult
    {
        public ReaderResult(Stream? stream, AiGrafanaDraftStreamEvent? failure)
        {
            Stream = stream;
            Failure = failure;
        }

        public Stream? Stream { get; }

        public AiGrafanaDraftStreamEvent? Failure { get; }
    }

    private readonly struct LineResult
    {
        public LineResult(string? line, bool endOfStream, AiGrafanaDraftStreamEvent? failure)
        {
            Line = line;
            EndOfStream = endOfStream;
            Failure = failure;
        }

        public string? Line { get; }

        public bool EndOfStream { get; }

        public AiGrafanaDraftStreamEvent? Failure { get; }
    }
}
