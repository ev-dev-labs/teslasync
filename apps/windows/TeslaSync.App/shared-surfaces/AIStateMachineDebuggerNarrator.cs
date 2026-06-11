using System.Net.Http;
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
/// The native WinUI 3 <c>AIStateMachineDebuggerNarrator</c> shared surface — a parity port of
/// web/src/components/ai/AIStateMachineDebuggerNarrator.tsx. It is the opt-in, AI-narrated FSM-trace card layered
/// beneath the FSM Health Panel on the State-Machine Debugger page alongside (never replacing) the deterministic
/// transition table, state diagram and timeline. The surface reproduces the web
/// <c>withAiFeature('state-machine-debugger-narrator', …)</c> gate (it collapses to nothing when the feature is
/// off, the native analogue of the HOC returning <c>null</c>) and, when open, composes the web AIFeatureCard
/// scaffold from the shared primitives: a glass panel with a title, the Helix badge, the description, an
/// empty-state hint while the parent has not supplied a valid (vehicle, window) triple, the universal "Ask Helix"
/// action, and a streaming output region that renders every state the web AiOutputPanel does — a shimmering
/// thinking skeleton while the stream is open with no text yet, the accumulating narration as it arrives, and a
/// retryable, connectivity-aware error surface on failure (the off-mode / offline path collapses into that error
/// surface, matching the web hook's <c>stream_http_*</c> → error fallback; an on-demand SSE action has no cached
/// prior result to age, so there is no stale state). All data and the SSE lifecycle flow through the shared
/// <see cref="AIStateMachineDebuggerNarratorViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade, every interactive element carries a Narrator name, the thinking skeleton honours the
/// reduced-motion preference, and the surface emits the <c>view.opened</c> diagnostic once when it is shown.
/// </summary>
public sealed partial class AIStateMachineDebuggerNarrator : ContentControl, IDisposable
{
    private const double CardPadding = 20;        // web p-5
    private const double SectionSpacing = 16;     // web space-y-4
    private const double HeaderColumnSpacing = 16; // web gap-4
    private const double TitleRowSpacing = 8;     // web gap-2
    private const double TextColumnSpacing = 6;   // web space-y-1
    private static readonly double[] SkeletonWidths = [320, 280, 220];

    private readonly AIStateMachineDebuggerNarratorViewModel _viewModel;
    private readonly AIStateMachineDebuggerNarratorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _root = new() { Spacing = SectionSpacing };

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its transport, gate, localizer, the in-scope window and diagnostics.</summary>
    /// <param name="transport">The SSE transport seam (web <c>fetch</c>); the view never opens it directly.</param>
    /// <param name="gate">The AI-feature gate (web <c>withAiFeature</c> / <c>useAiEnabled</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The in-scope vehicle id surfaced by the parent page; absent keeps the action disabled.</param>
    /// <param name="fromUnix">The inclusive window start in Unix seconds surfaced by the parent page.</param>
    /// <param name="toUnix">The inclusive window end in Unix seconds surfaced by the parent page.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public AIStateMachineDebuggerNarrator(
        IFsmNarrateStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? vehicleId = null,
        long? fromUnix = null,
        long? toUnix = null,
        AIStateMachineDebuggerNarratorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AIStateMachineDebuggerNarratorViewModel(
            transport, gate, localizer, vehicleId, fromUnix, toUnix);
        _diagnostics = diagnostics ?? new AIStateMachineDebuggerNarratorDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AIStateMachineDebuggerNarrator</c>).</summary>
    public static string Slug => AIStateMachineDebuggerNarratorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AIStateMachineDebuggerNarratorViewModel ViewModel => _viewModel;

    /// <summary>The in-scope vehicle id; reassigning re-evaluates the action button's enabled state.</summary>
    public long? VehicleId
    {
        get => _viewModel.VehicleId;
        set => _viewModel.VehicleId = value;
    }

    /// <summary>The inclusive window start in Unix seconds; reassigning re-evaluates the action button.</summary>
    public long? FromUnix
    {
        get => _viewModel.FromUnix;
        set => _viewModel.FromUnix = value;
    }

    /// <summary>The inclusive window end in Unix seconds; reassigning re-evaluates the action button.</summary>
    public long? ToUnix
    {
        get => _viewModel.ToUnix;
        set => _viewModel.ToUnix = value;
    }

    /// <summary>Set the full (vehicle, window) scope in one update (the parent page's selector change).</summary>
    /// <param name="vehicleId">The in-scope vehicle id.</param>
    /// <param name="fromUnix">The inclusive window start in Unix seconds.</param>
    /// <param name="toUnix">The inclusive window end in Unix seconds.</param>
    public void SetScope(long? vehicleId, long? fromUnix, long? toUnix) =>
        _viewModel.SetScope(vehicleId, fromUnix, toUnix);

    /// <summary>
    /// Convenience factory wiring the production <see cref="HttpFsmNarrateStreamTransport"/> from the shared
    /// networking dependencies (the host's P2-core seam) — the native analogue of the web component constructing
    /// its <c>useAiStream</c> over <c>fetch</c>.
    /// </summary>
    /// <param name="http">The HTTP client (base address + handler from the composition root).</param>
    /// <param name="options">The API options carrying the version base path.</param>
    /// <param name="tokenProvider">The bearer-token source.</param>
    /// <param name="gate">The AI-feature gate.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="vehicleId">The in-scope vehicle id surfaced by the parent page.</param>
    /// <param name="fromUnix">The inclusive window start in Unix seconds surfaced by the parent page.</param>
    /// <param name="toUnix">The inclusive window end in Unix seconds surfaced by the parent page.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    /// <returns>A wired surface.</returns>
    public static AIStateMachineDebuggerNarrator Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? vehicleId = null,
        long? fromUnix = null,
        long? toUnix = null,
        AIStateMachineDebuggerNarratorDiagnostics? diagnostics = null)
    {
        var transport = new HttpFsmNarrateStreamTransport(http, options, tokenProvider);
        return new AIStateMachineDebuggerNarrator(
            transport, gate, localizer, vehicleId, fromUnix, toUnix, diagnostics);
    }

    /// <inheritdoc />
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
    protected override AutomationPeer OnCreateAutomationPeer() => new NarratorAutomationPeer(this);

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
        // collapsed, automation-raw container that exposes no root id and contributes no accessible node.
        if (!_viewModel.IsGateOpen)
        {
            Visibility = Visibility.Collapsed;
            AutomationProperties.SetAutomationId(this, string.Empty);
            AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
            return;
        }

        Visibility = Visibility.Visible;
        AutomationProperties.SetAutomationId(this, AIStateMachineDebuggerNarratorRegistration.RootAutomationId);
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Content);
        AutomationProperties.SetName(this, _viewModel.Title);
        _root.Children.Add(BuildPanel());
    }

    private TsGlassPanel BuildPanel()
    {
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
        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleRowSpacing,
        };
        titleRow.Children.Add(new PanelTitle
        {
            Value = _viewModel.Title,
            VerticalAlignment = VerticalAlignment.Center,
        });
        titleRow.Children.Add(BuildBadge());

        var lead = new StackPanel { Spacing = TextColumnSpacing, VerticalAlignment = VerticalAlignment.Top };
        lead.Children.Add(titleRow);
        lead.Children.Add(new Subhead
        {
            Value = _viewModel.Description,
            MaxWidth = 680,
            HorizontalAlignment = HorizontalAlignment.Left,
        });

        // web AIFeatureCard: {!canStart && emptyHint && <p className="text-xs text-[var(--text-muted)]">…</p>}
        if (_viewModel.ShowEmptyHint)
        {
            lead.Children.Add(new Caption
            {
                Value = _viewModel.EmptyHint,
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
            Glyph = AIStateMachineDebuggerNarratorRegistration.HelixGlyph,
            FontSize = 12,
            Foreground = DisplayTokens.Accent,
        };
        AutomationProperties.SetAccessibilityView(mark, AccessibilityView.Raw);
        content.Children.Add(mark);
        content.Children.Add(new Caption { Value = _viewModel.BadgeLabel });

        var badge = new TsBadge
        {
            Status = StatusKind.Info,
            Content = content,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, _viewModel.BadgeLabel);
        return badge;
    }

    private TsButton BuildAction()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Outline,
            Size = ControlSize.Small,
            Text = _viewModel.ActionLabel,
            IconGlyph = AIStateMachineDebuggerNarratorRegistration.HelixGlyph,
            IsLoading = _viewModel.IsStreaming,
            IsEnabled = _viewModel.IsActionEnabled,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Right,
        };

        // web AIFeatureCard: the visible label is the universal CTA, but the accessible name still carries the
        // per-feature verb ("Ask Helix · Narrate transitions") and the verb is the hover tooltip.
        AutomationProperties.SetName(button, _viewModel.ActionAutomationName);
        ToolTipService.SetToolTip(button, _viewModel.ButtonLabel);
        button.Click += OnGenerateClick;
        return button;
    }

    private FrameworkElement? BuildOutput()
    {
        if (_viewModel.IsError)
        {
            return BuildError();
        }

        if (_viewModel.IsThinking)
        {
            return BuildThinking();
        }

        if (_viewModel.NarrationText.Length > 0)
        {
            return BuildText();
        }

        // Idle with no output: the card still shows the title, description, hint and action — never a blank box.
        return null;
    }

    private StackPanel BuildThinking()
    {
        bool reduceMotion = MotionPreference.ReduceMotion;
        var column = new StackPanel { Spacing = 8 };
        foreach (double width in SkeletonWidths)
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
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private Text BuildText()
    {
        var text = new Text
        {
            Value = _viewModel.NarrationText,
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
            Message = _viewModel.DisplayErrorText,
            ActionText = _viewModel.RetryLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        error.ActionInvoked += OnRetryInvoked;
        return error;
    }

    private void OnGenerateClick(object sender, RoutedEventArgs e) => _viewModel.Start();

    private void OnRetryInvoked(object? sender, EventArgs e) => _viewModel.Start();

    private sealed class NarratorAutomationPeer : FrameworkElementAutomationPeer
    {
        public NarratorAutomationPeer(AIStateMachineDebuggerNarrator owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AIStateMachineDebuggerNarrator)Owner).ViewModel.Title
                : name;
        }
    }
}
