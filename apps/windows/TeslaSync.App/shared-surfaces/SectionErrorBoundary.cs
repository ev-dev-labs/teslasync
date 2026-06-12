using System.Windows.Input;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
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
/// The native WinUI 3 <c>SectionErrorBoundary</c> shared surface — a parity port of the web
/// <c>SectionErrorBoundary</c> export (web/src/components/feedback/SectionErrorBoundary.tsx) and the inline fallback
/// chrome of the <c>ErrorBoundary</c> it delegates to (web/src/components/feedback/ErrorBoundary.tsx). It wraps a
/// page section / widget / chart so a render failure inside it is isolated instead of blanking the page: host the
/// real UI in <see cref="ProtectedContent"/>, run risky work through <see cref="RunGuarded"/> (or call
/// <see cref="Capture(System.Exception)"/> from a catch), and a localized danger-tinted fallback is swapped in.
/// It reproduces the web's three fallback configurations — the default inline card with a working retry, a custom
/// <see cref="FallbackTitle"/> alert card with no retry (web <c>fallbackTitle</c>), and a fully caller-supplied
/// <see cref="CustomFallbackContent"/> node (web <c>fallback</c>) — plus the healthy state that shows the protected
/// children. It binds the <see cref="SectionErrorBoundaryViewModel"/> (over the P1/S10 i18n facade), composes from
/// platform tokens (P1/S9) rather than web Tailwind classes, declares the alert ARIA role + assertive live urgency
/// so Narrator announces the failure, reads no connectivity and navigates nothing itself, raises <see cref="Retry"/>
/// for the host to reload after the user retries, and emits the <c>view.opened</c> diagnostic once when shown.
/// </summary>
public sealed partial class SectionErrorBoundary : ContentControl, IDisposable
{
    private const double CardRadius = 12;   // web rounded-xl
    private const double CardPad = 16;      // web p-4
    private const double RowGap = 12;       // web gap-3
    private const double IconSize = 20;     // web h-5 w-5
    private const double TitleSize = 14;    // web text-sm
    private const double DetailSize = 12;   // web text-xs
    private const double DetailTopNudge = 2;

    private readonly SectionErrorBoundaryViewModel _viewModel;
    private readonly SectionErrorBoundaryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly ContentPresenter _contentPresenter = new();
    private readonly ContentPresenter _customFallbackPresenter = new()
    {
        Visibility = Visibility.Collapsed,
    };

    private readonly Border _card = new()
    {
        CornerRadius = new CornerRadius(CardRadius),
        BorderThickness = new Thickness(1),
        Padding = new Thickness(CardPad),
        HorizontalAlignment = HorizontalAlignment.Stretch,
        Visibility = Visibility.Collapsed,
    };

    private readonly Grid _cardRow = new()
    {
        ColumnSpacing = RowGap,
        ColumnDefinitions =
        {
            new ColumnDefinition { Width = GridLength.Auto },
            new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) },
            new ColumnDefinition { Width = GridLength.Auto },
        },
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
        FontWeight = FontWeights.Medium,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _detail = new()
    {
        FontSize = DetailSize,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, DetailTopNudge, 0, 0),
    };

    private readonly TsButton _retry = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
        Margin = new Thickness(RowGap, 0, 0, 0),
        Visibility = Visibility.Collapsed,
    };

    private object? _protectedContent;
    private UIElement? _customFallbackContent;
    private string? _fallbackTitle;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds a
    /// passthrough localizer and presents a captured error so the surface renders its visible fallback state.
    /// Supply an explicit <see cref="ILocalizer"/> via the other constructors to drive i18n from the composition
    /// root.
    /// </summary>
    public SectionErrorBoundary()
        : this(new SectionErrorBoundaryViewModel(PassthroughLocalizer.Instance), diagnostics: null) =>
        _viewModel.Capture();

    /// <summary>Creates the surface over the i18n facade and an initial configuration (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the copy resolves through (P1/S10).</param>
    /// <param name="mode">The initial fallback mode (web prop shape).</param>
    /// <param name="fallbackTitle">The initial title for the title-fallback mode (web <c>fallbackTitle</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SectionErrorBoundary(
        ILocalizer localizer,
        SectionErrorBoundaryMode mode = SectionErrorBoundaryMode.Default,
        string? fallbackTitle = null,
        SectionErrorBoundaryDiagnostics? diagnostics = null)
        : this(new SectionErrorBoundaryViewModel(localizer, mode, fallbackTitle), diagnostics) =>
        _fallbackTitle = fallbackTitle;

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SectionErrorBoundary(SectionErrorBoundaryViewModel viewModel, SectionErrorBoundaryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new SectionErrorBoundaryDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Padding = new Thickness(0);

        _textStack.Children.Add(_title);
        _textStack.Children.Add(_detail);

        Grid.SetColumn(_icon, 0);
        Grid.SetColumn(_textStack, 1);
        Grid.SetColumn(_retry, 2);
        _cardRow.Children.Add(_icon);
        _cardRow.Children.Add(_textStack);
        _cardRow.Children.Add(_retry);
        _card.Child = _cardRow;

        _root.Children.Add(_contentPresenter);
        _root.Children.Add(_card);
        _root.Children.Add(_customFallbackPresenter);

        // The icon + text subtree is read through the control's authoritative Narrator name (title + detail);
        // the retry button keeps its own accessible name.
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_title, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_detail, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, SectionErrorBoundaryRegistration.BoundaryAutomationId);
        AutomationProperties.SetAutomationId(_retry, SectionErrorBoundaryRegistration.RetryAutomationId);

        _retry.Click += OnRetryClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>Raised after the user retries (the boundary has reset) so the host can reload its content.</summary>
    public event EventHandler? Retry;

    /// <summary>The canonical surface slug (<c>SectionErrorBoundary</c>).</summary>
    public static string Slug => SectionErrorBoundaryRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SectionErrorBoundaryViewModel ViewModel => _viewModel;

    /// <summary>Optional MVVM command invoked alongside <see cref="Retry"/> when the user retries.</summary>
    public ICommand? RetryCommand { get; set; }

    /// <summary>The real UI guarded by this boundary (web <c>children</c>).</summary>
    public object? ProtectedContent
    {
        get => _protectedContent;
        set
        {
            _protectedContent = value;
            _contentPresenter.Content = value;
        }
    }

    /// <summary>
    /// The caller-supplied fallback node (web <c>fallback</c>). Assigning a non-null value switches the boundary to
    /// the custom-fallback mode (the web precedence where <c>fallback</c> wins); clearing it falls back to the
    /// title-fallback or default mode.
    /// </summary>
    public UIElement? CustomFallbackContent
    {
        get => _customFallbackContent;
        set
        {
            _customFallbackContent = value;
            _customFallbackPresenter.Content = value;
            ApplyConfiguration();
        }
    }

    /// <summary>
    /// The custom title for the title-fallback mode (web <c>fallbackTitle</c>). A non-empty value switches the
    /// boundary to the title-fallback mode unless a <see cref="CustomFallbackContent"/> node takes precedence.
    /// </summary>
    public string? FallbackTitle
    {
        get => _fallbackTitle;
        set
        {
            _fallbackTitle = value;
            ApplyConfiguration();
        }
    }

    /// <summary>The composed accessible name the automation peer reports (the title and detail together).</summary>
    internal string AccessibleName => _viewModel.Projection.AccessibleName;

    /// <summary>
    /// Record a captured render failure and switch to the fallback (the native analogue of a React error boundary
    /// catching). Only the exception's type name is surfaced as the default-mode detail — never the message, which
    /// can carry PII / secrets — mirroring the native <c>TsErrorBoundary</c> contract.
    /// </summary>
    /// <param name="error">The captured exception.</param>
    public void Capture(System.Exception error)
    {
        ArgumentNullException.ThrowIfNull(error);
        _viewModel.Capture(error.GetType().Name);
    }

    /// <summary>Record a captured failure with no detail (the reassuring subtitle is shown).</summary>
    public void Capture() => _viewModel.Capture();

    /// <summary>Run an action, switching to the fallback if it throws. Returns whether it succeeded.</summary>
    /// <param name="work">The risky work to guard.</param>
    public bool RunGuarded(Action work)
    {
        ArgumentNullException.ThrowIfNull(work);
        try
        {
            work();
            return true;
        }
        catch (System.Exception ex)
        {
            Capture(ex);
            return false;
        }
    }

    /// <summary>Clear the captured error, restore the protected content and raise <see cref="Retry"/>.</summary>
    public void Reset()
    {
        _viewModel.Reset();
        RaiseRetry();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _retry.Click -= OnRetryClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SectionErrorBoundaryAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        if (_viewModel.Projection.ShowsCard)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRetryClick(object sender, RoutedEventArgs e)
    {
        _viewModel.Reset();
        RaiseRetry();
    }

    private void RaiseRetry()
    {
        Retry?.Invoke(this, EventArgs.Empty);
        if (RetryCommand is { } command && command.CanExecute(null))
        {
            command.Execute(null);
        }
    }

    private void ApplyConfiguration() =>
        _viewModel.Configure(ResolveMode(), _fallbackTitle);

    private SectionErrorBoundaryMode ResolveMode()
    {
        // web precedence (SectionErrorBoundary.tsx L36-65): fallback node wins, then fallbackTitle, then default.
        if (_customFallbackContent is not null)
        {
            return SectionErrorBoundaryMode.CustomFallback;
        }

        return string.IsNullOrEmpty(_fallbackTitle)
            ? SectionErrorBoundaryMode.Default
            : SectionErrorBoundaryMode.TitleFallback;
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;

        // web: a healthy boundary returns its children; an errored one swaps in the selected fallback.
        _contentPresenter.Visibility = projection.IsErrored ? Visibility.Collapsed : Visibility.Visible;
        _card.Visibility = projection.ShowsCard ? Visibility.Visible : Visibility.Collapsed;
        _customFallbackPresenter.Visibility = projection.ShowsCustomFallback ? Visibility.Visible : Visibility.Collapsed;

        if (projection.ShowsCard)
        {
            RenderCard(projection);
        }
        else
        {
            // No card is shown (healthy or custom-fallback): the custom node / children own their semantics.
            AutomationProperties.SetName(this, string.Empty);
        }

        if (IsLoaded && projection.ShowsCard)
        {
            LiveRegion.Announce(this);
        }
    }

    private void RenderCard(SectionErrorBoundaryProjection projection)
    {
        var danger = DisplayTokens.Brush(SectionErrorBoundaryRegistration.DangerBrushKey);

        _icon.Glyph = projection.IconGlyph;
        _icon.Foreground = danger;
        _card.Background = TintBrush(SectionErrorBoundaryRegistration.CardBackgroundOpacity);
        _card.BorderBrush = TintBrush(SectionErrorBoundaryRegistration.CardBorderOpacity);

        _title.Text = projection.Title;
        _title.Foreground = DisplayTokens.Brush(SectionErrorBoundaryRegistration.SecondaryTextBrushKey);

        _detail.Text = projection.Detail;
        _detail.Foreground = DisplayTokens.Brush(SectionErrorBoundaryRegistration.MutedTextBrushKey);
        _detail.Visibility = string.IsNullOrEmpty(projection.Detail) ? Visibility.Collapsed : Visibility.Visible;

        if (projection.HasRetry)
        {
            _retry.Text = projection.RetryLabel;
            AutomationProperties.SetName(_retry, projection.RetryLabel);
            _retry.Visibility = Visibility.Visible;
        }
        else
        {
            _retry.Visibility = Visibility.Collapsed;
        }

        AutomationProperties.SetName(this, projection.AccessibleName);
        LiveRegion.Configure(this, assertive: projection.LiveSetting == SectionErrorBoundaryRegistration.LiveAssertive);
    }

    private static SolidColorBrush TintBrush(double opacity) =>
        new(ResolveDangerColor()) { Opacity = opacity };

    private static Windows.UI.Color ResolveDangerColor()
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(SectionErrorBoundaryRegistration.DangerColorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        // Fall back to the danger brush's colour so the card still tints when the colour token is absent.
        return DisplayTokens.Brush(SectionErrorBoundaryRegistration.DangerBrushKey) is SolidColorBrush brush
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

    private sealed class SectionErrorBoundaryAutomationPeer : FrameworkElementAutomationPeer
    {
        public SectionErrorBoundaryAutomationPeer(SectionErrorBoundary owner)
            : base(owner)
        {
        }

        private SectionErrorBoundary Surface => (SectionErrorBoundary)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
