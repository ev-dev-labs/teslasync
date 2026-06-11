using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIVoiceMode"/> view — the native port of the web
/// component body (web/src/components/ai/AIVoiceMode.tsx) composed with its <c>AIFeatureCard</c> +
/// <c>useAiStream</c> render contract. It mirrors the web behaviours exactly: the <c>withAiFeature</c> gate
/// (<see cref="IsGateOpen"/>); on-device dictation driving the transcript (<see cref="ISpeechDictation"/>, web
/// <c>SpeechRecognition</c>); on-device playback reading the streamed reply aloud one sentence at a time
/// (<see cref="ISpeechPlayback"/> + <see cref="VoiceSentenceChunker"/>, web <c>speechSynthesis</c>); the
/// <c>canStart</c> guard (<see cref="CanStart"/> = a non-blank trimmed transcript and no in-flight stream); and
/// the <c>useAiStream</c> lifecycle (<see cref="State"/> idle → streaming → done / error, duplicate
/// <see cref="Start"/> a no-op, cancel → idle). The body POSTed is <c>{ message, session_id }</c> with a stable
/// per-instance <see cref="SessionId"/>. The view binds the projected labels and flags and never performs HTTP.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AIVoiceModeViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiVoiceStreamTransport _transport;
    private readonly ILocalizer _localizer;
    private readonly ISpeechDictation _dictation;
    private readonly ISpeechPlayback _playback;
    private readonly ITranscriptDraftStore _draftStore;
    private readonly bool _isGateOpen;
    private readonly bool _speechSupported;

    private string _transcript = string.Empty;
    private bool _listening;
    private bool _ttsEnabled = true;
    private string _sttError = string.Empty;
    private AiVoiceStreamState _state = AiVoiceStreamState.Idle;
    private string _assistantText = string.Empty;
    private string _errorMessage = string.Empty;
    private AiVoiceErrorReason _errorReason = AiVoiceErrorReason.Unknown;
    private string _ttsBuffer = string.Empty;

    private CancellationTokenSource? _cts;
    private bool _running;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its streaming transport (P1/S8 seam), the AI feature gate, the i18n facade, the
    /// dictation + playback device ports and the transcript-draft store. Throws when the surface's feature id is
    /// not in the canonical AI feature registry — the native analogue of <c>withAiFeature</c> rejecting an
    /// unknown id at module load.
    /// </summary>
    /// <param name="transport">The cache-free SSE reply transport.</param>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c>); off collapses the whole surface.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="dictation">The on-device speech-to-text port (web <c>SpeechRecognition</c>).</param>
    /// <param name="playback">The on-device text-to-speech port (web <c>speechSynthesis</c>).</param>
    /// <param name="draftStore">The transcript-draft persistence port (web <c>localStorage</c>).</param>
    public AIVoiceModeViewModel(
        IAiVoiceStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        ISpeechDictation? dictation = null,
        ISpeechPlayback? playback = null,
        ITranscriptDraftStore? draftStore = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        if (!AIVoiceModeRegistration.IsRegisteredFeature(AIVoiceModeRegistration.FeatureId))
        {
            throw new InvalidOperationException(
                $"Unknown AI feature id '{AIVoiceModeRegistration.FeatureId}'. " +
                "Add it to the AI feature registry (web/src/ai/features.ts) and regenerate.");
        }

        _transport = transport;
        _localizer = localizer;
        _dictation = dictation ?? UnavailableSpeechDictation.Instance;
        _playback = playback ?? SilentSpeechPlayback.Instance;
        _draftStore = draftStore ?? NullTranscriptDraftStore.Instance;
        _isGateOpen = gate.IsEnabled(AIVoiceModeRegistration.FeatureId);
        _speechSupported = _dictation.IsSupported;

        SessionId = NewSessionId();

        _dictation.TranscriptUpdated += OnTranscriptUpdated;
        _dictation.ErrorRaised += OnDictationError;
        _dictation.Ended += OnDictationEnded;

        // Restore the in-progress draft (web readTranscriptDraft on first render).
        _transcript = _draftStore.GetDraft();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// True when the AI feature is enabled (web <c>useAiEnabled</c>). When false the whole surface renders
    /// nothing — the native analogue of <c>withAiFeature</c> returning <see langword="null"/>.
    /// </summary>
    public bool IsGateOpen => _isGateOpen;

    /// <summary>The stable per-instance voice session id POSTed in the body (web <c>session_id</c>).</summary>
    public string SessionId { get; }

    /// <summary>
    /// The dictated question (web local <c>transcript</c> state, bound to the transcript region). Reassigning
    /// re-evaluates <see cref="CanStart"/> and persists the draft while no stream is in flight (web persist
    /// effect, skipped during <c>streaming</c> / <c>paused-confirm</c>).
    /// </summary>
    public string Transcript
    {
        get => _transcript;
        set
        {
            var next = value ?? string.Empty;
            if (string.Equals(_transcript, next, StringComparison.Ordinal))
            {
                return;
            }

            _transcript = next;

            // web persist effect: do NOT persist while the stream is in flight (the user has committed by
            // sending); otherwise keep the draft in sync as the user dictates / edits.
            if (_state is not (AiVoiceStreamState.Streaming or AiVoiceStreamState.PausedConfirm))
            {
                _draftStore.SetDraft(_transcript);
            }

            Raise(nameof(Transcript));
            Raise(nameof(HasTranscript));
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
            Raise(nameof(ShowEmptyHint));
            Raise(nameof(TranscriptIsHint));
            Raise(nameof(TranscriptDisplay));
        }
    }

    /// <summary>True while a dictation session is active (web local <c>listening</c> state).</summary>
    public bool IsListening
    {
        get => _listening;
        private set
        {
            if (_listening == value)
            {
                return;
            }

            _listening = value;
            Raise(nameof(IsListening));
            Raise(nameof(MicButtonIsStop));
            Raise(nameof(MicLabel));
            Raise(nameof(MicAutomationName));
            Raise(nameof(TranscriptIsHint));
            Raise(nameof(TranscriptDisplay));
        }
    }

    /// <summary>True when spoken replies are enabled (web local <c>ttsEnabled</c> state, default on).</summary>
    public bool IsTtsEnabled
    {
        get => _ttsEnabled;
        private set
        {
            if (_ttsEnabled == value)
            {
                return;
            }

            _ttsEnabled = value;
            Raise(nameof(IsTtsEnabled));
            Raise(nameof(TtsToggleLabel));
            Raise(nameof(TtsToggleAutomationName));
        }
    }

    /// <summary>The dictation error text, or empty (web local <c>sttError</c> state).</summary>
    public string SttError
    {
        get => _sttError;
        private set
        {
            var next = value ?? string.Empty;
            if (string.Equals(_sttError, next, StringComparison.Ordinal))
            {
                return;
            }

            _sttError = next;
            Raise(nameof(SttError));
            Raise(nameof(HasSttError));
            Raise(nameof(ShowUnsupportedHint));
        }
    }

    /// <summary>The current stream lifecycle state (web <c>stream.state</c>).</summary>
    public AiVoiceStreamState State
    {
        get => _state;
        private set
        {
            if (_state == value)
            {
                return;
            }

            _state = value;
            Raise(nameof(State));
            Raise(nameof(IsStreaming));
            Raise(nameof(IsBusy));
            Raise(nameof(CanStart));
            Raise(nameof(IsActionEnabled));
            Raise(nameof(IsThinking));
            Raise(nameof(IsError));
            Raise(nameof(IsOffline));
            Raise(nameof(HasOutput));
            Raise(nameof(ActionLabel));
            Raise(nameof(DisplayErrorText));
            Raise(nameof(MicStartEnabled));
            Raise(nameof(ShowStopButton));
        }
    }

    /// <summary>The accumulated streamed reply text (web <c>stream.text</c>, fed to the output panel).</summary>
    public string AssistantText
    {
        get => _assistantText;
        private set
        {
            if (string.Equals(_assistantText, value, StringComparison.Ordinal))
            {
                return;
            }

            _assistantText = value;
            Raise(nameof(AssistantText));
            Raise(nameof(IsThinking));
            Raise(nameof(HasOutput));
        }
    }

    /// <summary>True when on-device dictation is available (web <c>sttSupported</c>).</summary>
    public bool SpeechSupported => _speechSupported;

    /// <summary>True when the trimmed transcript is non-blank.</summary>
    public bool HasTranscript => _transcript.Trim().Length > 0;

    /// <summary>True while the SSE stream is open (web <c>stream.state === 'streaming'</c>).</summary>
    public bool IsStreaming => _state == AiVoiceStreamState.Streaming;

    /// <summary>
    /// True while a stream is in flight (open or paused for confirmation) — web <c>isBusy</c>
    /// (<c>state === 'streaming' || state === 'paused-confirm'</c>).
    /// </summary>
    public bool IsBusy => _state is AiVoiceStreamState.Streaming or AiVoiceStreamState.PausedConfirm;

    /// <summary>
    /// True when the surface has what it needs to fire the stream — a non-blank transcript and no in-flight
    /// stream (web <c>canStart = transcript.trim().length &gt; 0 &amp;&amp; !isBusy</c>).
    /// </summary>
    public bool CanStart => HasTranscript && !IsBusy;

    /// <summary>
    /// True when the action button is interactive — there is a transcript and no stream is open (web card
    /// <c>disabled={!canStart || streaming}</c>).
    /// </summary>
    public bool IsActionEnabled => CanStart && !IsStreaming;

    /// <summary>
    /// True once a stream has run (or is running) — the output panel is shown (web <c>AiOutputPanel</c>
    /// <c>hasAnything = text.length &gt; 0 || state ∈ {streaming, error, done}</c>); idle with no text hides it.
    /// </summary>
    public bool HasOutput =>
        _assistantText.Length > 0 ||
        _state is AiVoiceStreamState.Streaming or AiVoiceStreamState.Done or AiVoiceStreamState.Error;

    /// <summary>
    /// True while the stream is open but no text has arrived yet — the thinking indicator shows (web
    /// <c>text.length === 0 &amp;&amp; state === 'streaming'</c>).
    /// </summary>
    public bool IsThinking => IsStreaming && _assistantText.Length == 0;

    /// <summary>True when the stream ended in failure (web <c>state === 'error'</c>).</summary>
    public bool IsError => _state == AiVoiceStreamState.Error;

    /// <summary>True when the failure was a connectivity fault — drives the offline message rather than the generic error.</summary>
    public bool IsOffline => _state == AiVoiceStreamState.Error && _errorReason == AiVoiceErrorReason.Network;

    /// <summary>True when the mic control is in its "stop" state (web ternary on <c>listening</c>).</summary>
    public bool MicButtonIsStop => _listening;

    /// <summary>
    /// True when the mic-start control is interactive — dictation is supported and no stream is in flight (web
    /// start mic <c>disabled={!sttSupported || isBusy}</c>). Meaningful only while not listening.
    /// </summary>
    public bool MicStartEnabled => _speechSupported && !IsBusy;

    /// <summary>True when the stop-all control is shown (web <c>isBusy &amp;&amp; &lt;Button/&gt;</c>).</summary>
    public bool ShowStopButton => IsBusy;

    /// <summary>True when the AIFeatureCard empty hint shows — the transcript is blank (web emptyHint when transcript empty).</summary>
    public bool ShowEmptyHint => !HasTranscript;

    /// <summary>True when a dictation error is present (web <c>sttError</c> paragraph shown).</summary>
    public bool HasSttError => _sttError.Length > 0;

    /// <summary>True when the dictation-unavailable hint shows (web <c>!sttSupported &amp;&amp; !sttError</c>).</summary>
    public bool ShowUnsupportedHint => !_speechSupported && _sttError.Length == 0;

    /// <summary>True when the transcript region shows the muted hint rather than dictated text (web ternary on transcript).</summary>
    public bool TranscriptIsHint => !HasTranscript;

    /// <summary>
    /// The transcript region content — the dictated text, or the listening / idle hint when blank (web
    /// transcript ternary: <c>transcript</c> else <c>listening ? listeningHint : idleHint</c>).
    /// </summary>
    public string TranscriptDisplay
    {
        get
        {
            if (HasTranscript)
            {
                return _transcript;
            }

            return _listening ? ListeningHint : IdleHint;
        }
    }

    /// <summary>The localized card title (web <c>voiceMode.title</c>).</summary>
    public string Title => _localizer.GetString(
        AIVoiceModeRegistration.TitleKey,
        AIVoiceModeRegistration.TitleFallback);

    /// <summary>The localized card description (web <c>voiceMode.description</c>).</summary>
    public string Description => _localizer.GetString(
        AIVoiceModeRegistration.DescriptionKey,
        AIVoiceModeRegistration.DescriptionFallback);

    /// <summary>The localized per-feature action verb (web <c>voiceMode.button</c>).</summary>
    public string ButtonLabel => _localizer.GetString(
        AIVoiceModeRegistration.ButtonKey,
        AIVoiceModeRegistration.ButtonFallback);

    /// <summary>The localized badge text (web AIBadge default <c>helix.badge</c>).</summary>
    public string BadgeLabel => _localizer.GetString(
        AIVoiceModeRegistration.BadgeKey,
        AIVoiceModeRegistration.BadgeFallback);

    /// <summary>The localized transcript-region accessible name (web <c>voiceMode.transcriptLabel</c>).</summary>
    public string TranscriptLabel => _localizer.GetString(
        AIVoiceModeRegistration.TranscriptLabelKey,
        AIVoiceModeRegistration.TranscriptLabelFallback);

    /// <summary>The localized listening hint (web <c>voiceMode.listeningHint</c>).</summary>
    public string ListeningHint => _localizer.GetString(
        AIVoiceModeRegistration.ListeningHintKey,
        AIVoiceModeRegistration.ListeningHintFallback);

    /// <summary>The localized idle hint (web <c>voiceMode.idleHint</c>).</summary>
    public string IdleHint => _localizer.GetString(
        AIVoiceModeRegistration.IdleHintKey,
        AIVoiceModeRegistration.IdleHintFallback);

    /// <summary>The localized dictation-unavailable hint (web <c>voiceMode.unsupportedHint</c>).</summary>
    public string UnsupportedHint => _localizer.GetString(
        AIVoiceModeRegistration.UnsupportedHintKey,
        AIVoiceModeRegistration.UnsupportedHintFallback);

    /// <summary>The localized AIFeatureCard empty hint (web <c>voiceMode.emptyHint</c>).</summary>
    public string EmptyHint => _localizer.GetString(
        AIVoiceModeRegistration.EmptyHintKey,
        AIVoiceModeRegistration.EmptyHintFallback);

    /// <summary>The universal idle CTA label (web <c>helix.askHelix</c>).</summary>
    public string AskHelixLabel => _localizer.GetString(
        AIVoiceModeRegistration.AskHelixKey,
        AIVoiceModeRegistration.AskHelixFallback);

    /// <summary>The streaming button label (web <c>helix.thinking</c>).</summary>
    public string ThinkingLabel => _localizer.GetString(
        AIVoiceModeRegistration.ThinkingKey,
        AIVoiceModeRegistration.ThinkingFallback);

    /// <summary>
    /// The action button's visible label — the streaming "thinking" copy while in flight, otherwise the
    /// universal "Ask Helix" CTA (web <c>{isStreaming ? &lt;AIThinkingDots/&gt; : askHelixLabel}</c>).
    /// </summary>
    public string ActionLabel => IsStreaming ? ThinkingLabel : AskHelixLabel;

    /// <summary>
    /// The action button's accessible name — "Ask Helix · Speak to Helix" (web button
    /// <c>aria-label={`${askHelixLabel} · ${buttonLabel}`}</c>).
    /// </summary>
    public string ActionAutomationName =>
        string.Concat(AskHelixLabel, " \u00b7 ", ButtonLabel);

    /// <summary>The mic control's visible label — "Stop mic" while listening, else "Speak" (web ternary).</summary>
    public string MicLabel => _listening
        ? _localizer.GetString(AIVoiceModeRegistration.StopListeningShortKey, AIVoiceModeRegistration.StopListeningShortFallback)
        : _localizer.GetString(AIVoiceModeRegistration.StartListeningShortKey, AIVoiceModeRegistration.StartListeningShortFallback);

    /// <summary>The mic control's accessible name — "Stop listening" while listening, else "Start listening".</summary>
    public string MicAutomationName => _listening
        ? _localizer.GetString(AIVoiceModeRegistration.StopListeningKey, AIVoiceModeRegistration.StopListeningFallback)
        : _localizer.GetString(AIVoiceModeRegistration.StartListeningKey, AIVoiceModeRegistration.StartListeningFallback);

    /// <summary>The TTS toggle's visible label — "Mute Helix" when on, else "Unmute Helix" (web ternary).</summary>
    public string TtsToggleLabel => _ttsEnabled
        ? _localizer.GetString(AIVoiceModeRegistration.MuteTtsShortKey, AIVoiceModeRegistration.MuteTtsShortFallback)
        : _localizer.GetString(AIVoiceModeRegistration.UnmuteTtsShortKey, AIVoiceModeRegistration.UnmuteTtsShortFallback);

    /// <summary>The TTS toggle's accessible name — "Mute spoken replies" when on, else "Unmute spoken replies".</summary>
    public string TtsToggleAutomationName => _ttsEnabled
        ? _localizer.GetString(AIVoiceModeRegistration.MuteTtsKey, AIVoiceModeRegistration.MuteTtsFallback)
        : _localizer.GetString(AIVoiceModeRegistration.UnmuteTtsKey, AIVoiceModeRegistration.UnmuteTtsFallback);

    /// <summary>The stop-all control's visible label (web <c>voiceMode.actions.stopAllShort</c>).</summary>
    public string StopAllLabel => _localizer.GetString(
        AIVoiceModeRegistration.StopAllShortKey,
        AIVoiceModeRegistration.StopAllShortFallback);

    /// <summary>The stop-all control's accessible name (web <c>voiceMode.actions.stopAll</c>).</summary>
    public string StopAllAutomationName => _localizer.GetString(
        AIVoiceModeRegistration.StopAllKey,
        AIVoiceModeRegistration.StopAllFallback);

    /// <summary>
    /// The inline error copy shown in the output panel — the offline message for a connectivity fault, else the
    /// "Helix error: &lt;message&gt;" composition (web <c>helix.errorLabel</c> + <c>error ?? errorUnknown</c>).
    /// </summary>
    public string DisplayErrorText
    {
        get
        {
            if (!IsError)
            {
                return string.Empty;
            }

            if (_errorReason == AiVoiceErrorReason.Network)
            {
                return _localizer.GetString(
                    AIVoiceModeRegistration.OfflineKey,
                    AIVoiceModeRegistration.OfflineFallback);
            }

            var label = _localizer.GetString(
                AIVoiceModeRegistration.ErrorLabelKey,
                AIVoiceModeRegistration.ErrorLabelFallback);
            var message = _errorMessage.Length > 0
                ? _errorMessage
                : _localizer.GetString(
                    AIVoiceModeRegistration.ErrorUnknownKey,
                    AIVoiceModeRegistration.ErrorUnknownFallback);
            return string.Concat(label, " ", message);
        }
    }

    /// <summary>
    /// Begin a dictation session (web <c>startListening</c>). When dictation is unavailable it surfaces the
    /// unsupported error instead (web <c>setSttError(t('voiceMode.errors.unsupported'))</c>); otherwise it clears
    /// any prior error, starts the recognizer in the UI language and flips to the listening state.
    /// </summary>
    public void StartListening()
    {
        if (_disposed)
        {
            return;
        }

        if (!_speechSupported)
        {
            SttError = _localizer.GetString(
                AIVoiceModeRegistration.ErrorUnsupportedKey,
                AIVoiceModeRegistration.ErrorUnsupportedFallback);
            return;
        }

        SttError = string.Empty;
        _dictation.Start(LanguageTag);
        IsListening = true;
    }

    /// <summary>Stop the dictation session, keeping the recognized text (web <c>stopListening</c>).</summary>
    public void StopListening()
    {
        _dictation.StopDictation();
        IsListening = false;
    }

    /// <summary>
    /// Stop everything — dictation, the in-flight stream and any spoken reply (web <c>handleStopAll</c> =
    /// <c>stopListening + cancelStream + cancelSpeech</c> and clearing the speech buffer).
    /// </summary>
    public void StopAll()
    {
        StopListening();
        CancelStream();
        _playback.Cancel();
        _ttsBuffer = string.Empty;
    }

    /// <summary>
    /// Toggle spoken replies (web <c>toggleTts</c>). Turning playback off cancels any in-flight utterance and
    /// drops the buffered speech so a muted reply is not spoken when re-enabled.
    /// </summary>
    public void ToggleTts()
    {
        var next = !_ttsEnabled;
        if (!next)
        {
            _playback.Cancel();
            _ttsBuffer = string.Empty;
        }

        IsTtsEnabled = next;
    }

    /// <summary>
    /// Fire the voice reply stream (web <c>handleAction</c> → reset the speech chunker, cancel any prior
    /// utterance, then <c>stream.start()</c>) as a detached task — the view's action handler. A duplicate call
    /// while streaming, a call with a blank transcript, or a call on a gated-off surface is a no-op (web button
    /// <c>disabled</c> + <c>canStart</c> guard).
    /// </summary>
    public void Start() => _ = StartAsync();

    /// <summary>
    /// Run one reply stream and fold every event into <see cref="State"/> / <see cref="AssistantText"/>, teeing
    /// completed sentences into playback — the awaitable core of <see cref="Start"/> (exposed for headless
    /// tests). Idempotent while a stream is in flight; cancelling returns the surface to
    /// <see cref="AiVoiceStreamState.Idle"/>.
    /// </summary>
    /// <param name="cancellationToken">Cancels the run (linked into the stream's abort token).</param>
    /// <returns>A task that completes when the stream settles.</returns>
    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || _running || !_isGateOpen || !CanStart)
        {
            return;
        }

        _running = true;

        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        // web handleAction: reset the speech chunker and cancel any prior utterance before each run.
        _ttsBuffer = string.Empty;
        _playback.Cancel();

        // web start(): reset the prior answer/error before each run (setText(''); setError(null)).
        AssistantText = string.Empty;
        _errorMessage = string.Empty;
        _errorReason = AiVoiceErrorReason.Unknown;
        State = AiVoiceStreamState.Streaming;

        var request = new AiVoiceRequest(_transcript.Trim(), SessionId);
        try
        {
            await foreach (var ev in _transport.StreamAsync(request, cts.Token).ConfigureAwait(false))
            {
                Apply(ev);
            }

            // web: if the loop ends without a terminal event while still streaming, mark done. A paused-confirm
            // is NOT promoted — the server intentionally closes after confirm_request.
            if (_state == AiVoiceStreamState.Streaming)
            {
                FinishDone();
            }
        }
        catch (OperationCanceledException)
        {
            // web abort path: a cancelled in-flight stream returns to idle.
            if (_state == AiVoiceStreamState.Streaming)
            {
                State = AiVoiceStreamState.Idle;
            }
        }
        catch (Exception ex)
        {
            // The transport surfaces failures as Error events; an unexpected throw still ends in the error
            // surface rather than leaving the card stuck in streaming.
            _playback.Cancel();
            _ttsBuffer = string.Empty;
            _errorMessage = ex.Message;
            _errorReason = AiVoiceErrorReason.Unknown;
            Raise(nameof(DisplayErrorText));
            State = AiVoiceStreamState.Error;
        }
        finally
        {
            _running = false;
        }
    }

    /// <summary>Abort the in-flight stream (web <c>stream.cancel()</c>); the lifecycle returns to idle.</summary>
    public void Cancel() => CancelStream();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        _dictation.TranscriptUpdated -= OnTranscriptUpdated;
        _dictation.ErrorRaised -= OnDictationError;
        _dictation.Ended -= OnDictationEnded;
        _dictation.Abort();
        _playback.Cancel();

        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();

        // web unmount cleanup (I12): do not leak the draft past teardown.
        _draftStore.SetDraft(string.Empty);

        GC.SuppressFinalize(this);
    }

    private static string NewSessionId() =>
        string.Concat(
            "voice_",
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture),
            "_",
            Guid.NewGuid().ToString("N")[..8]);

    private static string LanguageTag
    {
        get
        {
            var name = CultureInfo.CurrentUICulture.Name;
            return string.IsNullOrEmpty(name) ? "en-US" : name;
        }
    }

    private void CancelStream()
    {
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void OnTranscriptUpdated(object? sender, SpeechDictationTextEventArgs e)
    {
        if (_disposed || e.Text.Length == 0)
        {
            return;
        }

        // web onresult: append the recognized text to the running transcript, single-spaced.
        var trimmedPrev = _transcript.TrimEnd();
        Transcript = trimmedPrev.Length > 0
            ? string.Concat(trimmedPrev, " ", e.Text)
            : e.Text;
    }

    private void OnDictationError(object? sender, SpeechDictationErrorEventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        // web onerror: surface the failure reason and stop listening.
        var template = _localizer.GetString(
            AIVoiceModeRegistration.ErrorSttFailedKey,
            AIVoiceModeRegistration.ErrorSttFailedFallback);
        SttError = AIVoiceModeRegistration.FormatSttError(template, e.Reason);
        IsListening = false;
    }

    private void OnDictationEnded(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        // web onend: the session closed; leave the recognized text in place.
        IsListening = false;
    }

    private void Apply(AiVoiceStreamEvent ev)
    {
        switch (ev.Kind)
        {
            case AiVoiceEventKind.Delta:
                AssistantText = string.Concat(_assistantText, ev.Text);
                SpeakDelta(ev.Text);
                if (_state != AiVoiceStreamState.Streaming)
                {
                    State = AiVoiceStreamState.Streaming;
                }

                break;

            case AiVoiceEventKind.ConfirmRequest:
                State = AiVoiceStreamState.PausedConfirm;
                break;

            case AiVoiceEventKind.Done:
                FinishDone();
                break;

            case AiVoiceEventKind.Error:
                // web onEvent error: stop any in-flight utterance so the user is not talked over.
                _playback.Cancel();
                _ttsBuffer = string.Empty;
                _errorMessage = ev.Message;
                _errorReason = ev.ErrorReason;
                Raise(nameof(DisplayErrorText));
                State = AiVoiceStreamState.Error;
                break;

            case AiVoiceEventKind.ToolCall:
            case AiVoiceEventKind.ToolResult:
            default:
                // tool_call / tool_result frames update no visible state for this surface (web onEvent tees text only).
                break;
        }
    }

    private void SpeakDelta(string text)
    {
        // web onEvent delta: buffer the chunk and speak each completed sentence (when playback is on).
        if (!_ttsEnabled || text.Length == 0)
        {
            return;
        }

        _ttsBuffer = string.Concat(_ttsBuffer, text);
        var flush = VoiceSentenceChunker.PopCompleteSentences(_ttsBuffer);
        _ttsBuffer = flush.Remainder;
        foreach (var sentence in flush.Spoken)
        {
            _playback.Speak(sentence, LanguageTag);
        }
    }

    private void FinishDone()
    {
        // web onEvent done: speak whatever did not end on a sentence boundary, then settle + clear the draft.
        if (_ttsEnabled)
        {
            var tail = _ttsBuffer.Trim();
            if (tail.Length > 0)
            {
                _playback.Speak(tail, LanguageTag);
            }
        }

        _ttsBuffer = string.Empty;
        State = AiVoiceStreamState.Done;

        // web done effect: clear the just-sent prompt + its draft so a refresh does not repaint it.
        Transcript = string.Empty;
        _draftStore.SetDraft(string.Empty);
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
