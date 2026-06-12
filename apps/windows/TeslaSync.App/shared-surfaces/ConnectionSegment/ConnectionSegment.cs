using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>ConnectionSegment</c> shared surface — a parity port of
/// web/src/components/layout/status-bar/ConnectionSegment.tsx. It is the footer status-bar segment that polls the
/// backend <c>/healthz</c> endpoint (through the bound <see cref="IConnectionSegmentSource"/>) and surfaces the
/// API-connection health, reproducing the four <c>useApiHealth</c> states paired with both an icon and a colored
/// dot so the state is legible to users with color-vision differences:
/// <list type="bullet">
///   <item>ok → success Health glyph + "API · {n}ms",</item>
///   <item>degraded → warning Warning glyph + "API · {n}ms",</item>
///   <item>offline → danger ErrorBadge glyph + "API · Offline",</item>
///   <item>unknown → muted Help glyph + "API" (the loading / pre-first-probe state).</item>
/// </list>
/// The whole segment is a keyboard-focusable hyperlink (web <c>&lt;Link to="/system-status"&gt;</c>) that routes
/// through the navigation seam on activation, with the full state described in its Narrator name (web
/// <c>aria-label</c>) and tooltip. A <see cref="ConnectionSegment(ILocalizer, IConnectionSegmentSource, bool,
/// IConnectionSegmentNavigator, ConnectionSegmentDiagnostics)"/> overload renders the compact icon-only variant
/// (web <c>iconOnly</c> prop). Every accent is the generated design token for the state (so light / dark /
/// high-contrast all flow from the token set). All state flows through <see cref="ConnectionSegmentViewModel"/>;
/// the view performs no I/O and issues no probe itself. The surface emits the <c>view.opened</c> diagnostic once
/// when it is shown.
/// </summary>
public sealed partial class ConnectionSegment : ContentControl, IDisposable
{
    private const double DotSize = 6;            // web dot h-1.5 w-1.5
    private const double IconFontSize = 12;      // web icon h-3 w-3
    private const double LabelFontSize = 11;     // web text-[11px]
    private const double RowSpacing = 6;         // web gap-1.5
    private const double LinkPaddingX = 6;       // web px-1.5
    private const double LinkPaddingY = 2;       // web py-0.5

    private readonly ConnectionSegmentViewModel _viewModel;
    private readonly ConnectionSegmentDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Ellipse _dot = new()
    {
        Width = DotSize,
        Height = DotSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _icon = new()
    {
        FontSize = IconFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _short = new()
    {
        FontSize = LabelFontSize,
        FontWeight = FontWeights.Medium,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _suffix = new()
    {
        FontSize = LabelFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _row = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = RowSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly HyperlinkButton _link;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the segment with no live source (the designer / parameterless host entry point): it renders the
    /// "unknown" (Connecting…) state. Strings resolve through the passthrough localizer; supply an explicit
    /// <see cref="ILocalizer"/>, a bound <see cref="IConnectionSegmentSource"/> and an
    /// <see cref="IConnectionSegmentNavigator"/> via the other constructor to drive i18n, data and routing from
    /// the composition root.
    /// </summary>
    public ConnectionSegment()
        : this(
            new ConnectionSegmentViewModel(PassthroughLocalizer.Instance, new StaticConnectionSegmentSource()),
            diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the segment over the i18n facade, a bound API-connection seam and a navigation seam (the production
    /// entry point).
    /// </summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The API-connection state-holder seam (web <c>useApiHealth</c>).</param>
    /// <param name="iconOnly">Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</param>
    /// <param name="navigator">The navigation seam link activation routes through (web <c>&lt;Link&gt;</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ConnectionSegment(
        ILocalizer localizer,
        IConnectionSegmentSource source,
        bool iconOnly = false,
        IConnectionSegmentNavigator? navigator = null,
        ConnectionSegmentDiagnostics? diagnostics = null)
        : this(new ConnectionSegmentViewModel(localizer, source, iconOnly, navigator), diagnostics)
    {
    }

    /// <summary>Creates the segment over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ConnectionSegment(ConnectionSegmentViewModel viewModel, ConnectionSegmentDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ConnectionSegmentDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        _row.Children.Add(_dot);
        _row.Children.Add(_icon);
        _row.Children.Add(_short);
        _row.Children.Add(_suffix);

        // web: a focusable <Link> with a tight chip footprint and a subtle hover (the HyperlinkButton default).
        _link = new HyperlinkButton
        {
            Content = _row,
            Padding = new Thickness(LinkPaddingX, LinkPaddingY, LinkPaddingX, LinkPaddingY),
            MinWidth = 0,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _link.Click += OnLinkClick;

        // web aria-label lives on the link; the dot / icon / text subtree is decorative so the composed
        // accessible name is authoritative (mirrors the web aria-label overriding the inner spans).
        AutomationProperties.SetAccessibilityView(_dot, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_short, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_suffix, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, ConnectionSegmentRegistration.RootAutomationId);

        Content = _link;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>ConnectionSegment</c>).</summary>
    public static string Slug => ConnectionSegmentRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ConnectionSegmentViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the link reports (web <c>aria-label</c>).</summary>
    internal string AccessibleName => _viewModel.AutomationName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _link.Click -= OnLinkClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLinkClick(object sender, RoutedEventArgs e) => _viewModel.Navigate();

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

        // web: the colored dot is always present; the icon is paired with it for color-blind legibility.
        _dot.Fill = accent;

        _icon.Glyph = projection.IconGlyph;
        _icon.Foreground = accent;

        // web !iconOnly: the short "API" label, then the latency OR offline suffix (mutually exclusive).
        _short.Text = projection.ShortLabel;
        _short.Foreground = accent;
        _short.Visibility = projection.ShowShortLabel ? Visibility.Visible : Visibility.Collapsed;

        if (projection.ShowLatencySuffix)
        {
            _suffix.Text = projection.LatencySuffixText;
            _suffix.Foreground = DisplayTokens.TextMuted;
            _suffix.Visibility = Visibility.Visible;
        }
        else if (projection.ShowOfflineSuffix)
        {
            _suffix.Text = projection.OfflineSuffixText;
            _suffix.Foreground = DisplayTokens.TextMuted;
            _suffix.Visibility = Visibility.Visible;
        }
        else
        {
            _suffix.Text = string.Empty;
            _suffix.Visibility = Visibility.Collapsed;
        }

        // web aria-label + <Tooltip content>: the link carries the full, composed state description.
        AutomationProperties.SetName(_link, projection.AutomationName);
        ToolTipService.SetToolTip(_link, projection.TooltipText);
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
