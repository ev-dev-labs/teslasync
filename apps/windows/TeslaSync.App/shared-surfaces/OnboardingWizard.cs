using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Storage;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>OnboardingWizard</c> shared surface — a parity port of the web <c>OnboardingWizard</c>
/// export (web/src/components/feedback/OnboardingWizard.tsx). It is the first-run intro modal: a backdrop-dimmed,
/// centered <see cref="TsGlassPanel"/> card (web <c>max-w-md rounded-2xl</c>) carrying a dismiss ("X") button, a
/// step-indicator strip (the web cyan dots that widen on the active step), a per-step accent icon chip (a Segoe
/// Fluent glyph standing in for the web Lucide <c>Zap</c> / <c>Car</c> / <c>Settings</c> / <c>CheckCircle</c>), the
/// localized step title + description, a "Skip" link, and a primary "Next" / "Get Started" call-to-action. It binds
/// the <see cref="OnboardingWizardViewModel"/> (over the P1/S8 <see cref="IOnboardingStore"/>) and is presented only
/// when onboarding has NOT completed, after the post-mount reveal delay (the web <c>visible</c> gate: not
/// <c>localStorage.getItem(ONBOARDED_KEY)</c>, 1500&#160;ms after mount). Dismissing it — via the X, "Skip", Esc,
/// the backdrop, or "Get Started" on the final step — persists the onboarded flag and broadcasts it, so a sibling
/// instance collapses its own wizard too (the web <c>broadcast / subscribe('onboarded')</c>). It performs no
/// storage or timer wiring of its own beyond the reveal delay — completion is a bound seam — hosts a real
/// top-level <see cref="Popup"/> so it overlays all content and traps Esc, is announced to Narrator as a dialog
/// named by the step title and described by the step description, and emits the <c>view.opened</c> diagnostic once
/// when first presented.
///
/// <para>
/// State coverage: the web source fetches no data — it derives visibility purely from the onboarded flag and a
/// mount timer — so the loading / error / stale / offline data-source lifecycle states collapse to the hidden
/// state, which is reproduced and tested. The states the web actually has are reproduced in full: hidden (already
/// onboarded, or before the reveal delay elapses) and presented (the wizard, across all four steps). The reveal
/// snaps to its final state under the OS reduce-motion preference (no fade / scale).
/// </para>
/// </summary>
public sealed partial class OnboardingWizard : ContentControl, IDisposable
{
    private const double MaxCardWidth = 448;        // web max-w-md (28rem).
    private const double CardPadding = 24;          // web p-6.
    private const double CardCornerRadius = 16;     // web rounded-2xl.
    private const double OuterPad = 16;             // web p-4 gutter.
    private const double StepStripBottomMargin = 24; // web mb-6.
    private const double DotHeight = 6;             // web h-1.5.
    private const double DotActiveWidth = 24;       // web w-6 (active).
    private const double DotInactiveWidth = 8;      // web w-2 (inactive).
    private const double DotSpacing = 8;            // web gap-2.
    private const double ChipSize = 64;             // web h-16 w-16.
    private const double ChipCornerRadius = 16;     // web rounded-2xl.
    private const double ChipGlyphSize = 32;        // web icon h-8 w-8.
    private const double ChipBottomMargin = 20;     // web mb-5.
    private const double TitleFontSize = 20;        // web text-xl.
    private const double TitleBottomMargin = 8;     // web mb-2.
    private const double DescriptionFontSize = 14;  // web text-sm.
    private const double DescriptionBottomMargin = 32; // web mb-8.
    private const double CloseGlyphSize = 16;       // web X h-4 w-4.
    private const double ActionsSpacing = 12;
    private const double ChipAccentAlpha = 0x15;    // web `${color}15` chip background alpha.
    private const byte InactiveDotAlpha = 0x1A;     // web rgba(255,255,255,0.1).
    private const double ScaleFrom = 0.96;          // entrance scale (reduce-motion snaps to 1).
    private const int TransitionMs = 200;

    private readonly OnboardingWizardViewModel _viewModel;
    private readonly OnboardingWizardDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly Popup _popup = new() { IsLightDismissEnabled = false };
    private readonly Grid _root = new() { IsTabStop = false };
    private readonly Border _scrim = new();

    private readonly TsGlassPanel _card = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        MaxWidth = MaxCardWidth,
        Padding = new Thickness(CardPadding),
        CornerRadius = new CornerRadius(CardCornerRadius),
    };

    private readonly Grid _cardLayout = new();
    private readonly StackPanel _column = new() { HorizontalAlignment = HorizontalAlignment.Stretch };

    private readonly TsButton _close = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = OnboardingWizardRegistration.CloseGlyph,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly StackPanel _stepStrip = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = DotSpacing,
        HorizontalAlignment = HorizontalAlignment.Center,
        Margin = new Thickness(0, 0, 0, StepStripBottomMargin),
    };

    private readonly Border _chip = new()
    {
        Width = ChipSize,
        Height = ChipSize,
        CornerRadius = new CornerRadius(ChipCornerRadius),
        HorizontalAlignment = HorizontalAlignment.Center,
        Margin = new Thickness(0, 0, 0, ChipBottomMargin),
    };

    private readonly FontIcon _chipGlyph = new()
    {
        FontSize = ChipGlyphSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Bold,
        TextAlignment = TextAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
        HorizontalAlignment = HorizontalAlignment.Center,
        Margin = new Thickness(0, 0, 0, TitleBottomMargin),
    };

    private readonly TextBlock _description = new()
    {
        FontSize = DescriptionFontSize,
        TextAlignment = TextAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
        HorizontalAlignment = HorizontalAlignment.Center,
        Margin = new Thickness(0, 0, 0, DescriptionBottomMargin),
    };

    private readonly Grid _actions = new();

    private readonly TsButton _skip = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _primary = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Medium,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ScaleTransform _scale = new() { ScaleX = 1, ScaleY = 1 };

    private DispatcherQueueTimer? _revealTimer;
    private Storyboard? _storyboard;
    private XamlRoot? _xamlRoot;
    private object? _restoreFocusTo;
    private bool _revealScheduled;
    private bool _opened;
    private bool _presented;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe wizard with no composition root (the designer / parameterless host entry point): it
    /// binds an in-memory onboarded store (not yet onboarded) over the passthrough localizer and reveals
    /// immediately, so the surface renders its presented state. Supply explicit seams via the other constructors to
    /// drive i18n and the onboarded flag from the composition root.
    /// </summary>
    public OnboardingWizard()
        : this(PassthroughLocalizer.Instance, new InMemoryOnboardingStore(), diagnostics: null)
    {
    }

    /// <summary>Creates the wizard over the i18n facade and the bound P1/S8 onboarded seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="store">The onboarded-flag seam (web localStorage flag + broadcast).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public OnboardingWizard(ILocalizer localizer, IOnboardingStore store, OnboardingWizardDiagnostics? diagnostics = null)
        : this(new OnboardingWizardViewModel(localizer, store), diagnostics)
    {
    }

    /// <summary>Creates the wizard over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public OnboardingWizard(OnboardingWizardViewModel viewModel, OnboardingWizardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new OnboardingWizardDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        IsTabStop = false;
        BuildVisualTree();

        AutomationProperties.SetAutomationId(_card, OnboardingWizardRegistration.SurfaceAutomationId);
        AutomationProperties.SetAutomationId(_stepStrip, OnboardingWizardRegistration.StepIndicatorAutomationId);
        AutomationProperties.SetAutomationId(_skip, OnboardingWizardRegistration.SkipAutomationId);
        AutomationProperties.SetAutomationId(_primary, OnboardingWizardRegistration.PrimaryAutomationId);
        AutomationProperties.SetAutomationId(_close, OnboardingWizardRegistration.CloseAutomationId);
        AutomationProperties.SetIsDialog(_card, true);
        LiveRegion.Configure(_card);

        Content = _popup;

        _close.Click += OnCloseClick;
        _skip.Click += OnSkipClick;
        _primary.Click += OnPrimaryClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised once the wizard has fully closed (any dismiss path), for hosting / focus aftermath.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>OnboardingWizard</c>).</summary>
    public static string Slug => OnboardingWizardRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public OnboardingWizardViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the current-step title).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopStoryboard();
        StopRevealTimer();
        DetachXamlRoot();
        _close.Click -= OnCloseClick;
        _skip.Click -= OnSkipClick;
        _primary.Click -= OnPrimaryClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _popup.IsOpen = false;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new OnboardingWizardAutomationPeer(this);

    private void BuildVisualTree()
    {
        _scrim.Background = DisplayTokens.Brush("TsMaterialOverlayBrush");
        _scrim.PointerPressed += OnScrimPointerPressed;

        _chip.Child = _chipGlyph;

        _title.Foreground = DisplayTokens.TextPrimary;
        _description.Foreground = DisplayTokens.TextMuted;

        _actions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _actions.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_skip, 0);
        Grid.SetColumn(_primary, 1);
        _actions.Children.Add(_skip);
        _actions.Children.Add(_primary);

        _column.Children.Add(_stepStrip);
        _column.Children.Add(_chip);
        _column.Children.Add(_title);
        _column.Children.Add(_description);
        _column.Children.Add(_actions);

        // The accent chip is a decorative brand mark; the dialog's Narrator name (the title) is authoritative.
        AutomationProperties.SetAccessibilityView(_chip, AccessibilityView.Raw);

        _cardLayout.Children.Add(_column);
        _cardLayout.Children.Add(_close);

        _card.Content = _cardLayout;
        _card.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
        _card.RenderTransform = _scale;

        Grid.SetRow(_scrim, 0);
        Grid.SetRow(_card, 0);
        _root.Padding = new Thickness(OuterPad);
        _root.Children.Add(_scrim);
        _root.Children.Add(_card);
        _root.KeyDown += OnRootKeyDown;

        _popup.Child = _root;
        _popup.Closed += OnPopupClosed;
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => _viewModel.Dismiss();

    private void OnSkipClick(object sender, RoutedEventArgs e) => _viewModel.Skip();

    private void OnPrimaryClick(object sender, RoutedEventArgs e) => _viewModel.Advance();

    private void OnScrimPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        // web: clicking the backdrop calls handleClose.
        e.Handled = true;
        _viewModel.Dismiss();
    }

    private void OnRootKeyDown(object sender, KeyRoutedEventArgs e)
    {
        // web: onKeyDown Escape → handleClose.
        if (e.Key == Windows.System.VirtualKey.Escape)
        {
            e.Handled = true;
            _viewModel.Dismiss();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _xamlRoot = XamlRoot;
        if (_xamlRoot is not null)
        {
            _xamlRoot.Changed += OnXamlRootChanged;
        }

        ScheduleReveal();
        Sync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() =>
        {
            Render();
            Sync();
        });

    private void OnXamlRootChanged(XamlRoot sender, XamlRootChangedEventArgs args)
    {
        if (_popup.IsOpen)
        {
            ApplyViewportSize();
        }
    }

    private void ScheduleReveal()
    {
        if (_disposed || _revealScheduled || _viewModel.IsRevealed)
        {
            return;
        }

        _revealScheduled = true;

        // web: the wizard only reveals when not already onboarded — and after a 1500ms delay so the app paints
        // first. An onboarded user never sees it.
        if (_viewModel.IsOnboarded)
        {
            return;
        }

        if (_dispatcher is { } dispatcher)
        {
            _revealTimer = dispatcher.CreateTimer();
            _revealTimer.Interval = OnboardingWizardRegistration.RevealDelay;
            _revealTimer.IsRepeating = false;
            _revealTimer.Tick += OnRevealTick;
            _revealTimer.Start();
        }
        else
        {
            // No dispatcher (headless host) — reveal synchronously so the presented state still renders.
            _viewModel.Reveal();
        }
    }

    private void OnRevealTick(DispatcherQueueTimer sender, object args)
    {
        StopRevealTimer();
        _viewModel.Reveal();
    }

    private void Render()
    {
        var projection = _viewModel.Projection;

        _title.Text = projection.Title;
        _description.Text = projection.Description;

        _primary.Text = projection.PrimaryActionLabel;
        _skip.Text = projection.SkipLabel;

        AutomationProperties.SetName(_primary, projection.PrimaryActionLabel);
        AutomationProperties.SetName(_skip, projection.SkipLabel);
        AutomationProperties.SetName(_close, projection.CloseLabel);
        ToolTipService.SetToolTip(_close, projection.CloseLabel);
        AutomationProperties.SetName(_stepStrip, projection.StepProgressLabel);

        // web role/labelling: the dialog is named by the step title and described by the step description.
        AutomationProperties.SetName(_card, projection.AccessibleName);
        AutomationProperties.SetFullDescription(_card, projection.AccessibleDescription);

        RenderChip(projection);
        RenderSteps(projection);
    }

    private void RenderChip(OnboardingWizardProjection projection)
    {
        var accent = ColorFromHex(projection.AccentHex);
        _chipGlyph.Glyph = projection.Glyph;
        _chipGlyph.Foreground = new SolidColorBrush(accent);

        var fill = accent;
        fill.A = (byte)ChipAccentAlpha;
        _chip.Background = new SolidColorBrush(fill);
    }

    private void RenderSteps(OnboardingWizardProjection projection)
    {
        var filled = StepIndicatorBrush();
        var inactive = InactiveDotBrush();

        var dots = projection.Dots;
        SyncStepChildren(dots.Count);

        for (var i = 0; i < dots.Count; i++)
        {
            var dot = dots[i];
            var pill = (Border)_stepStrip.Children[i];
            pill.Width = dot.IsActive ? DotActiveWidth : DotInactiveWidth;
            pill.Background = dot.IsFilled ? filled : inactive;
        }
    }

    private void SyncStepChildren(int count)
    {
        while (_stepStrip.Children.Count < count)
        {
            _stepStrip.Children.Add(new Border
            {
                Height = DotHeight,
                CornerRadius = new CornerRadius(DotHeight / 2),
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        while (_stepStrip.Children.Count > count)
        {
            _stepStrip.Children.RemoveAt(_stepStrip.Children.Count - 1);
        }
    }

    private void Sync()
    {
        if (_disposed)
        {
            return;
        }

        var present = _viewModel.IsPresenting;

        if (present && !_popup.IsOpen)
        {
            OpenPopup();
        }
        else if (!present && _popup.IsOpen)
        {
            ClosePopup();
        }
    }

    private void OpenPopup()
    {
        _xamlRoot ??= XamlRoot;
        if (_xamlRoot is null)
        {
            return;
        }

        _restoreFocusTo = FocusManager.GetFocusedElement(_xamlRoot);
        _popup.XamlRoot = _xamlRoot;
        ApplyViewportSize();

        _popup.IsOpen = true;
        _presented = true;

        if (!_opened)
        {
            _opened = true;

            // web mount: emit the view.opened diagnostic exactly once, when first presented.
            _diagnostics.RecordViewOpened();
        }

        AnimateIn();
        MoveInitialFocus();
        LiveRegion.Announce(_card);
    }

    private void ClosePopup()
    {
        if (!_popup.IsOpen)
        {
            FinishClose();
            return;
        }

        AnimateOut(() => _popup.IsOpen = false);
    }

    private void OnPopupClosed(object? sender, object e) => FinishClose();

    private void FinishClose()
    {
        if (!_presented)
        {
            return;
        }

        _presented = false;

        if (_restoreFocusTo is Control control)
        {
            control.Focus(FocusState.Programmatic);
        }

        _restoreFocusTo = null;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private void ApplyViewportSize()
    {
        if (_xamlRoot is not { } xamlRoot)
        {
            return;
        }

        var size = xamlRoot.Size;
        if (size.Width > 0)
        {
            _root.Width = size.Width;
        }

        if (size.Height > 0)
        {
            _root.Height = size.Height;
        }
    }

    private void MoveInitialFocus()
    {
        if (FocusManager.FindFirstFocusableElement(_card) is Control first)
        {
            first.Focus(FocusState.Programmatic);
        }
        else
        {
            _primary.Focus(FocusState.Programmatic);
        }
    }

    private void AnimateIn()
    {
        if (_reduceMotion)
        {
            StopStoryboard();
            _scrim.Opacity = 1;
            _card.Opacity = 1;
            _scale.ScaleX = 1;
            _scale.ScaleY = 1;
            return;
        }

        AnimateTo(opacityTo: 1, scaleTo: 1, onComplete: null);
    }

    private void AnimateOut(Action onComplete)
    {
        if (_reduceMotion)
        {
            StopStoryboard();
            onComplete();
            return;
        }

        AnimateTo(opacityTo: 0, scaleTo: ScaleFrom, onComplete: onComplete);
    }

    private void AnimateTo(double opacityTo, double scaleTo, Action? onComplete)
    {
        StopStoryboard();

        var duration = new Duration(TimeSpan.FromMilliseconds(TransitionMs));
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var storyboard = new Storyboard();

        var fromOpacity = opacityTo >= 1 ? 0 : _card.Opacity;
        var fromScale = opacityTo >= 1 ? ScaleFrom : _scale.ScaleX;

        AddDoubleAnimation(storyboard, _scrim, "Opacity", _scrim.Opacity, opacityTo, duration, ease, dependent: false);
        AddDoubleAnimation(storyboard, _card, "Opacity", fromOpacity, opacityTo, duration, ease, dependent: false);
        AddDoubleAnimation(storyboard, _scale, "ScaleX", fromScale, scaleTo, duration, ease, dependent: true);
        AddDoubleAnimation(storyboard, _scale, "ScaleY", fromScale, scaleTo, duration, ease, dependent: true);

        if (onComplete is not null)
        {
            storyboard.Completed += (_, _) => onComplete();
        }

        _storyboard = storyboard;
        storyboard.Begin();
    }

    private static void AddDoubleAnimation(
        Storyboard storyboard,
        DependencyObject target,
        string property,
        double from,
        double to,
        Duration duration,
        EasingFunctionBase ease,
        bool dependent)
    {
        var animation = new DoubleAnimation
        {
            From = from,
            To = to,
            Duration = duration,
            EasingFunction = ease,
            EnableDependentAnimation = dependent,
        };
        Storyboard.SetTarget(animation, target);
        Storyboard.SetTargetProperty(animation, property);
        storyboard.Children.Add(animation);
    }

    private void StopStoryboard()
    {
        _storyboard?.Stop();
        _storyboard = null;
    }

    private void StopRevealTimer()
    {
        if (_revealTimer is { } timer)
        {
            timer.Stop();
            timer.Tick -= OnRevealTick;
            _revealTimer = null;
        }
    }

    private void DetachXamlRoot()
    {
        if (_xamlRoot is { } xamlRoot)
        {
            xamlRoot.Changed -= OnXamlRootChanged;
        }
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

    private static SolidColorBrush StepIndicatorBrush() =>
        new(ResolveColor(
            OnboardingWizardRegistration.StepIndicatorColorKey,
            OnboardingWizardRegistration.StepIndicatorColorFallback));

    private static SolidColorBrush InactiveDotBrush() =>
        new(Windows.UI.Color.FromArgb(InactiveDotAlpha, 0xFF, 0xFF, 0xFF));

    private static Windows.UI.Color ResolveColor(string colorKey, string fallbackHex)
    {
        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue(colorKey, out var value)
            && value is Windows.UI.Color color)
        {
            return color;
        }

        return ColorFromHex(fallbackHex);
    }

    private static Windows.UI.Color ColorFromHex(string hex)
    {
        var span = hex.AsSpan().TrimStart('#');
        if (span.Length == 6
            && byte.TryParse(span[..2], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var r)
            && byte.TryParse(span[2..4], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var g)
            && byte.TryParse(span[4..6], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var b))
        {
            return Windows.UI.Color.FromArgb(255, r, g, b);
        }

        return Microsoft.UI.Colors.SteelBlue;
    }

    private sealed class OnboardingWizardAutomationPeer : FrameworkElementAutomationPeer
    {
        public OnboardingWizardAutomationPeer(OnboardingWizard owner)
            : base(owner)
        {
        }

        private OnboardingWizard Surface => (OnboardingWizard)Owner;

        // The wizard is a modal intro dialog; the current-step title is the authoritative Narrator name.
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Pane;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}

/// <summary>
/// The production <see cref="IOnboardingStore"/> — persists the onboarded flag in the packaged app's
/// <see cref="ApplicationData.LocalSettings"/> under the key the web stores in localStorage
/// (<see cref="OnboardingWizardRegistration.OnboardedStorageKey"/>), the native analogue of the web
/// <c>handleClose</c> write / mount-time truthiness read (web/src/components/feedback/OnboardingWizard.tsx L51,
/// L68). Every access is defensive: in unpackaged or first-run contexts the store may be unavailable, in which
/// case a read degrades to "not onboarded" (so the wizard reappears) and a write is silently skipped — never
/// throws — exactly as the web reads/writes localStorage without guarding. WinUI-free callers never construct
/// this; it lives in the view layer because it depends on <c>Windows.Storage</c>.
/// </summary>
public sealed class ApplicationDataOnboardingStore : IOnboardingStore
{
    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsOnboarded => OnboardingWizardRegistration.IsOnboarded(Read());

    /// <inheritdoc />
    public void Complete()
    {
        var values = Values;
        if (values is not null)
        {
            try
            {
                values[OnboardingWizardRegistration.OnboardedStorageKey] =
                    OnboardingWizardRegistration.OnboardedStorageValue;
            }
            catch (Exception)
            {
                // Quota / serialization failure — ignore (web swallows the localStorage write error).
            }
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Re-raise <see cref="Changed"/> for a sibling instance's onboarding broadcast — the native analogue of the
    /// web cross-tab <c>subscribe('onboarded')</c> handler; the store re-reads the shared local-settings value so
    /// the wizard collapses without a relaunch.
    /// </summary>
    public void NotifyExternalCompletion() => Changed?.Invoke(this, EventArgs.Empty);

    private static string? Read()
    {
        var values = Values;
        if (values is not null
            && values.TryGetValue(OnboardingWizardRegistration.OnboardedStorageKey, out var stored)
            && stored is string text)
        {
            return text;
        }

        return null;
    }

    private static Windows.Foundation.Collections.IPropertySet? Values
    {
        get
        {
            try
            {
                return ApplicationData.Current.LocalSettings.Values;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
