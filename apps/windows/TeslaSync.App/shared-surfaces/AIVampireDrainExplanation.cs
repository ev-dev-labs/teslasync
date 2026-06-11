using System.Net.Http;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 vampire-drain-explanation narration card — a parity port of the web
/// <c>AIVampireDrainExplanation</c> (web/src/components/ai/AIVampireDrainExplanation.tsx) composed with its
/// shared <c>AIFeatureCard</c> scaffold and the <c>withAiFeature</c> gate. Inside a tokenized glass card it
/// renders a header (title + "Helix" badge + description), the universal "Ask Helix" action button (disabled
/// until a vehicle is in scope, and showing "Helix is thinking…" with a ring while the SSE stream is open), and
/// the streamed-output panel that renders the thinking indicator before the first token, the accumulating
/// narration as it arrives, and a connectivity-aware error surface on failure. The whole surface renders
/// nothing when the feature flag is off (the native analogue of <c>withAiFeature</c> returning
/// <see langword="null"/>). All data flows through the shared <see cref="AIVampireDrainExplanationViewModel"/>;
/// the view never performs HTTP. Every string resolves through the i18n facade, the card carries a Narrator
/// name and the action button carries the "Ask Helix · Narrate drain" accessible name.
/// </summary>
public sealed partial class AIVampireDrainExplanation : ContentControl, IDisposable
{
    private const double CardPadding = 20;     // web p-5
    private const double SectionSpacing = 16;  // web space-y-4
    private const double HeaderColumnSpacing = 16; // web gap-4
    private const double TitleRowSpacing = 8;  // web gap-2
    private const double TextColumnSpacing = 4; // web space-y-1
    private const double OutputPadding = 16;   // web p-4
    private const double BodyFontSize = 14;    // web text-sm
    private const string HelixButtonGlyph = "\uE99A"; // Segoe Fluent "Robot" — the Helix action mark.
    private const string ErrorGlyph = "\uEA39";       // Segoe Fluent "ErrorBadge".

    private readonly AIVampireDrainExplanationViewModel _viewModel;
    private readonly AIVampireDrainExplanationDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _card = new();
    private readonly StackPanel _root = new() { Spacing = SectionSpacing };
    private readonly Grid _header = new() { ColumnSpacing = HeaderColumnSpacing };
    private readonly PanelTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _badge = new() { Status = StatusKind.Info, Dot = true, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _description = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TsButton _action = new()
    {
        Variant = ButtonVariant.Outline,
        Size = ControlSize.Small,
        IconGlyph = HelixButtonGlyph,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Right,
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

    /// <summary>Creates the surface over its streaming transport, feature gate, localizer, scoped vehicle and diagnostics.</summary>
    /// <param name="transport">The cache-free SSE narration transport (P1/S8 state-holder seam).</param>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c>); off collapses the whole surface.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The in-scope vehicle id; when unresolved the action stays disabled.</param>
    /// <param name="lookbackDays">The optional lookback-day window to narrate; the backend defaults to 30 when omitted.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AIVampireDrainExplanation(
        IAiVampireDrainStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? vehicleId = null,
        long? lookbackDays = null,
        AIVampireDrainExplanationDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new AIVampireDrainExplanationDiagnostics();
        _viewModel = new AIVampireDrainExplanationViewModel(transport, gate, localizer, vehicleId, lookbackDays);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();
        _action.Click += OnActionClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _card;
        Render();
    }

    /// <summary>The canonical surface slug (<c>AIVampireDrainExplanation</c>).</summary>
    public static string Slug => AIVampireDrainExplanationRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public AIVampireDrainExplanationViewModel ViewModel => _viewModel;

    /// <summary>The in-scope vehicle id; reassigning re-evaluates the action button's enabled state.</summary>
    public long? VehicleId
    {
        get => _viewModel.VehicleId;
        set => _viewModel.VehicleId = value;
    }

    /// <summary>The optional lookback-day window narrated alongside the chart; the backend defaults to 30 when null.</summary>
    public long? LookbackDays
    {
        get => _viewModel.LookbackDays;
        set => _viewModel.LookbackDays = value;
    }

    /// <summary>
    /// Convenience factory that wires the production <see cref="HttpAiVampireDrainStreamTransport"/> from the
    /// shared networking dependencies (the host's P2-core seam) — the native analogue of the web component
    /// constructing its <c>useAiStream</c> over <c>fetch</c>.
    /// </summary>
    public static AIVampireDrainExplanation Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        IAiFeatureGate gate,
        ILocalizer localizer,
        long? vehicleId = null,
        long? lookbackDays = null,
        AIVampireDrainExplanationDiagnostics? diagnostics = null)
    {
        var transport = new HttpAiVampireDrainStreamTransport(http, options, tokenProvider);
        return new AIVampireDrainExplanation(transport, gate, localizer, vehicleId, lookbackDays, diagnostics);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _action.Click -= OnActionClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() =>
        new NarrationAutomationPeer(this);

    private void BuildChrome()
    {
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleRowSpacing,
        };
        _badge.Content = new TextBlock { Text = string.Empty };
        titleRow.Children.Add(_title);
        titleRow.Children.Add(_badge);

        var textColumn = new StackPanel { Spacing = TextColumnSpacing };
        _description.Foreground = DisplayTokens.TextSecondary;
        textColumn.Children.Add(titleRow);
        textColumn.Children.Add(_description);
        Grid.SetColumn(textColumn, 0);

        Grid.SetColumn(_action, 1);
        _header.Children.Add(textColumn);
        _header.Children.Add(_action);

        _outputHost.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _outputHost.BorderBrush = DisplayTokens.Border;
        LiveRegion.Configure(_outputHost);

        _root.Children.Add(_header);
        _root.Children.Add(_outputHost);

        _card.Padding = new Thickness(CardPadding);
        _card.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8);
        _card.BorderBrush = DisplayTokens.Border;
        _card.BorderThickness = new Thickness(1);
        _card.Background = DisplayTokens.Surface;
        _card.Child = _root;
    }

    private void OnActionClick(object sender, RoutedEventArgs e) => _viewModel.Start();

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
        AutomationProperties.SetAutomationId(this, AIVampireDrainExplanationRegistration.RootAutomationId);

        _title.Value = _viewModel.Title;
        AutomationProperties.SetName(this, _viewModel.Title);
        SetBadgeText(_viewModel.BadgeLabel);
        _description.Text = _viewModel.Description;

        UpdateActionButton();

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
            Text = _viewModel.NarrationText,
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

    private sealed class NarrationAutomationPeer : FrameworkElementAutomationPeer
    {
        public NarrationAutomationPeer(AIVampireDrainExplanation owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AIVampireDrainExplanation)Owner).ViewModel.Title
                : name;
        }
    }
}
