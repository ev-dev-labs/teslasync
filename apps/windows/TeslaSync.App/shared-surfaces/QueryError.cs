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
/// The native WinUI 3 <c>QueryError</c> shared surface — a parity port of the web <c>QueryError</c> export
/// (web/src/components/feedback/QueryError.tsx) and its <c>_ErrorState</c> chrome
/// (web/src/components/feedback/_ErrorState.tsx). It is the inline error banner for failed API queries: a
/// rose-tinted card carrying a Segoe Fluent glyph in a tinted chip, a title and message, and an optional
/// call-to-action — branching first into the calm transient-waiting card (rate-limited / breaker-open: a Clock
/// glyph, polite status, no CTA), then on the resolved API status into a 404 ("not found" + "Back to list"), a
/// 401/403 ("Sign in required" + "Sign in"), a 5xx ("Server error" + "Retry") or the network branch ("You're
/// offline" / "Can't reach server" + retry, with the offline retry disabled and an automatic retry once the
/// connection returns). It binds the <see cref="QueryErrorViewModel"/> (over the P1/S8 connectivity + navigation
/// seams and the P1/S10 i18n facade), is shown only while an error is present (the web <c>if (!error) return
/// null</c> gate), declares the branch's ARIA role + live urgency so Narrator announces the failure (assertive
/// for alerts, polite for the waiting and offline status), reads no connectivity and navigates nothing itself,
/// and emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class QueryError : ContentControl, IDisposable
{
    private const double CardRadius = 12;        // web rounded-xl
    private const double CardPad = 16;           // web p-4
    private const double CardMarginBottom = 24;  // web mb-6
    private const double ChipRadius = 8;         // web rounded-lg
    private const double ChipPad = 8;            // web p-2
    private const double ChipTopNudge = 2;       // web mt-0.5
    private const double IconSize = 16;          // web h-4 w-4
    private const double RowGap = 12;            // web gap-3
    private const double TitleSize = 14;         // web text-sm
    private const double MessageSize = 12;       // web text-xs
    private const double TextTopNudge = 2;       // web mt-0.5 between title and message

    private readonly QueryErrorViewModel _viewModel;
    private readonly QueryErrorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _card = new()
    {
        CornerRadius = new CornerRadius(CardRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(CardPad),
        Margin = new Thickness(0, 0, 0, CardMarginBottom),
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
        Padding = new Thickness(ChipPad),
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
    /// <see cref="IQueryErrorConnectivitySource"/> and a bound <see cref="IQueryErrorNavigator"/> via the other
    /// constructors to drive i18n, connectivity and navigation from the composition root.
    /// </summary>
    public QueryError()
        : this(
            PassthroughLocalizer.Instance,
            new StaticQueryErrorConnectivitySource(isOnline: true),
            new RecordingQueryErrorNavigator(),
            diagnostics: null) =>
        _viewModel.SetError(transientWaiting: false, status: 500, onRetry: static () => { });

    /// <summary>Creates the surface over the i18n facade and bound seams (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    /// <param name="connectivity">The connectivity state-holder seam (web <c>useOnlineStatus()</c>).</param>
    /// <param name="navigator">The navigation seam the CTAs invoke (web <c>useNavigate()</c> + login redirect).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public QueryError(
        ILocalizer localizer,
        IQueryErrorConnectivitySource connectivity,
        IQueryErrorNavigator navigator,
        QueryErrorDiagnostics? diagnostics = null)
        : this(new QueryErrorViewModel(localizer, connectivity, navigator), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public QueryError(QueryErrorViewModel viewModel, QueryErrorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new QueryErrorDiagnostics();
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
        AutomationProperties.SetAutomationId(this, QueryErrorRegistration.CardAutomationId);
        AutomationProperties.SetAutomationId(_action, QueryErrorRegistration.ActionAutomationId);

        _action.Click += OnActionClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _card;
        Render();
    }

    /// <summary>The canonical surface slug (<c>QueryError</c>).</summary>
    public static string Slug => QueryErrorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public QueryErrorViewModel ViewModel => _viewModel;

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
    protected override AutomationPeer OnCreateAutomationPeer() => new QueryErrorAutomationPeer(this);

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

        var foreground = DisplayTokens.Brush(QueryErrorRegistration.DangerBrushKey);
        _icon.Glyph = projection.IconGlyph;
        _icon.Foreground = foreground;
        _title.Foreground = foreground;
        _message.Foreground = MutedDangerBrush();
        _card.Background = TintBrush(QueryErrorRegistration.CardBackgroundOpacity);
        _card.BorderBrush = TintBrush(QueryErrorRegistration.CardBorderOpacity);
        _iconChip.Background = TintBrush(QueryErrorRegistration.IconChipOpacity);

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

        // web declares role + aria-live per branch (assertive alert vs polite waiting / offline status).
        LiveRegion.Configure(this, assertive: projection.LiveSetting == QueryErrorRegistration.LiveAssertive);

        if (IsLoaded)
        {
            LiveRegion.Announce(this);
        }
    }

    private static Brush MutedDangerBrush()
    {
        var brush = DisplayTokens.Brush(QueryErrorRegistration.DangerBrushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = QueryErrorRegistration.MessageForegroundOpacity }
            : brush;
    }

    private static SolidColorBrush TintBrush(double opacity) =>
        new(ResolveDangerColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveDangerColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(QueryErrorRegistration.DangerColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the danger brush's colour so the card still tints when the colour token is absent.
        return DisplayTokens.Brush(QueryErrorRegistration.DangerBrushKey) is SolidColorBrush brush
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

    private sealed class QueryErrorAutomationPeer : FrameworkElementAutomationPeer
    {
        public QueryErrorAutomationPeer(QueryError owner)
            : base(owner)
        {
        }

        private QueryError Surface => (QueryError)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
