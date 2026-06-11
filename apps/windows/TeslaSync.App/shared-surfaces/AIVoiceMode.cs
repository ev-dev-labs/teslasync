using System.Net.Http;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Windows.Globalization;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.SpeechRecognition;
using Windows.Media.SpeechSynthesis;
using Windows.Storage;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 on-device voice card — a parity port of the web <c>AIVoiceMode</c>
/// (web/src/components/ai/AIVoiceMode.tsx) composed with its shared <c>AIFeatureCard</c> scaffold and the
/// <c>withAiFeature</c> gate. Inside a tokenized glass card it renders a header (title + "Helix" badge +
/// description + empty hint), a live transcript region that shows the dictated question or the listening / idle
/// hint, a control row (mic start/stop, mute/unmute spoken replies, and a stop-all control while a reply is in
/// flight), the dictation error / dictation-unavailable affordances, the universal "Ask Helix" action button
/// (disabled until the transcript is non-blank, and showing "Helix is thinking…" with a ring while the SSE stream
/// is open), and the streamed-output panel that renders a reduced-motion-aware thinking skeleton before the first
/// token, the accumulating reply as it arrives, and a connectivity-aware error surface on failure. Speech
/// recognition and synthesis run on-device — only the transcribed text is sent to the assistant, never the raw
/// audio. The whole surface renders nothing when the feature flag is off (the native analogue of
/// <c>withAiFeature</c> returning <see langword="null"/>). All data flows through the shared
/// <see cref="AIVoiceModeViewModel"/>; the view never performs HTTP. Every string resolves through the i18n facade
/// and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class AIVoiceMode : ContentControl, IDisposable
{
    private const double CardPadding = 20;       // web p-5
    private const double SectionSpacing = 16;    // web space-y-4
    private const double TitleRowSpacing = 8;    // web gap-2
    private const double TextColumnSpacing = 4;  // web space-y-1
    private const double ControlSpacing = 8;     // web gap-2
    private const double TranscriptSpacing = 12; // web space-y-3
    private const double OutputPadding = 16;     // web p-4
    private const double TranscriptPadding = 12; // web p-3
    private const double TranscriptMinHeight = 56; // web min-h-[3.5rem]
    private const double BodyFontSize = 14;      // web text-sm
    private const double HintFontSize = 12;      // web text-xs
    private const string MicGlyph = "\uE720";        // Segoe Fluent "Microphone" — start dictation.
    private const string StopMicGlyph = "\uE71A";    // Segoe Fluent "Stop" — stop dictation.
    private const string VolumeGlyph = "\uE767";     // Segoe Fluent "Volume" — spoken replies on.
    private const string MuteGlyph = "\uE74F";       // Segoe Fluent "Mute" — spoken replies off.
    private const string StopAllGlyph = "\uE711";    // Segoe Fluent "Cancel" — stop Helix.
    private const string HelixButtonGlyph = "\uE99A"; // Segoe Fluent "Robot" — the Helix action mark.
    private const string ErrorGlyph = "\uEA39";       // Segoe Fluent "ErrorBadge".

    private static readonly double[] ThinkingLineWidths = [320, 280, 220];

    private readonly AIVoiceModeViewModel _viewModel;
    private readonly AIVoiceModeDiagnostics _diagnostics;
    private readonly ISpeechDictation _dictation;
    private readonly ISpeechPlayback _playback;
    private readonly ITranscriptDraftStore _draftStore;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _card = new();
    private readonly StackPanel _root = new() { Spacing = SectionSpacing };
    private readonly StackPanel _textColumn = new() { Spacing = TextColumnSpacing };
    private readonly PanelTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _badge = new() { Status = StatusKind.Info, Dot = true, VerticalAlignment = VerticalAlignment.Center };

    private readonly TextBlock _description = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _emptyHint = new()
    {
        FontSize = HintFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly Border _transcriptHost = new()
    {
        Padding = new Thickness(TranscriptPadding),
        CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
        BorderThickness = new Thickness(1),
        MinHeight = TranscriptMinHeight,
    };

    private readonly TextBlock _transcript = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
        IsTextSelectionEnabled = true,
    };

    private readonly StackPanel _controlRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = ControlSpacing,
    };

    private readonly TsButton _micButton = new()
    {
        Variant = ButtonVariant.Secondary,
        Size = ControlSize.Small,
    };

    private readonly TsButton _ttsButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
    };

    private readonly TsButton _stopButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = StopAllGlyph,
    };

    private readonly TextBlock _sttError = new()
    {
        FontSize = HintFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _unsupportedHint = new()
    {
        FontSize = HintFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly StackPanel _actionRow = new()
    {
        Orientation = Orientation.Horizontal,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly TsButton _action = new()
    {
        Variant = ButtonVariant.Outline,
        Size = ControlSize.Small,
        IconGlyph = HelixButtonGlyph,
    };

    private readonly Border _outputHost = new()
    {
        Padding = new Thickness(OutputPadding),
        CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
        BorderThickness = new Thickness(1),
    };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its streaming transport, feature gate, localizer and device ports.</summary>
    /// <param name="transport">The cache-free SSE reply transport (P1/S8 state-holder seam).</param>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c>); off collapses the whole surface.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="dictation">The on-device speech-to-text port (web <c>SpeechRecognition</c>).</param>
    /// <param name="playback">The on-device text-to-speech port (web <c>speechSynthesis</c>).</param>
    /// <param name="draftStore">The transcript-draft persistence port (web <c>localStorage</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AIVoiceMode(
        IAiVoiceStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        ISpeechDictation dictation,
        ISpeechPlayback playback,
        ITranscriptDraftStore draftStore,
        AIVoiceModeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(dictation);
        ArgumentNullException.ThrowIfNull(playback);
        ArgumentNullException.ThrowIfNull(draftStore);

        _dictation = dictation;
        _playback = playback;
        _draftStore = draftStore;
        _diagnostics = diagnostics ?? new AIVoiceModeDiagnostics();
        _viewModel = new AIVoiceModeViewModel(transport, gate, localizer, dictation, playback, draftStore);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();
        _micButton.Click += OnMicClick;
        _ttsButton.Click += OnTtsClick;
        _stopButton.Click += OnStopClick;
        _action.Click += OnAskClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _card;
        Render();
    }

    /// <summary>The canonical surface slug (<c>AIVoiceMode</c>).</summary>
    public static string Slug => AIVoiceModeRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public AIVoiceModeViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the production <see cref="HttpAiVoiceStreamTransport"/> and the on-device
    /// WinRT speech recognizer / synthesizer and the <c>ApplicationData</c> draft store from the shared host
    /// dependencies (the P2-core seam) — the native analogue of the web component constructing its
    /// <c>useAiStream</c> over <c>fetch</c> plus the browser Web Speech API.
    /// </summary>
    /// <param name="http">The HTTP client (base address + handler from the composition root).</param>
    /// <param name="options">The API options carrying the version base path.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    /// <param name="gate">The AI-feature gate.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    /// <returns>A wired surface.</returns>
    public static AIVoiceMode Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        IAiFeatureGate gate,
        ILocalizer localizer,
        AIVoiceModeDiagnostics? diagnostics = null)
    {
        var transport = new HttpAiVoiceStreamTransport(http, options, tokenProvider);
        var dictation = new WindowsSpeechDictation();
        var playback = new WindowsSpeechPlayback();
        var draftStore = new ApplicationDataTranscriptDraftStore();
        return new AIVoiceMode(transport, gate, localizer, dictation, playback, draftStore, diagnostics);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _micButton.Click -= OnMicClick;
        _ttsButton.Click -= OnTtsClick;
        _stopButton.Click -= OnStopClick;
        _action.Click -= OnAskClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();

        // The view owns the device adapters it (or Create) supplied; the shared headless singletons are not
        // IDisposable so this disposes only the real WinRT-backed adapters.
        (_dictation as IDisposable)?.Dispose();
        (_playback as IDisposable)?.Dispose();
        (_draftStore as IDisposable)?.Dispose();

        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() =>
        new VoiceModeAutomationPeer(this);

    private void BuildChrome()
    {
        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleRowSpacing,
        };
        _badge.Content = new TextBlock { Text = string.Empty };
        titleRow.Children.Add(_title);
        titleRow.Children.Add(_badge);

        _description.Foreground = DisplayTokens.TextSecondary;
        _emptyHint.Foreground = DisplayTokens.TextMuted;
        _textColumn.Children.Add(titleRow);
        _textColumn.Children.Add(_description);
        _textColumn.Children.Add(_emptyHint);

        _transcriptHost.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _transcriptHost.BorderBrush = DisplayTokens.Border;
        _transcriptHost.Child = _transcript;
        LiveRegion.Configure(_transcriptHost);

        _micButton.IconGlyph = MicGlyph;
        _ttsButton.IconGlyph = VolumeGlyph;
        _controlRow.Children.Add(_micButton);
        _controlRow.Children.Add(_ttsButton);
        _controlRow.Children.Add(_stopButton);

        _sttError.Foreground = DisplayTokens.Brush("TsColorDangerBrush");
        _unsupportedHint.Foreground = DisplayTokens.TextMuted;

        _actionRow.Children.Add(_action);

        _outputHost.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _outputHost.BorderBrush = DisplayTokens.Border;
        LiveRegion.Configure(_outputHost);

        _root.Children.Add(_textColumn);
        _root.Children.Add(_transcriptHost);
        _root.Children.Add(_controlRow);
        _root.Children.Add(_sttError);
        _root.Children.Add(_unsupportedHint);
        _root.Children.Add(_actionRow);
        _root.Children.Add(_outputHost);

        _card.Padding = new Thickness(CardPadding);
        _card.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8);
        _card.BorderBrush = DisplayTokens.Border;
        _card.BorderThickness = new Thickness(1);
        _card.Background = DisplayTokens.Surface;
        _card.Child = _root;

        // web layout uses space-y-3 between the transcript and the control row; nudge the controls.
        _controlRow.Margin = new Thickness(0, TranscriptSpacing - ControlSpacing, 0, 0);
    }

    private void OnMicClick(object sender, RoutedEventArgs e)
    {
        if (_viewModel.MicButtonIsStop)
        {
            _viewModel.StopListening();
        }
        else
        {
            _viewModel.StartListening();
        }
    }

    private void OnTtsClick(object sender, RoutedEventArgs e) => _viewModel.ToggleTts();

    private void OnStopClick(object sender, RoutedEventArgs e) => _viewModel.StopAll();

    private void OnAskClick(object sender, RoutedEventArgs e) => _viewModel.Start();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        // withAiFeature gate: when the feature is off the surface contributes nothing visible and carries no
        // automation id (the web HOC renders null, so the off-mode invariant test finds no root element).
        if (!_viewModel.IsGateOpen)
        {
            Visibility = Visibility.Collapsed;
            AutomationProperties.SetAutomationId(this, string.Empty);
            return;
        }

        Visibility = Visibility.Visible;
        AutomationProperties.SetAutomationId(this, AIVoiceModeRegistration.RootAutomationId);

        _title.Value = _viewModel.Title;
        AutomationProperties.SetName(this, _viewModel.Title);
        SetBadgeText(_viewModel.BadgeLabel);
        _description.Text = _viewModel.Description;

        UpdateEmptyHint();
        UpdateTranscript();
        UpdateControls();
        UpdateHints();
        UpdateActionButton();
        UpdateOutput();
    }

    private void UpdateEmptyHint()
    {
        _emptyHint.Text = _viewModel.EmptyHint;
        _emptyHint.Visibility = _viewModel.ShowEmptyHint ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateTranscript()
    {
        _transcript.Text = _viewModel.TranscriptDisplay;
        _transcript.Foreground = _viewModel.TranscriptIsHint
            ? DisplayTokens.TextMuted
            : DisplayTokens.TextSecondary;
        AutomationProperties.SetName(_transcriptHost, _viewModel.TranscriptLabel);
        LiveRegion.Announce(_transcriptHost);
    }

    private void UpdateControls()
    {
        _micButton.IconGlyph = _viewModel.MicButtonIsStop ? StopMicGlyph : MicGlyph;
        _micButton.Text = _viewModel.MicLabel;
        AutomationProperties.SetName(_micButton, _viewModel.MicAutomationName);
        ToolTipService.SetToolTip(_micButton, _viewModel.MicAutomationName);

        // While listening the control is always interactive (it stops dictation); otherwise the computed
        // start-enabled state applies (web start mic disabled = !sttSupported || isBusy).
        _micButton.IsEnabled = _viewModel.MicButtonIsStop || _viewModel.MicStartEnabled;

        _ttsButton.IconGlyph = _viewModel.IsTtsEnabled ? VolumeGlyph : MuteGlyph;
        _ttsButton.Text = _viewModel.TtsToggleLabel;
        AutomationProperties.SetName(_ttsButton, _viewModel.TtsToggleAutomationName);
        ToolTipService.SetToolTip(_ttsButton, _viewModel.TtsToggleAutomationName);

        _stopButton.Text = _viewModel.StopAllLabel;
        AutomationProperties.SetName(_stopButton, _viewModel.StopAllAutomationName);
        ToolTipService.SetToolTip(_stopButton, _viewModel.StopAllAutomationName);
        _stopButton.Visibility = _viewModel.ShowStopButton ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateHints()
    {
        _sttError.Text = _viewModel.SttError;
        _sttError.Visibility = _viewModel.HasSttError ? Visibility.Visible : Visibility.Collapsed;

        _unsupportedHint.Text = _viewModel.UnsupportedHint;
        _unsupportedHint.Visibility = _viewModel.ShowUnsupportedHint ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateActionButton()
    {
        _action.Text = _viewModel.ActionLabel;
        AutomationProperties.SetName(_action, _viewModel.ActionAutomationName);
        ToolTipService.SetToolTip(_action, _viewModel.ButtonLabel);

        // IsLoading swaps the icon for a ring and forces the button disabled while streaming; once the stream
        // closes it restores interactivity, after which the computed enabled state (canStart) is applied.
        _action.IsLoading = _viewModel.IsStreaming;
        if (!_viewModel.IsStreaming)
        {
            _action.IsEnabled = _viewModel.IsActionEnabled;
        }
    }

    private void UpdateOutput()
    {
        bool showOutput = _viewModel.HasOutput;
        _outputHost.Visibility = showOutput ? Visibility.Visible : Visibility.Collapsed;
        if (showOutput)
        {
            _outputHost.Child = BuildOutputContent();
            LiveRegion.Announce(_outputHost);
        }
        else
        {
            _outputHost.Child = null;
        }
    }

    private UIElement BuildOutputContent()
    {
        if (_viewModel.IsError)
        {
            return BuildErrorContent();
        }

        if (_viewModel.IsThinking)
        {
            return BuildThinkingContent();
        }

        return new TextBlock
        {
            Text = _viewModel.AssistantText,
            TextWrapping = TextWrapping.Wrap,
            FontSize = BodyFontSize,
            Foreground = DisplayTokens.TextPrimary,
            IsTextSelectionEnabled = true,
            LineHeight = 22,
        };
    }

    private StackPanel BuildThinkingContent()
    {
        // web AiOutputPanel: a shimmering skeleton stands in for the reply until the first token arrives.
        bool reduceMotion = MotionPreference.ReduceMotion;
        var column = new StackPanel { Spacing = TitleRowSpacing };
        foreach (double width in ThinkingLineWidths)
        {
            column.Children.Add(new TsSkeleton
            {
                BlockWidth = width,
                BlockHeight = 12,
                Radius = 4,
                ReduceMotion = reduceMotion,
                HorizontalAlignment = HorizontalAlignment.Left,
            });
        }

        AutomationProperties.SetName(column, _viewModel.ThinkingLabel);
        return column;
    }

    private StackPanel BuildErrorContent()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleRowSpacing,
        };

        var danger = DisplayTokens.Brush("TsColorDangerBrush");
        row.Children.Add(new FontIcon
        {
            Glyph = ErrorGlyph,
            FontSize = 16,
            Foreground = danger,
            VerticalAlignment = VerticalAlignment.Top,
        });
        row.Children.Add(new TextBlock
        {
            Text = _viewModel.DisplayErrorText,
            TextWrapping = TextWrapping.Wrap,
            FontSize = BodyFontSize,
            Foreground = danger,
        });
        return row;
    }

    private void SetBadgeText(string text)
    {
        if (_badge.Content is TextBlock block)
        {
            block.Text = text;
        }
        else
        {
            _badge.Content = new TextBlock { Text = text };
        }

        AutomationProperties.SetName(_badge, text);
    }

    private sealed class VoiceModeAutomationPeer : FrameworkElementAutomationPeer
    {
        public VoiceModeAutomationPeer(AIVoiceMode owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AIVoiceMode)Owner).ViewModel.Title
                : name;
        }
    }
}

/// <summary>
/// The production <see cref="ISpeechDictation"/>: on-device continuous speech recognition over the WinRT
/// <see cref="SpeechRecognizer"/> — the native analogue of the browser <c>SpeechRecognition</c> the web
/// component drives (web AIVoiceMode L300-L369). Audio is processed locally; only the recognized text is raised
/// through <see cref="TranscriptUpdated"/>. <see cref="IsSupported"/> reflects whether a system speech language
/// is installed (web's <c>getSpeechRecognitionCtor() !== null</c> probe). Recognition events are marshalled to
/// the creating dispatcher so the bound view-model mutates on the UI thread. All start failures (no microphone,
/// privacy consent not granted) surface through <see cref="ErrorRaised"/> rather than throwing (web's
/// <c>rec.start()</c> try/catch).
/// </summary>
internal sealed class WindowsSpeechDictation : ISpeechDictation, IDisposable
{
    private readonly DispatcherQueue? _dispatcher;
    private SpeechRecognizer? _recognizer;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    public WindowsSpeechDictation() => _dispatcher = DispatcherQueue.GetForCurrentThread();

    public event EventHandler<SpeechDictationTextEventArgs>? TranscriptUpdated;

    public event EventHandler<SpeechDictationErrorEventArgs>? ErrorRaised;

    public event EventHandler? Ended;

    /// <inheritdoc />
    public bool IsSupported => SpeechRecognizer.SystemSpeechLanguage is not null;

    /// <inheritdoc />
    public void Start(string languageTag)
    {
        if (_disposed)
        {
            return;
        }

        TearDownRecognizer();
        var cts = new CancellationTokenSource();
        _cts = cts;
        _ = StartAsync(languageTag, cts.Token);
    }

    /// <inheritdoc />
    public void StopDictation() => StopSession(abort: false);

    /// <inheritdoc />
    public void Abort() => StopSession(abort: true);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopSession(abort: true);
    }

    private async Task StartAsync(string languageTag, CancellationToken cancellationToken)
    {
        SpeechRecognizer? recognizer = null;
        try
        {
            recognizer = BuildRecognizer(languageTag);
            recognizer.ContinuousRecognitionSession.ResultGenerated += OnResultGenerated;
            recognizer.ContinuousRecognitionSession.Completed += OnCompleted;
            _recognizer = recognizer;

            var compile = await recognizer.CompileConstraintsAsync();
            cancellationToken.ThrowIfCancellationRequested();
            if (compile.Status != SpeechRecognitionResultStatus.Success)
            {
                RaiseError(compile.Status.ToString());
                return;
            }

            await recognizer.ContinuousRecognitionSession.StartAsync();
        }
        catch (OperationCanceledException)
        {
            // Cancelled during setup (Stop/Abort/Dispose) — nothing to surface.
        }
        catch (Exception ex)
        {
            // web rec.start() catch: any recognizer failure (no mic, consent, busy) becomes an stt error.
            RaiseError(ex.Message);
        }
    }

    private static SpeechRecognizer BuildRecognizer(string languageTag)
    {
        if (!string.IsNullOrEmpty(languageTag) && Language.IsWellFormed(languageTag))
        {
            return new SpeechRecognizer(new Language(languageTag));
        }

        return new SpeechRecognizer();
    }

    private void OnResultGenerated(
        SpeechContinuousRecognitionSession sender,
        SpeechContinuousRecognitionResultGeneratedEventArgs args)
    {
        var text = args.Result?.Text ?? string.Empty;
        if (text.Length == 0)
        {
            return;
        }

        Marshal(() => TranscriptUpdated?.Invoke(this, new SpeechDictationTextEventArgs(text)));
    }

    private void OnCompleted(
        SpeechContinuousRecognitionSession sender,
        SpeechContinuousRecognitionCompletedEventArgs args) =>
        Marshal(() => Ended?.Invoke(this, EventArgs.Empty));

    private void RaiseError(string reason) =>
        Marshal(() => ErrorRaised?.Invoke(this, new SpeechDictationErrorEventArgs(reason)));

    private void StopSession(bool abort)
    {
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();

        var recognizer = Interlocked.Exchange(ref _recognizer, null);
        if (recognizer is null)
        {
            return;
        }

        _ = StopRecognizerAsync(recognizer, abort);
    }

    private static async Task StopRecognizerAsync(SpeechRecognizer recognizer, bool abort)
    {
        try
        {
            var session = recognizer.ContinuousRecognitionSession;
            if (abort)
            {
                await session.CancelAsync();
            }
            else
            {
                await session.StopAsync();
            }
        }
        catch (Exception)
        {
            // Stopping an already-stopped or never-started session is non-fatal.
        }
        finally
        {
            recognizer.Dispose();
        }
    }

    private void TearDownRecognizer()
    {
        var recognizer = Interlocked.Exchange(ref _recognizer, null);
        if (recognizer is not null)
        {
            _ = StopRecognizerAsync(recognizer, abort: true);
        }
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }
}

/// <summary>
/// The production <see cref="ISpeechPlayback"/>: on-device text-to-speech over the WinRT
/// <see cref="SpeechSynthesizer"/> played through a <see cref="MediaPlayer"/> — the native analogue of the
/// browser <c>speechSynthesis</c> (web AIVoiceMode L142-L165). Sentences are spoken in order (serialized through
/// a gate so they queue like the browser's utterance queue rather than cutting each other off); every failure is
/// non-fatal (the reply still renders). <see cref="Cancel"/> stops the current utterance and drops the queue.
/// </summary>
internal sealed class WindowsSpeechPlayback : ISpeechPlayback, IDisposable
{
    private readonly SpeechSynthesizer _synth = new();
    private readonly SemaphoreSlim _gate = new(1, 1);
    private CancellationTokenSource _cts = new();
    private MediaPlayer? _current;
    private bool _disposed;

    /// <inheritdoc />
    public void Speak(string text, string languageTag)
    {
        if (_disposed || string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        _ = SpeakAsync(text, languageTag, _cts.Token);
    }

    /// <inheritdoc />
    public void Cancel()
    {
        if (_disposed)
        {
            return;
        }

        var previous = Interlocked.Exchange(ref _cts, new CancellationTokenSource());
        try
        {
            previous.Cancel();
        }
        catch (Exception)
        {
            // Non-fatal.
        }
        finally
        {
            previous.Dispose();
        }

        StopCurrent();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        try
        {
            _cts.Cancel();
        }
        catch (Exception)
        {
            // Non-fatal.
        }

        StopCurrent();
        _cts.Dispose();
        _gate.Dispose();
        _synth.Dispose();
    }

    private async Task SpeakAsync(string text, string languageTag, CancellationToken cancellationToken)
    {
        try
        {
            await _gate.WaitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        MediaPlayer? player = null;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            SelectVoice(languageTag);

            var stream = await _synth.SynthesizeTextToStreamAsync(text);
            cancellationToken.ThrowIfCancellationRequested();

            player = new MediaPlayer();
            _current = player;

            var completion = new TaskCompletionSource();
            void OnEnded(MediaPlayer s, object e) => completion.TrySetResult();
            void OnFailed(MediaPlayer s, MediaPlayerFailedEventArgs e) => completion.TrySetResult();
            player.MediaEnded += OnEnded;
            player.MediaFailed += OnFailed;
            player.Source = MediaSource.CreateFromStream(stream, stream.ContentType);
            player.Play();

            using (cancellationToken.Register(() => completion.TrySetResult()))
            {
                await completion.Task;
            }

            player.MediaEnded -= OnEnded;
            player.MediaFailed -= OnFailed;
        }
        catch (OperationCanceledException)
        {
            // Cancelled mid-utterance (mute / stop / new request) — non-fatal.
        }
        catch (Exception)
        {
            // Synthesis / playback failure is non-fatal (web speakSentence catch): the reply still renders.
        }
        finally
        {
            if (player is not null)
            {
                Interlocked.CompareExchange(ref _current, null, player);
                player.Dispose();
            }

            _gate.Release();
        }
    }

    private void SelectVoice(string languageTag)
    {
        if (string.IsNullOrEmpty(languageTag))
        {
            return;
        }

        try
        {
            foreach (var voice in SpeechSynthesizer.AllVoices)
            {
                if (voice.Language.StartsWith(languageTag, StringComparison.OrdinalIgnoreCase))
                {
                    _synth.Voice = voice;
                    return;
                }
            }
        }
        catch (Exception)
        {
            // Voice selection is best-effort; the default voice is used otherwise.
        }
    }

    private void StopCurrent()
    {
        var player = Interlocked.Exchange(ref _current, null);
        if (player is null)
        {
            return;
        }

        try
        {
            player.Pause();
        }
        catch (Exception)
        {
            // Non-fatal.
        }
        finally
        {
            player.Dispose();
        }
    }
}

/// <summary>
/// The production <see cref="ITranscriptDraftStore"/>: persists the in-progress transcript to the packaged app's
/// <see cref="ApplicationData"/> local settings — the native analogue of the web <c>localStorage</c> draft
/// (ADR-015 §I12, web AIVoiceMode L77-L102). Storage access is guarded so an unavailable container never throws
/// (web's try/catch around <c>localStorage</c>).
/// </summary>
internal sealed class ApplicationDataTranscriptDraftStore : ITranscriptDraftStore
{
    private const string DraftKey = "ai.voiceMode.transcriptDraft";

    /// <inheritdoc />
    public string GetDraft()
    {
        try
        {
            var settings = ApplicationData.Current.LocalSettings;
            return settings.Values.TryGetValue(DraftKey, out var value) && value is string text
                ? text
                : string.Empty;
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    /// <inheritdoc />
    public void SetDraft(string value)
    {
        try
        {
            var settings = ApplicationData.Current.LocalSettings;
            if (string.IsNullOrEmpty(value))
            {
                settings.Values.Remove(DraftKey);
            }
            else
            {
                settings.Values[DraftKey] = value;
            }
        }
        catch (Exception)
        {
            // Storage may be unavailable; the panel still works without persistence.
        }
    }
}
