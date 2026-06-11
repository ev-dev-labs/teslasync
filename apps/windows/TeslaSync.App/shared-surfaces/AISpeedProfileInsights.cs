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
/// The native WinUI 3 <c>AISpeedProfileInsights</c> shared surface — a parity port of
/// web/src/components/ai/AISpeedProfileInsights.tsx. It is the opt-in, AI-narrated speed-profile insights card
/// layered onto the drive detail page alongside (never replacing) the deterministic per-drive speed-profile
/// chart and stat cards. The surface reproduces the web <c>withAiFeature('speed-profile-insights', …)</c> gate
/// (it collapses to nothing when the feature is off, the native analogue of the HOC returning <c>null</c>) and,
/// when open, composes the web AIFeatureCard scaffold from the shared primitives: a glass panel with a title, the
/// Helix badge, the description, the universal "Ask Helix" action, and a streaming output region that renders
/// every state the web AiOutputPanel does — a shimmering thinking skeleton while the stream is open with no text
/// yet, the accumulated narrative as it streams, and a retryable error surface on failure. The off-mode / offline
/// path collapses into that error surface (an on-demand SSE action has no cached prior result to age), matching
/// the web hook's <c>stream_http_*</c> → error fallback. All data and the SSE lifecycle flow through the shared
/// <see cref="AiSpeedProfileInsightsViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade, every interactive element carries a Narrator name, the thinking skeleton honours the
/// reduced-motion preference, and the surface emits the <c>view.opened</c> diagnostic once when it is shown.
/// </summary>
public sealed partial class AISpeedProfileInsights : ContentControl, IDisposable
{
    private readonly AiSpeedProfileInsightsViewModel _viewModel;
    private readonly AISpeedProfileInsightsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its transport, gate, localizer, the (optional) drive id and diagnostics.</summary>
    /// <param name="transport">The SSE transport seam (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="driveId">The drive id surfaced by the parent page; absent keeps the action disabled.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public AISpeedProfileInsights(
        IAiSpeedProfileTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        string? driveId = null,
        AISpeedProfileInsightsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AiSpeedProfileInsightsViewModel(transport, gate, localizer, driveId);
        _diagnostics = diagnostics ?? new AISpeedProfileInsightsDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetAutomationId(this, AISpeedProfileInsightsRegistration.RootAutomationId);
        AutomationProperties.SetName(this, _viewModel.Display.Title);
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AISpeedProfileInsights</c>).</summary>
    public static string Slug => AISpeedProfileInsightsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AiSpeedProfileInsightsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the repository-backed <see cref="HttpClientAiSpeedProfileTransport"/> from the
    /// shared HTTP layer, so the host composes the surface with just its client, API options and token provider.
    /// </summary>
    /// <param name="http">The HTTP client (base address + handler from the composition root).</param>
    /// <param name="options">The API options carrying the version base path.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    /// <param name="gate">The AI-feature gate.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="driveId">The drive id surfaced by the parent page.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    /// <returns>A wired surface.</returns>
    public static AISpeedProfileInsights Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        IAiFeatureGate gate,
        ILocalizer localizer,
        string? driveId = null,
        AISpeedProfileInsightsDiagnostics? diagnostics = null)
    {
        var transport = new HttpClientAiSpeedProfileTransport(http, options, tokenProvider);
        return new AISpeedProfileInsights(transport, gate, localizer, driveId, diagnostics);
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
            AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
            return;
        }

        Visibility = Visibility.Visible;
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Content);
        _root.Children.Add(BuildPanel());
    }

    private TsGlassPanel BuildPanel()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildHeader());

        var output = BuildOutput();
        if (output is not null)
        {
            column.Children.Add(output);
        }

        return new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = column,
        };
    }

    private Grid BuildHeader()
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new PanelTitle { Value = _viewModel.Display.Title });
        titleRow.Children.Add(BuildBadge());

        var lead = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Top };
        lead.Children.Add(titleRow);
        lead.Children.Add(new Subhead
        {
            Value = _viewModel.Display.Description,
            MaxWidth = 680,
            HorizontalAlignment = HorizontalAlignment.Left,
        });

        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(lead, 0);
        var action = BuildAction();
        Grid.SetColumn(action, 1);

        grid.Children.Add(lead);
        grid.Children.Add(action);
        return grid;
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
            Glyph = AISpeedProfileInsightsRegistration.HelixGlyph,
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

    private TsButton BuildAction()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Outline,
            Size = ControlSize.Small,
            Text = _viewModel.ButtonText,
            IconGlyph = AISpeedProfileInsightsRegistration.HelixGlyph,
            IsLoading = _viewModel.IsStreaming,
            IsEnabled = _viewModel.ButtonEnabled,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        // web AIFeatureCard: the visible label is the universal CTA, but the accessible name still carries the
        // per-feature verb ("Ask Helix · Generate insights") and the verb is the hover tooltip.
        AutomationProperties.SetName(button, _viewModel.Display.ButtonAutomationName);
        ToolTipService.SetToolTip(button, _viewModel.Display.GenerateLabel);
        button.Click += OnGenerateClick;
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
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        LiveRegion.Configure(text);
        LiveRegion.Announce(text);
        return text;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.Display.ErrorMessage,
            ActionText = _viewModel.Display.RetryLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        error.ActionInvoked += OnRetryInvoked;
        return error;
    }

    private void OnGenerateClick(object sender, RoutedEventArgs e) => _viewModel.Start();

    private void OnRetryInvoked(object? sender, EventArgs e) => _viewModel.Start();
}
