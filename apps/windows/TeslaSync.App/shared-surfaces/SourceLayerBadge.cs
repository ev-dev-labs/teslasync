using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>SourceLayerBadge</c> shared surface — a parity port of
/// web/src/components/data-display/SourceLayerBadge.tsx. It is the power-user diagnostics badge (FSM debugger,
/// signal diff) that shows where a live signal value came from in the layered live-state contract: a tiny
/// monospace chip rendering <c>L1</c> (in-process SignalStore), <c>L2</c> (Redis cross-pod cache), <c>LOG</c>
/// (signal_log replay) or <c>STALE</c> (Redis value past the 2-minute freshness window), tinted from the
/// shared <see cref="SourceLayers"/> token brush, with the layer description — and, when an age is known, the
/// relative value age (web <c>formatAge</c>) — surfaced in the hover/Narrator tooltip. A null or unrecognized
/// source renders the muted em-dash unknown badge: the always-visible default for "source layer unknown",
/// never a hidden surface (web <c>source ?? 'unknown'</c>). The <c>showLabel</c> variant widens the chip
/// (web <c>min-w</c>). All state flows through <see cref="SourceLayerBadgeViewModel"/>; the view performs no I/O
/// and reads no query itself, binding instead to the P1/S8 <see cref="ISourceLayerBadgeSource"/>. The surface is
/// a read-only status indicator whose composed tooltip is its accessible name, and it emits the
/// <c>view.opened</c> diagnostic once when it is shown.
/// </summary>
public sealed partial class SourceLayerBadge : ContentControl, IDisposable
{
    private const double PadH = 6;   // web px-1.5
    private const double PadV = 1;   // web py-px

    private readonly SourceLayerBadgeViewModel _viewModel;
    private readonly SourceLayerBadgeDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _chip = new()
    {
        BorderThickness = new Thickness(1),
        Padding = new Thickness(PadH, PadV, PadH, PadV),
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
        Background = DisplayTokens.Surface,
    };

    private readonly TextBlock _label = new()
    {
        FontSize = SourceLayerBadgeRegistration.FontSize,
        FontFamily = new FontFamily("Consolas"),
        CharacterSpacing = SourceLayerBadgeRegistration.CharacterSpacing,
        HorizontalAlignment = HorizontalAlignment.Center,
        HorizontalTextAlignment = TextAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        IsTextSelectionEnabled = false,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the badge with no value (the designer / parameterless host entry point): it renders the unknown
    /// state (muted em dash). Strings resolve through the resource facade; supply an explicit
    /// <see cref="ILocalizer"/> and a bound <see cref="ISourceLayerBadgeSource"/> via the other constructors to
    /// drive i18n and data from the composition root.
    /// </summary>
    public SourceLayerBadge()
        : this(
            PassthroughLocalizer.Instance,
            new StaticSourceLayerBadgeSource(SourceLayerBadgeSnapshot.Empty),
            showLabel: false,
            diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the badge over the i18n facade and a bound source-layer seam (the production entry point).
    /// </summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The source-layer state-holder seam (web <c>source</c> / <c>ageMs</c> props).</param>
    /// <param name="showLabel">Whether the label is spelled out (web <c>showLabel</c>); defaults to false.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SourceLayerBadge(
        ILocalizer localizer,
        ISourceLayerBadgeSource source,
        bool showLabel = false,
        SourceLayerBadgeDiagnostics? diagnostics = null)
        : this(new SourceLayerBadgeViewModel(localizer, source, showLabel), diagnostics)
    {
    }

    /// <summary>Creates the badge over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SourceLayerBadge(SourceLayerBadgeViewModel viewModel, SourceLayerBadgeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new SourceLayerBadgeDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;
        IsTabStop = false;

        _chip.CornerRadius = DisplayTokens.Radius("TsRadiusSm", SourceLayerBadgeRegistration.CornerRadiusFallback);
        _chip.Child = _label;

        AutomationProperties.SetAutomationId(this, SourceLayerBadgeRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _chip;
        Render();
    }

    /// <summary>The canonical surface slug (<c>SourceLayerBadge</c>).</summary>
    public static string Slug => SourceLayerBadgeRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SourceLayerBadgeViewModel ViewModel => _viewModel;

    /// <summary>The resolved source layer the badge is showing (web <c>STYLE[key] ?? unknown</c>).</summary>
    public SourceLayer Layer => _viewModel.Layer;

    /// <summary>The lowercase source token (web <c>data-source</c>) for query-by-attribute.</summary>
    public string SourceToken => _viewModel.SourceToken;

    /// <summary>The composed accessible name the automation peer reports.</summary>
    internal string AccessibleName => _viewModel.AutomationName;

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
    protected override AutomationPeer OnCreateAutomationPeer() => new SourceLayerBadgeAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mount: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;
        var accent = DisplayTokens.Brush(projection.AccentBrushKey);

        _label.Text = projection.Label;
        _label.Foreground = accent;

        _chip.BorderBrush = accent;
        _chip.MinWidth = projection.MinWidth;

        ToolTipService.SetToolTip(this, projection.Tooltip);
        AutomationProperties.SetName(this, projection.AutomationName);
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

    private sealed class SourceLayerBadgeAutomationPeer : FrameworkElementAutomationPeer
    {
        public SourceLayerBadgeAutomationPeer(SourceLayerBadge owner)
            : base(owner)
        {
        }

        private SourceLayerBadge Surface => (SourceLayerBadge)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
