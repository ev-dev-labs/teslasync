using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
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
/// The native WinUI 3 <c>AISafetySettingExplainer</c> shared surface — a parity port of
/// web/src/components/ai/AISafetySettingExplainer.tsx. It is the opt-in, Helix-narrated advisor card that layers
/// onto the Safety settings page above (never replacing) the deterministic listing of safety-related settings.
/// The surface reproduces the web <c>withAiFeature('safety-setting-explainer', …)</c> gate (it collapses to
/// nothing when the feature is off, the native analogue of the HOC returning <c>null</c>) and, when open, composes
/// the web AIFeatureCard scaffold with <c>buttonPlacement="below"</c>: a glass panel whose header carries the
/// title, the Helix badge and the description, the universal "Ask Helix" action on its own right-aligned row
/// beneath the header, and a streaming output region that renders every state the web AiOutputPanel does — a
/// reduced-motion-aware thinking skeleton while the stream is open with no text yet, the accumulating narration as
/// it streams, and a retryable error surface on failure (the connectivity fault collapses into that surface with
/// the offline message, since an on-demand SSE narration has no cached prior result to age). The render contract
/// is NARRATIVE: Helix explains the user's existing safety toggles and never proposes or changes one. All data and
/// the SSE lifecycle flow through the shared <see cref="AiSafetySettingExplainerViewModel"/>; the view never
/// performs HTTP. Every string resolves through the i18n facade, every interactive element carries a Narrator
/// name, the thinking skeleton honours the reduced-motion preference, and the surface emits the <c>view.opened</c>
/// diagnostic once when it is shown.
/// </summary>
public sealed partial class AISafetySettingExplainer : ContentControl, IDisposable
{
    private const double CardPadding = 20;       // web p-5
    private const double SectionSpacing = 16;    // web space-y-4
    private const double LeadSpacing = 6;        // web space-y-1 (header text column)
    private const double TitleRowSpacing = 8;    // web gap-2 (title + badge)
    private const double DescriptionMaxWidth = 680;

    private readonly AiSafetySettingExplainerViewModel _viewModel;
    private readonly AISafetySettingExplainerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its transport, gate, localizer and diagnostics.</summary>
    /// <param name="transport">The SSE transport seam (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public AISafetySettingExplainer(
        IAiSafetyExplainTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        AISafetySettingExplainerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AiSafetySettingExplainerViewModel(transport, gate, localizer);
        _diagnostics = diagnostics ?? new AISafetySettingExplainerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetName(this, _viewModel.Display.Title);
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AISafetySettingExplainer</c>).</summary>
    public static string Slug => AISafetySettingExplainerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AiSafetySettingExplainerViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the repository-backed <see cref="HttpClientAiSafetyExplainTransport"/> from the
    /// shared HTTP layer, so the host composes the surface with just its client, API options and token provider —
    /// the native analogue of the web component constructing its <c>useAiStream</c> over <c>fetch</c>.
    /// </summary>
    /// <param name="http">The HTTP client (base address + handler from the composition root).</param>
    /// <param name="options">The API options carrying the version base path.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    /// <param name="gate">The AI-feature gate.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    /// <returns>A wired surface.</returns>
    public static AISafetySettingExplainer Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        IAiFeatureGate gate,
        ILocalizer localizer,
        AISafetySettingExplainerDiagnostics? diagnostics = null)
    {
        var transport = new HttpClientAiSafetyExplainTransport(http, options, tokenProvider);
        return new AISafetySettingExplainer(transport, gate, localizer, diagnostics);
    }

    /// <summary>Detach from the view-model and cancel any in-flight stream (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ExplainerAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Mirror the web component mounting: the surface only exists when the gate is open, so record the
        // view.opened diagnostic once and only when it is actually shown.
        if (_opened || !_viewModel.IsGateOpen)
        {
            return;
        }

        _opened = true;
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

        // A delta/terminal frame can be raised from the stream's background continuation; rebuild on the UI thread.
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
        _root.Children.Clear();

        // web withAiFeature: when the feature is off the wrapped component returns null. The native analogue is a
        // collapsed, automation-raw container that contributes no visible or accessible node.
        if (!_viewModel.IsGateOpen)
        {
            Visibility = Visibility.Collapsed;
            AutomationProperties.SetAutomationId(this, string.Empty);
            AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
            return;
        }

        Visibility = Visibility.Visible;
        AutomationProperties.SetAutomationId(this, AISafetySettingExplainerRegistration.RootAutomationId);
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Content);
        _root.Children.Add(BuildPanel());
    }

    private TsGlassPanel BuildPanel()
    {
        // web buttonPlacement="below": header (title + badge + description), then the action on its own
        // right-aligned row, then the streamed-output panel.
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader());
        column.Children.Add(BuildButtonRow());

        var output = BuildOutput();
        if (output is not null)
        {
            column.Children.Add(output);
        }

        return new TsGlassPanel
        {
            Padding = new Thickness(CardPadding),
            Content = column,
        };
    }

    private StackPanel BuildHeader()
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = TitleRowSpacing };
        titleRow.Children.Add(new PanelTitle
        {
            Value = _viewModel.Display.Title,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(BuildBadge());

        var lead = new StackPanel { Spacing = LeadSpacing };
        lead.Children.Add(titleRow);
        lead.Children.Add(new Subhead
        {
            Value = _viewModel.Display.Description,
            MaxWidth = DescriptionMaxWidth,
            HorizontalAlignment = HorizontalAlignment.Left,
        });
        return lead;
    }

    private TsBadge BuildBadge()
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var mark = new FontIcon
        {
            Glyph = AISafetySettingExplainerRegistration.HelixGlyph,
            FontSize = 12,
            Foreground = DisplayTokens.Accent,
        };
        AutomationProperties.SetAccessibilityView(mark, AccessibilityView.Raw);
        content.Children.Add(mark);
        content.Children.Add(new Caption { Value = _viewModel.Display.BadgeLabel });

        var badge = new TsBadge
        {
            Status = StatusKind.Info,
            Content = content,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, _viewModel.Display.BadgeLabel);
        return badge;
    }

    private StackPanel BuildButtonRow()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        row.Children.Add(BuildAction());
        return row;
    }

    private TsButton BuildAction()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Outline,
            Size = ControlSize.Small,
            Text = _viewModel.ButtonText,
            IconGlyph = AISafetySettingExplainerRegistration.HelixGlyph,
            IsLoading = _viewModel.IsStreaming,
            IsEnabled = _viewModel.ButtonEnabled,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        // web AIFeatureCard: the visible label is the universal CTA, but the accessible name still carries the
        // per-feature verb ("Ask Helix · Explain my settings") and the verb is the hover tooltip.
        AutomationProperties.SetName(button, _viewModel.Display.ButtonAutomationName);
        AutomationProperties.SetAutomationId(button, AISafetySettingExplainerRegistration.ButtonAutomationId);
        ToolTipService.SetToolTip(button, _viewModel.Display.ButtonLabel);
        button.Click += OnExplainClick;
        return button;
    }

    private FrameworkElement? BuildOutput()
    {
        if (_viewModel.ShowThinking)
        {
            return BuildThinking();
        }

        if (_viewModel.ShowText)
        {
            return BuildText();
        }

        if (_viewModel.ShowError)
        {
            return BuildError();
        }

        // Idle with no output: the card still shows the title, description and action — never a blank box.
        return null;
    }

    private StackPanel BuildThinking()
    {
        bool reduceMotion = MotionPreference.ReduceMotion;
        var column = new StackPanel { Spacing = 8 };
        double[] widths = [320, 280, 220];
        foreach (double width in widths)
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

        AutomationProperties.SetName(column, _viewModel.Display.ThinkingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private Text BuildText()
    {
        var text = new Text
        {
            Value = _viewModel.Text,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        LiveRegion.Configure(text);
        LiveRegion.Announce(text);
        return text;
    }

    private TsQueryError BuildError()
    {
        // web AiOutputPanel error branch + the connectivity-aware offline message are folded into
        // DisplayErrorText; the QueryError adds the retryable affordance the P2 error state mandates.
        var error = new TsQueryError
        {
            Message = _viewModel.DisplayErrorText,
            ActionText = _viewModel.Display.RetryLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        error.ActionInvoked += OnRetryInvoked;
        return error;
    }

    private void OnExplainClick(object sender, RoutedEventArgs e) => _viewModel.Start();

    private void OnRetryInvoked(object? sender, EventArgs e) => _viewModel.Start();

    private sealed class ExplainerAutomationPeer : FrameworkElementAutomationPeer
    {
        public ExplainerAutomationPeer(AISafetySettingExplainer owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AISafetySettingExplainer)Owner).ViewModel.Display.Title
                : name;
        }
    }
}
