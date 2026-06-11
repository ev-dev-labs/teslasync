using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.SharedSurfaces;

// The AI-feature visibility gate (IAiFeatureGate) and its predicate/AI-off implementations
// (DelegateAiFeatureGate, StaticAiFeatureGate) are defined once for all AI shared surfaces in
// AICabinTemperatureImpactNarrative.Source.cs (the canonical home); this surface reuses them, mirroring how
// AIRAGHelp and AINLGrafanaPanel consume the shared gate rather than redeclaring it.

/// <summary>
/// The streaming data port the <see cref="AIVoiceModeViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the web <c>useAiStream</c> hook (web/src/hooks/useAiStream.ts). It opens one voice-reply
/// stream per <see cref="StreamAsync"/> call and yields the parsed lifecycle events (deltas, the terminal done /
/// error) in arrival order; cancelling the token aborts the stream (the native analogue of the hook's
/// <c>AbortController</c>, which the web component also fires from <c>cancel()</c> alongside
/// <c>speechSynthesis.cancel()</c>). The view never performs HTTP — the concrete
/// <see cref="HttpAiVoiceStreamTransport"/> (or a test fake) drives this.
/// </summary>
public interface IAiVoiceStreamTransport
{
    /// <summary>Open a voice-reply stream for the request body and yield its events until the stream closes.</summary>
    /// <param name="request">The transcribed-question request body (web <c>{ message, session_id }</c>).</param>
    /// <param name="cancellationToken">Cancels the stream (the web <c>AbortController</c>).</param>
    /// <returns>The parsed lifecycle events in arrival order.</returns>
    IAsyncEnumerable<AiVoiceStreamEvent> StreamAsync(
        AiVoiceRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// On-device speech-to-text dictation — the native analogue of the browser <c>SpeechRecognition</c> the web
/// component feature-detects and drives (web AIVoiceMode L48-L75, L300-L369). The audio never leaves the device;
/// only the transcribed text is surfaced through <see cref="TranscriptUpdated"/>. <see cref="IsSupported"/>
/// mirrors the web's <c>getSpeechRecognitionCtor() !== null</c> capability probe — when false the surface shows
/// the dictation-unavailable hint instead of erroring. The concrete WinRT-backed recognizer lives in the view;
/// the view-model binds only this port so it is unit-tested headlessly.
/// </summary>
public interface ISpeechDictation
{
    /// <summary>Recognized text arrived to append to the transcript (web <c>rec.onresult</c>).</summary>
    event EventHandler<SpeechDictationTextEventArgs>? TranscriptUpdated;

    /// <summary>Dictation failed (web <c>rec.onerror</c>); carries the recognizer's reason token.</summary>
    event EventHandler<SpeechDictationErrorEventArgs>? ErrorRaised;

    /// <summary>The recognition session ended (web <c>rec.onend</c>).</summary>
    event EventHandler? Ended;

    /// <summary>True when on-device dictation is available (web <c>sttSupported</c>).</summary>
    bool IsSupported { get; }

    /// <summary>Begin a dictation session in the given BCP-47 language (web <c>rec.start()</c>).</summary>
    /// <param name="languageTag">The recognition language (web <c>rec.lang = ttsLang</c>).</param>
    void Start(string languageTag);

    /// <summary>Stop the session, keeping any recognized text (web <c>rec.stop()</c>).</summary>
    void StopDictation();

    /// <summary>Abort the session immediately, e.g. on teardown (web <c>rec.abort()</c>).</summary>
    void Abort();
}

/// <summary>
/// On-device text-to-speech playback — the native analogue of the browser <c>speechSynthesis</c> the web
/// component uses (web AIVoiceMode L142-L165). Audio is produced and played locally; failures are non-fatal
/// (the reply still renders). The concrete WinRT-backed synthesizer lives in the view; the view-model binds only
/// this port so it is unit-tested headlessly.
/// </summary>
public interface ISpeechPlayback
{
    /// <summary>Speak a single sentence in the given BCP-47 language (web <c>speakSentence</c>).</summary>
    /// <param name="text">The sentence to read aloud.</param>
    /// <param name="languageTag">The synthesis language (web <c>utter.lang = lang</c>).</param>
    void Speak(string text, string languageTag);

    /// <summary>Stop any in-flight utterances immediately (web <c>speechSynthesis.cancel()</c>).</summary>
    void Cancel();
}

/// <summary>
/// Persists the in-progress transcript draft across renders — the native analogue of the web
/// <c>localStorage</c> draft (ADR-015 §I12, web AIVoiceMode L77-L102). The concrete
/// <c>ApplicationData</c>-backed store lives in the view; the view-model binds only this port so it is unit-tested
/// headlessly. Storage may be unavailable, so implementations must never throw.
/// </summary>
public interface ITranscriptDraftStore
{
    /// <summary>Read the persisted draft, or empty when none / unavailable (web <c>readTranscriptDraft</c>).</summary>
    /// <returns>The persisted draft text.</returns>
    string GetDraft();

    /// <summary>Persist (or, for empty, clear) the draft (web <c>persistTranscriptDraft</c>).</summary>
    /// <param name="value">The draft text; empty clears it.</param>
    void SetDraft(string value);
}

/// <summary>Recognized text from a dictation session (web <c>rec.onresult</c> accumulated transcript).</summary>
public sealed class SpeechDictationTextEventArgs : EventArgs
{
    /// <summary>Creates the args for a recognized text segment.</summary>
    /// <param name="text">The recognized text to append to the transcript.</param>
    public SpeechDictationTextEventArgs(string text) => Text = text ?? string.Empty;

    /// <summary>The recognized text segment (web <c>acc</c>).</summary>
    public string Text { get; }
}

/// <summary>A dictation failure (web <c>rec.onerror</c>'s <c>ev.error</c>).</summary>
public sealed class SpeechDictationErrorEventArgs : EventArgs
{
    /// <summary>Creates the args for a dictation failure reason.</summary>
    /// <param name="reason">The recognizer's error token.</param>
    public SpeechDictationErrorEventArgs(string reason) => Reason = reason ?? string.Empty;

    /// <summary>The recognizer's error token (web <c>ev.error</c>).</summary>
    public string Reason { get; }
}

/// <summary>
/// The headless / default <see cref="ISpeechDictation"/> that reports dictation unavailable and does nothing —
/// the native analogue of the web Firefox path where <c>getSpeechRecognitionCtor()</c> returns null and the
/// surface shows the "voice input is not available" hint. Used by tests and as the safe default when the host
/// supplies no recognizer.
/// </summary>
public sealed class UnavailableSpeechDictation : ISpeechDictation
{
    /// <summary>The shared singleton instance.</summary>
    public static UnavailableSpeechDictation Instance { get; } = new();

    private UnavailableSpeechDictation()
    {
    }

    /// <inheritdoc />
    public event EventHandler<SpeechDictationTextEventArgs>? TranscriptUpdated
    {
        add { /* never raised: dictation is unavailable */ }
        remove { /* never raised: dictation is unavailable */ }
    }

    /// <inheritdoc />
    public event EventHandler<SpeechDictationErrorEventArgs>? ErrorRaised
    {
        add { /* never raised: dictation is unavailable */ }
        remove { /* never raised: dictation is unavailable */ }
    }

    /// <inheritdoc />
    public event EventHandler? Ended
    {
        add { /* never raised: dictation is unavailable */ }
        remove { /* never raised: dictation is unavailable */ }
    }

    /// <inheritdoc />
    public bool IsSupported => false;

    /// <inheritdoc />
    public void Start(string languageTag)
    {
        // No recognizer available; the view-model surfaces the unsupported error/hint instead.
    }

    /// <inheritdoc />
    public void StopDictation()
    {
        // Nothing to stop.
    }

    /// <inheritdoc />
    public void Abort()
    {
        // Nothing to abort.
    }
}

/// <summary>
/// The headless / default <see cref="ISpeechPlayback"/> that produces no audio — the native analogue of a host
/// without speech synthesis (web <c>speechSynthesis</c> absent), where playback is a silent no-op and the reply
/// still renders. Used by tests and as the safe default when the host supplies no synthesizer.
/// </summary>
public sealed class SilentSpeechPlayback : ISpeechPlayback
{
    /// <summary>The shared singleton instance.</summary>
    public static SilentSpeechPlayback Instance { get; } = new();

    private SilentSpeechPlayback()
    {
    }

    /// <inheritdoc />
    public void Speak(string text, string languageTag)
    {
        // No synthesizer available; playback is a silent no-op (the reply still renders in the panel).
    }

    /// <inheritdoc />
    public void Cancel()
    {
        // Nothing to cancel.
    }
}

/// <summary>
/// The headless / default <see cref="ITranscriptDraftStore"/> that never persists — the native analogue of a host
/// without storage (web <c>localStorage</c> unavailable in Safari private mode / over quota), where the panel
/// still works without persistence. Used by tests and as the safe default when the host supplies no store.
/// </summary>
public sealed class NullTranscriptDraftStore : ITranscriptDraftStore
{
    /// <summary>The shared singleton instance.</summary>
    public static NullTranscriptDraftStore Instance { get; } = new();

    private NullTranscriptDraftStore()
    {
    }

    /// <inheritdoc />
    public string GetDraft() => string.Empty;

    /// <inheritdoc />
    public void SetDraft(string value)
    {
        // No persistence available; the panel still works without remembering the draft.
    }
}

/// <summary>
/// The production <see cref="IAiVoiceStreamTransport"/>: streams <c>text/event-stream</c> over an
/// <see cref="HttpClient"/> by POSTing the voice request body — the native analogue of the web <c>useAiStream</c>
/// using <c>fetch</c> + a <c>ReadableStream</c> reader (EventSource cannot POST a body,
/// web/src/hooks/useAiStream.ts L9-L17). Each call attaches the current bearer token from the
/// <see cref="ITokenProvider"/>, reads the response line by line, reassembles blank-line-delimited frames and
/// parses them through <see cref="AiVoiceSseParser"/>. Failures are surfaced as a terminal
/// <see cref="AiVoiceEventKind.Error"/> event (never an exception across the enumerator boundary) with a
/// classified <see cref="AiVoiceErrorReason"/> so the view can show the offline affordance; cancellation
/// propagates as <see cref="OperationCanceledException"/>. The bearer token is never logged. WinUI-free.
/// </summary>
public sealed class HttpAiVoiceStreamTransport : IAiVoiceStreamTransport
{
    private readonly HttpClient _http;
    private readonly ApiClientOptions _options;
    private readonly ITokenProvider _tokenProvider;
    private readonly Action<string>? _diagnostics;

    /// <summary>Creates the transport over a configured client, options and token provider.</summary>
    /// <param name="http">The HTTP client (base address + handler from the composition root).</param>
    /// <param name="options">The API options carrying the version base path and fallback base address.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    /// <param name="diagnostics">An optional PII-safe diagnostics sink (the bearer token is never logged).</param>
    public HttpAiVoiceStreamTransport(
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
    public async IAsyncEnumerable<AiVoiceStreamEvent> StreamAsync(
        AiVoiceRequest request,
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
            yield return AiVoiceStreamEvent.Error(
                string.Concat(
                    "stream_http_",
                    ((int)response.StatusCode).ToString(System.Globalization.CultureInfo.InvariantCulture)),
                AiVoiceErrorReason.Http);
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

    private static IEnumerable<AiVoiceStreamEvent> Flush(StringBuilder frame)
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

        var ev = AiVoiceSseParser.ParseFrame(raw);
        if (ev is not null)
        {
            yield return ev;
        }
    }

    private async Task<OpenResult> OpenAsync(AiVoiceRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var uri = BuildUri(AIVoiceModeRegistration.ChatPath);
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

            _diagnostics?.Invoke($"ai-voice-chat \u2192 POST {uri.AbsolutePath}");

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
            return new OpenResult(null, AiVoiceStreamEvent.Error("stream_network", AiVoiceErrorReason.Network));
        }
        catch (IOException)
        {
            return new OpenResult(null, AiVoiceStreamEvent.Error("stream_network", AiVoiceErrorReason.Network));
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
            return new ReaderResult(null, AiVoiceStreamEvent.Error("stream_network", AiVoiceErrorReason.Network));
        }
        catch (IOException)
        {
            return new ReaderResult(null, AiVoiceStreamEvent.Error("stream_network", AiVoiceErrorReason.Network));
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
            return new LineResult(null, false, AiVoiceStreamEvent.Error("stream_network", AiVoiceErrorReason.Network));
        }
    }

    private Uri BuildUri(string path)
    {
        var versioned = string.Concat(_options.VersionBasePath.TrimEnd('/'), "/", path.TrimStart('/'));
        return new Uri(_http.BaseAddress ?? _options.BaseAddress, versioned);
    }

    private readonly struct OpenResult
    {
        public OpenResult(HttpResponseMessage? response, AiVoiceStreamEvent? failure)
        {
            Response = response;
            Failure = failure;
        }

        public HttpResponseMessage? Response { get; }

        public AiVoiceStreamEvent? Failure { get; }
    }

    private readonly struct ReaderResult
    {
        public ReaderResult(Stream? stream, AiVoiceStreamEvent? failure)
        {
            Stream = stream;
            Failure = failure;
        }

        public Stream? Stream { get; }

        public AiVoiceStreamEvent? Failure { get; }
    }

    private readonly struct LineResult
    {
        public LineResult(string? line, bool endOfStream, AiVoiceStreamEvent? failure)
        {
            Line = line;
            EndOfStream = endOfStream;
            Failure = failure;
        }

        public string? Line { get; }

        public bool EndOfStream { get; }

        public AiVoiceStreamEvent? Failure { get; }
    }
}
