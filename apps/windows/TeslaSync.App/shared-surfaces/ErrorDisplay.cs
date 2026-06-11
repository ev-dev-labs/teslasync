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
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>ErrorDisplay</c> shared surface — a parity port of the web <c>ErrorDisplay</c> export
/// (web/src/components/feedback/ErrorDisplay.tsx) and its <c>_ErrorState</c> chrome
/// (web/src/components/feedback/_ErrorState.tsx). It is the status-aware failure banner used for non-query errors
/// (mutation failures, imperative fetches): a rose-tinted card carrying a Segoe Fluent glyph in a tinted chip, a
/// title and message, and an optional call-to-action — branching on the resolved API status into a 404
/// ("not found" + "Back to list"), a 401/403 ("Sign in required" + "Sign in"), a 5xx ("Server error" + "Retry")
/// or the network branch ("You're offline" / "Can't reach server" + retry), with a <c>compact</c> variant for
/// inline contexts. It binds the <see cref="ErrorDisplayViewModel"/> (over the P1/S8 connectivity + navigation
/// seams and the P1/S10 i18n facade), is shown only while an error is present (the web
/// <c>if (!error) return null</c> gate), declares the branch's ARIA role + live urgency so Narrator announces the
/// failure (assertive for alerts, polite for the offline status), reads no connectivity and navigates nothing
/// itself, and emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class ErrorDisplay : ContentControl, IDisposable
{
    private const double CardRadius = 12;            // web rounded-xl
    private const double CardPad = 16;               // web p-4
    private const double CardPadCompact = 12;        // web p-3
    private const double CardMarginBottom = 24;      // web mb-6
    private const double CardMarginBottomCompact = 12; // web mb-3
    private const double ChipRadius = 8;             // web rounded-lg
    private const double ChipPad = 8;                // web p-2
    private const double ChipPadCompact = 6;         // web p-1.5
    private const double ChipTopNudge = 2;           // web mt-0.5
    private const double IconSize = 16;              // web h-4 w-4
    private const double IconSizeCompact = 14;       // web h-3.5 w-3.5
    private const double RowGap = 12;                // web gap-3
    private const double RowGapCompact = 8;          // web gap-2
    private const double TitleSize = 14;             // web text-sm
    private const double TitleSizeCompact = 12;      // web text-xs
    private const double MessageSize = 12;           // web text-xs
    private const double MessageSizeCompact = 11;    // web text-[11px]
    private const double TextTopNudge = 2;           // web mt-0.5 between title and message

    private readonly ErrorDisplayViewModel _viewModel;
    private readonly ErrorDisplayDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _card = new()
    {
        CornerRadius = new CornerRadius(CardRadius),
        BorderThickness = new Thickness(1),
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Grid _row = new()
    {
        ColumnDefinitions =
        {
            new ColumnDefinition { Width = GridLength.Auto },
            new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) },
            new ColumnDefinition { Width = GridLength.Auto },
        },
    };

    private readonly Border _iconChip = new()
    {
        CornerRadius = new CornerRadius(ChipRadius),
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, ChipTopNudge, RowGap, 0),
    };

    private readonly FontIcon _icon = new()
    {
        FontSize = IconSize,
        VerticalAlignment = VerticalAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private readonly StackPanel _textStack = new()
    {
        Orientation = Orientation.Vertical,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _message = new()
    {
        FontSize = MessageSize,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, TextTopNudge, 0, 0),
    };

    private readonly TsButton _action = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(RowGap, 0, 0, 0),
        Visibility = Visibility.Collapsed,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds a
    /// static connectivity source and a recording navigator and presents a representative server error so the
    /// surface renders its visible state. Supply an explicit <see cref="ILocalizer"/>, a bound
    /// <see cref="IErrorDisplayConnectivitySource"/> and a bound <see cref="IErrorDisplayNavigator"/> via the
    /// other constructors to drive i18n, connectivity and navigation from the composition root.
    /// </summary>
    public ErrorDisplay()
        : this(
            PassthroughLocalizer.Instance,
            new StaticErrorDisplayConnectivitySource(isOnline: true),
            new RecordingErrorDisplayNavigator(),
            diagnostics: null) =>
        _viewModel.SetError(status: 500, onRetry: static () => { });

    /// <summary>Creates the surface over the i18n facade and bound seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    /// <param name="connectivity">The connectivity state-holder seam (web <c>useOnlineStatus()</c>).</param>
    /// <param name="navigator">The navigation seam the CTAs invoke (web <c>useNavigate()</c> + login redirect).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ErrorDisplay(
        ILocalizer localizer,
        IErrorDisplayConnectivitySource connectivity,
        IErrorDisplayNavigator navigator,
        ErrorDisplayDiagnostics? diagnostics = null)
        : this(new ErrorDisplayViewModel(localizer, connectivity, navigator), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ErrorDisplay(ErrorDisplayViewModel viewModel, ErrorDisplayDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ErrorDisplayDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Padding = new Thickness(0);

        _iconChip.Child = _icon;
        _textStack.Children.Add(_title);
        _textStack.Children.Add(_message);

        Grid.SetColumn(_iconChip, 0);
        Grid.SetColumn(_textStack, 1);
        Grid.SetColumn(_action, 2);
        _row.Children.Add(_iconChip);
        _row.Children.Add(_textStack);
        _row.Children.Add(_action);
        _card.Child = _row;

        // The icon + text subtree is read through the control's authoritative Narrator name (title + message);
        // the action button keeps its own accessible name.
        AutomationProperties.SetAccessibilityView(_iconChip, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_title, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_message, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, ErrorDisplayRegistration.CardAutomationId);
        AutomationProperties.SetAutomationId(_action, ErrorDisplayRegistration.ActionAutomationId);

        _action.Click += OnActionClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _card;
        Render();
    }

    /// <summary>The canonical surface slug (<c>ErrorDisplay</c>).</summary>
    public static string Slug => ErrorDisplayRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ErrorDisplayViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the title and message together).</summary>
    internal string AccessibleName => _viewModel.Projection.AccessibleName;

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
    protected override AutomationPeer OnCreateAutomationPeer() => new ErrorDisplayAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        if (_viewModel.Projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnActionClick(object sender, RoutedEventArgs e) => _viewModel.InvokeAction();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        // web: if (!error) return null — nothing is rendered until an error is present.
        Visibility = projection.IsVisible ? Visibility.Visible : Visibility.Collapsed;
        if (!projection.IsVisible)
        {
            return;
        }

        ApplyMetrics(projection.Compact);

        var foreground = DisplayTokens.Brush(ErrorDisplayRegistration.DangerBrushKey);
        _icon.Glyph = projection.IconGlyph;
        _icon.Foreground = foreground;
        _title.Foreground = foreground;
        _message.Foreground = MutedDangerBrush();
        _card.Background = TintBrush(ErrorDisplayRegistration.CardBackgroundOpacity);
        _card.BorderBrush = TintBrush(ErrorDisplayRegistration.CardBorderOpacity);
        _iconChip.Background = TintBrush(ErrorDisplayRegistration.IconChipOpacity);

        _title.Text = projection.Title;
        _message.Text = projection.Message;
        _message.Visibility = string.IsNullOrEmpty(projection.Message) ? Visibility.Collapsed : Visibility.Visible;

        if (projection.HasAction)
        {
            _action.Text = projection.ActionLabel;
            _action.IsEnabled = projection.ActionEnabled;
            AutomationProperties.SetName(_action, projection.ActionLabel);
            _action.Visibility = Visibility.Visible;
        }
        else
        {
            _action.Visibility = Visibility.Collapsed;
        }

        AutomationProperties.SetName(this, projection.AccessibleName);

        // web declares role + aria-live per branch (assertive alert vs polite offline status).
        LiveRegion.Configure(this, assertive: projection.LiveSetting == ErrorDisplayRegistration.LiveAssertive);

        if (IsLoaded)
        {
            LiveRegion.Announce(this);
        }
    }

    private void ApplyMetrics(bool compact)
    {
        var pad = compact ? CardPadCompact : CardPad;
        _card.Padding = new Thickness(pad);
        _card.Margin = new Thickness(0, 0, 0, compact ? CardMarginBottomCompact : CardMarginBottom);

        var chipPad = compact ? ChipPadCompact : ChipPad;
        _iconChip.Padding = new Thickness(chipPad);
        var gap = compact ? RowGapCompact : RowGap;
        _iconChip.Margin = new Thickness(0, ChipTopNudge, gap, 0);
        _action.Margin = new Thickness(gap, 0, 0, 0);

        _icon.FontSize = compact ? IconSizeCompact : IconSize;
        _title.FontSize = compact ? TitleSizeCompact : TitleSize;
        _message.FontSize = compact ? MessageSizeCompact : MessageSize;
    }

    private static Brush MutedDangerBrush()
    {
        var brush = DisplayTokens.Brush(ErrorDisplayRegistration.DangerBrushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = ErrorDisplayRegistration.MessageForegroundOpacity }
            : brush;
    }

    private static SolidColorBrush TintBrush(double opacity) =>
        new(ResolveDangerColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveDangerColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(ErrorDisplayRegistration.DangerColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the danger brush's colour so the card still tints when the colour token is absent.
        return DisplayTokens.Brush(ErrorDisplayRegistration.DangerBrushKey) is SolidColorBrush brush
            ? brush.Color
            : Microsoft.UI.Colors.Red;
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

    private sealed class ErrorDisplayAutomationPeer : FrameworkElementAutomationPeer
    {
        public ErrorDisplayAutomationPeer(ErrorDisplay owner)
            : base(owner)
        {
        }

        private ErrorDisplay Surface => (ErrorDisplay)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
