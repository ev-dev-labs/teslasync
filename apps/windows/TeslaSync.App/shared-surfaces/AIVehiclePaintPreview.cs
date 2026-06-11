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
/// The native WinUI 3 <c>AIVehiclePaintPreview</c> shared surface — a parity port of
/// web/src/components/ai/AIVehiclePaintPreview.tsx. It is the opt-in, Helix-narrated paint-preview card layered
/// onto the vehicle detail page beneath (never replacing) the deterministic VehicleConfigSection and its manual
/// per-vehicle Color setting. The surface reproduces the web <c>withAiFeature('vehicle-paint-preview', …)</c> gate
/// (it collapses to nothing when the feature is off, the native analogue of the HOC returning <c>null</c>) and,
/// when open, composes the web AIFeatureCard scaffold from the shared primitives: a glass panel whose header
/// carries the title, the Helix badge, the long propose-only/privacy description and — when no vehicle is yet
/// resolved — the no-vehicle empty hint, the universal "Ask Helix" action on the right of the header (disabled
/// until a vehicle is resolved or while a stream is open), and a streaming output region that renders every state
/// the web AiOutputPanel does: a reduced-motion-aware thinking skeleton while the stream is open with no text yet,
/// the accumulating image-prompt draft as it streams, and a retryable error surface on failure (the connectivity
/// fault collapses into that surface with the offline message, since an on-demand SSE draft has no cached prior
/// result to age). The render contract is PROPOSE-ONLY: Helix drafts an image prompt and never applies a paint.
/// All data and the SSE lifecycle flow through the shared <see cref="AiVehiclePaintPreviewViewModel"/>; the view
/// never performs HTTP. Every string resolves through the i18n facade, every interactive element carries a
/// Narrator name, the thinking skeleton honours the reduced-motion preference, and the surface emits the
/// <c>view.opened</c> diagnostic once when it is shown.
/// </summary>
public sealed partial class AIVehiclePaintPreview : ContentControl, IDisposable
{
    private const double CardPadding = 20;       // web p-5
    private const double SectionSpacing = 16;    // web space-y-4
    private const double LeadSpacing = 6;        // web space-y-1 (header text column)
    private const double TitleRowSpacing = 8;    // web gap-2 (title + badge)
    private const double HeaderColumnSpacing = 16; // web gap-4 (lead column ↔ action)
    private const double DescriptionMaxWidth = 680;

    private readonly AiVehiclePaintPreviewViewModel _viewModel;
    private readonly AIVehiclePaintPreviewDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates the surface over its transport, gate, localizer, the (optional) vehicle id + style hint and
    /// diagnostics.
    /// </summary>
    /// <param name="transport">The SSE transport seam (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The vehicle id surfaced by the parent page; absent keeps the action disabled.</param>
    /// <param name="styleHint">The optional one-word style hint passed to Helix.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public AIVehiclePaintPreview(
        IAiPaintPreviewTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        int? vehicleId = null,
        string? styleHint = null,
        AIVehiclePaintPreviewDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AiVehiclePaintPreviewViewModel(transport, gate, localizer, vehicleId, styleHint);
        _diagnostics = diagnostics ?? new AIVehiclePaintPreviewDiagnostics();
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

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AIVehiclePaintPreview</c>).</summary>
    public static string Slug => AIVehiclePaintPreviewRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AiVehiclePaintPreviewViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the repository-backed <see cref="HttpClientAiPaintPreviewTransport"/> from the
    /// shared HTTP layer, so the host composes the surface with just its client, API options and token provider —
    /// the native analogue of the web component constructing its <c>useAiStream</c> over <c>fetch</c>.
    /// </summary>
    /// <param name="http">The HTTP client (base address + handler from the composition root).</param>
    /// <param name="options">The API options carrying the version base path.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    /// <param name="gate">The AI-feature gate.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="vehicleId">The vehicle id surfaced by the parent page.</param>
    /// <param name="styleHint">The optional one-word style hint.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    /// <returns>A wired surface.</returns>
    public static AIVehiclePaintPreview Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        IAiFeatureGate gate,
        ILocalizer localizer,
        int? vehicleId = null,
        string? styleHint = null,
        AIVehiclePaintPreviewDiagnostics? diagnostics = null)
    {
        var transport = new HttpClientAiPaintPreviewTransport(http, options, tokenProvider);
        return new AIVehiclePaintPreview(transport, gate, localizer, vehicleId, styleHint, diagnostics);
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
    protected override AutomationPeer OnCreateAutomationPeer() => new PaintPreviewAutomationPeer(this);

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
        AutomationProperties.SetAutomationId(this, AIVehiclePaintPreviewRegistration.RootAutomationId);
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Content);
        _root.Children.Add(BuildPanel());
    }

    private TsGlassPanel BuildPanel()
    {
        // web AIFeatureCard (inline placement): header (title + badge + description + optional empty hint) with
        // the action on the right, then the streamed-output panel.
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader());

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

    private Grid BuildHeader()
    {
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = TitleRowSpacing };
        titleRow.Children.Add(new PanelTitle
        {
            Value = _viewModel.Display.Title,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(BuildBadge());

        var lead = new StackPanel { Spacing = LeadSpacing, VerticalAlignment = VerticalAlignment.Top };
        lead.Children.Add(titleRow);
        lead.Children.Add(new Subhead
        {
            Value = _viewModel.Display.Description,
            MaxWidth = DescriptionMaxWidth,
            HorizontalAlignment = HorizontalAlignment.Left,
        });

        // web AIFeatureCard: `{!canStart && emptyHint && <p class="text-xs text-[var(--text-muted)]">…}`.
        if (_viewModel.ShowEmptyHint)
        {
            lead.Children.Add(new HelperText
            {
                Value = _viewModel.Display.NoVehicleHint,
                MaxWidth = DescriptionMaxWidth,
                HorizontalAlignment = HorizontalAlignment.Left,
            });
        }

        var grid = new Grid { ColumnSpacing = HeaderColumnSpacing };
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
            Glyph = AIVehiclePaintPreviewRegistration.HelixGlyph,
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
            IconGlyph = AIVehiclePaintPreviewRegistration.HelixGlyph,
            IsLoading = _viewModel.IsStreaming,
            IsEnabled = _viewModel.ButtonEnabled,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        // web AIFeatureCard: the visible label is the universal CTA, but the accessible name still carries the
        // per-feature verb ("Ask Helix · Preview paint color") and the verb is the hover tooltip.
        AutomationProperties.SetName(button, _viewModel.Display.ButtonAutomationName);
        AutomationProperties.SetAutomationId(button, AIVehiclePaintPreviewRegistration.ButtonAutomationId);
        ToolTipService.SetToolTip(button, _viewModel.Display.ButtonLabel);
        button.Click += OnPreviewClick;
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

    private void OnPreviewClick(object sender, RoutedEventArgs e) => _viewModel.Start();

    private void OnRetryInvoked(object? sender, EventArgs e) => _viewModel.Start();

    private sealed class PaintPreviewAutomationPeer : FrameworkElementAutomationPeer
    {
        public PaintPreviewAutomationPeer(AIVehiclePaintPreview owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AIVehiclePaintPreview)Owner).ViewModel.Display.Title
                : name;
        }
    }
}
