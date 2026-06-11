using System.Net.Http;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 natural-language Grafana-panel drafter card — a parity port of the web
/// <c>AINLGrafanaPanel</c> (web/src/components/ai/AINLGrafanaPanel.tsx) composed with its shared
/// <c>AIFeatureCard</c> scaffold and the <c>withAiFeature</c> gate. Inside a tokenized glass card it renders a
/// header (title + "Helix" badge + description), a multi-line prompt field, the universal "Ask Helix" action
/// button (disabled until the prompt is non-blank, and showing "Helix is thinking…" with a ring while the SSE
/// stream is open), a right-aligned propose-only "Apply to editor" button shown once a typed panel draft is
/// captured, and the streamed-output panel that renders the thinking indicator before the first token, the
/// accumulating rationale as it arrives, and a connectivity-aware error surface on failure. The whole surface
/// renders nothing when the feature flag is off (the native analogue of <c>withAiFeature</c> returning
/// <see langword="null"/>). All data flows through the shared <see cref="AINLGrafanaPanelViewModel"/>; the view
/// never performs HTTP and never pushes the panel to Grafana — "Apply to editor" hands the typed draft to the
/// parent via a callback (ADR-015 propose-only). Every string resolves through the i18n facade and every
/// interactive element carries a Narrator name.
/// </summary>
public sealed partial class AINLGrafanaPanel : ContentControl, IDisposable
{
    private const double CardPadding = 20;       // web p-5
    private const double SectionSpacing = 16;    // web space-y-4
    private const double TitleRowSpacing = 8;    // web gap-2
    private const double TextColumnSpacing = 4;  // web space-y-1
    private const double OutputPadding = 16;     // web p-4
    private const double PromptMinHeight = 64;   // web rows={2}
    private const double BodyFontSize = 14;      // web text-sm
    private const string HelixButtonGlyph = "\uE99A"; // Segoe Fluent "Robot" — the Helix action mark.
    private const string ErrorGlyph = "\uEA39";       // Segoe Fluent "ErrorBadge".

    private readonly AINLGrafanaPanelViewModel _viewModel;
    private readonly AINLGrafanaPanelDiagnostics _diagnostics;
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

    private readonly TsTextarea _prompt = new()
    {
        MinHeight = PromptMinHeight,
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

    private readonly StackPanel _applyRow = new()
    {
        Orientation = Orientation.Horizontal,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly TsButton _apply = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
    };

    private readonly Border _outputHost = new()
    {
        Padding = new Thickness(OutputPadding),
        CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
        BorderThickness = new Thickness(1),
    };

    private bool _started;
    private bool _renderQueued;
    private bool _syncingPrompt;
    private bool _disposed;

    /// <summary>Creates the surface over its streaming transport, feature gate, localizer, apply callback and diagnostics.</summary>
    /// <param name="transport">The cache-free SSE draft transport (P1/S8 state-holder seam).</param>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c>); off collapses the whole surface.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="onApply">The propose-only handoff invoked when the user applies a captured panel draft.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AINLGrafanaPanel(
        IAiGrafanaDraftStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        Action<GrafanaPanelDraft>? onApply = null,
        AINLGrafanaPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new AINLGrafanaPanelDiagnostics();
        _viewModel = new AINLGrafanaPanelViewModel(transport, gate, localizer, onApply);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();
        _action.Click += OnDraftClick;
        _apply.Click += OnApplyClick;
        _prompt.TextChanged += OnPromptChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _card;
        Render();
    }

    /// <summary>The canonical surface slug (<c>AINLGrafanaPanel</c>).</summary>
    public static string Slug => AINLGrafanaPanelRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public AINLGrafanaPanelViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the production <see cref="HttpAiGrafanaDraftStreamTransport"/> from the
    /// shared networking dependencies (the host's P2-core seam) — the native analogue of the web component
    /// constructing its <c>useAiStream</c> over <c>fetch</c>.
    /// </summary>
    public static AINLGrafanaPanel Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        IAiFeatureGate gate,
        ILocalizer localizer,
        Action<GrafanaPanelDraft>? onApply = null,
        AINLGrafanaPanelDiagnostics? diagnostics = null)
    {
        var transport = new HttpAiGrafanaDraftStreamTransport(http, options, tokenProvider);
        return new AINLGrafanaPanel(transport, gate, localizer, onApply, diagnostics);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _action.Click -= OnDraftClick;
        _apply.Click -= OnApplyClick;
        _prompt.TextChanged -= OnPromptChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() =>
        new GrafanaDrafterAutomationPeer(this);

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
        _textColumn.Children.Add(titleRow);
        _textColumn.Children.Add(_description);

        _actionRow.Children.Add(_action);
        _applyRow.Children.Add(_apply);

        _outputHost.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _outputHost.BorderBrush = DisplayTokens.Border;
        LiveRegion.Configure(_outputHost);

        _root.Children.Add(_textColumn);
        _root.Children.Add(_prompt);
        _root.Children.Add(_actionRow);
        _root.Children.Add(_applyRow);
        _root.Children.Add(_outputHost);

        _card.Padding = new Thickness(CardPadding);
        _card.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8);
        _card.BorderBrush = DisplayTokens.Border;
        _card.BorderThickness = new Thickness(1);
        _card.Background = DisplayTokens.Surface;
        _card.Child = _root;
    }

    private void OnDraftClick(object sender, RoutedEventArgs e) => _viewModel.Start();

    private void OnApplyClick(object sender, RoutedEventArgs e) => _viewModel.Apply();

    private void OnPromptChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncingPrompt)
        {
            return;
        }

        _viewModel.Prompt = _prompt.Text;
    }

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
        AutomationProperties.SetAutomationId(this, AINLGrafanaPanelRegistration.RootAutomationId);

        _title.Value = _viewModel.Title;
        AutomationProperties.SetName(this, _viewModel.Title);
        SetBadgeText(_viewModel.BadgeLabel);
        _description.Text = _viewModel.Description;

        UpdatePrompt();
        UpdateActionButton();
        UpdateApplyButton();
        UpdateOutput();
    }

    private void UpdatePrompt()
    {
        _prompt.Hint = _viewModel.PromptPlaceholder;
        AutomationProperties.SetName(_prompt, _viewModel.PromptLabel);

        if (!string.Equals(_prompt.Text, _viewModel.Prompt, StringComparison.Ordinal))
        {
            _syncingPrompt = true;
            _prompt.Text = _viewModel.Prompt;
            _syncingPrompt = false;
        }
    }

    private void UpdateActionButton()
    {
        _action.Text = _viewModel.ActionLabel;
        AutomationProperties.SetName(_action, _viewModel.ActionAutomationName);
        ToolTipService.SetToolTip(_action, _viewModel.DraftButtonLabel);

        // IsLoading swaps the icon for a ring and forces the button disabled while streaming; once the stream
        // closes it restores interactivity, after which the computed enabled state (canStart) is applied.
        _action.IsLoading = _viewModel.IsStreaming;
        if (!_viewModel.IsStreaming)
        {
            _action.IsEnabled = _viewModel.IsActionEnabled;
        }
    }

    private void UpdateApplyButton()
    {
        // web: the apply button only renders once a typed draft has been captured.
        if (!_viewModel.HasDraft)
        {
            _applyRow.Visibility = Visibility.Collapsed;
            return;
        }

        _applyRow.Visibility = Visibility.Visible;
        _apply.Text = _viewModel.ApplyButtonLabel;
        AutomationProperties.SetName(_apply, _viewModel.ApplyButtonLabel);
        ToolTipService.SetToolTip(_apply, _viewModel.ApplyTooltip);
        _apply.IsEnabled = _viewModel.IsApplyEnabled;
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
            return new TsSpinner
            {
                Size = ControlSize.Small,
                Label = _viewModel.ThinkingLabel,
                HorizontalAlignment = HorizontalAlignment.Left,
            };
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

    private sealed class GrafanaDrafterAutomationPeer : FrameworkElementAutomationPeer
    {
        public GrafanaDrafterAutomationPeer(AINLGrafanaPanel owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AINLGrafanaPanel)Owner).ViewModel.Title
                : name;
        }
    }
}
