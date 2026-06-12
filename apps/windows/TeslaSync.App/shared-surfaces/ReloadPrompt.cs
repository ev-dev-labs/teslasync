using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>ReloadPrompt</c> shared surface — a parity port of the web <c>ReloadPrompt</c> export
/// (web/src/components/feedback/ReloadPrompt.tsx). It is the app-chrome "a new version is ready" banner anchored to
/// the bottom-right of the viewport: a translucent <see cref="TsGlassPanel"/> card with a neon-cyan border, a cyan
/// chip carrying a spinning Segoe Fluent sync glyph (standing in for the web Lucide <c>RefreshCw</c> <c>animate-spin</c>),
/// the localized title + the live countdown subtitle, a "Later" dismiss button (<see cref="ButtonVariant.Subtle"/> —
/// the web ghost button) and a "Reload Now" call-to-action (<see cref="ButtonVariant.Primary"/>). It binds the
/// <see cref="ReloadPromptViewModel"/> (over the P1/S8 <see cref="ISoftwareUpdateSource"/>) and is shown only while a
/// build is waiting to be applied (the web <c>needRefresh</c> gate). While shown it counts down once per second and,
/// at zero, applies the update and relaunches — exactly the web <c>setInterval</c> auto-reload — and exposes "Later"
/// to opt out. When that state moves it slides up + fades in / out, snapping to the final state under the OS
/// reduce-motion preference (the web slide/fade), and the chip glyph spins continuously unless reduce-motion is set.
/// It performs no registration polling or relaunch of its own — those are the bound seam — is announced to Narrator
/// as a polite live region (the web <c>role="alert" aria-live="polite"</c>) named by the title and described by the
/// countdown, and emits the <c>view.opened</c> diagnostic once when first shown.
///
/// <para>
/// State coverage: the web source fetches no data — it derives visibility purely from the service-worker pending-
/// update signal and an in-component countdown, so (like the shipped <c>InstallPrompt</c> sibling) it has no loading
/// / error / stale / offline data chrome; those data-source lifecycle states collapse to the hidden state, which is
/// reproduced and tested. The states the web actually has are reproduced in full: hidden (no update waiting) and
/// visible (the counting-down banner), plus the auto-reload at zero, the immediate "Reload Now" relaunch, and the
/// "Later" dismissal that hides the banner until the host's next update check.
/// </para>
/// </summary>
public sealed partial class ReloadPrompt : ContentControl, IDisposable
{
    private const double MaxCardWidth = 384;        // web max-w-sm (24rem).
    private const double CardPadding = 16;          // web !p-4.
    private const double CardCornerRadius = 16;     // web rounded-2xl.
    private const double CardBorderThickness = 1;   // web border.
    private const double OuterPad = 16;             // web bottom-4 right-4.
    private const double ColumnSpacing = 12;        // web gap-3.
    private const double ChipSize = 36;             // web p-2 around an h-5 w-5 icon.
    private const double ChipCornerRadius = 8;      // web rounded-lg.
    private const double ChipGlyphSize = 20;        // web RefreshCw h-5 w-5.
    private const double TitleFontSize = 14;        // web text-sm.
    private const double SubtitleFontSize = 12;     // web text-xs.
    private const double SubtitleSpacing = 2;       // web sibling paragraph gap.
    private const double SlideOffset = 16;          // web slide-in-from-bottom-4 (1rem).
    private const int TransitionMs = 280;           // web reveal duration.
    private const int SpinDurationMs = 1000;        // web animate-spin (~1s per turn).

    private readonly ReloadPromptViewModel _viewModel;
    private readonly ReloadPromptDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly Grid _root = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private readonly TranslateTransform _slide = new() { Y = 0 };
    private readonly RotateTransform _spinTransform = new() { Angle = 0 };

    private readonly TsGlassPanel _card = new()
    {
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Bottom,
        MaxWidth = MaxCardWidth,
        Padding = new Thickness(CardPadding),
        CornerRadius = new CornerRadius(CardCornerRadius),
        BorderThickness = new Thickness(CardBorderThickness),
    };

    private readonly Grid _content = new()
    {
        ColumnSpacing = ColumnSpacing,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private readonly Border _chip = new()
    {
        Width = ChipSize,
        Height = ChipSize,
        CornerRadius = new CornerRadius(ChipCornerRadius),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _chipGlyph = new()
    {
        Glyph = ReloadPromptRegistration.RefreshGlyph,
        FontSize = ChipGlyphSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
    };

    private readonly StackPanel _textColumn = new()
    {
        Spacing = SubtitleSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TextBlock _subtitle = new()
    {
        FontSize = SubtitleFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TsButton _later = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _reload = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly DispatcherTimer _countdownTimer = new() { Interval = TimeSpan.FromSeconds(1) };

    private Storyboard? _storyboard;
    private Storyboard? _spinStoryboard;
    private bool _ready;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe prompt with no composition root (the designer / parameterless host entry point): it
    /// binds a static update source that reports a waiting build over the passthrough localizer, so the surface
    /// renders its visible counting-down banner. Supply explicit seams via the other constructors to drive i18n and
    /// the software-update state from the composition root.
    /// </summary>
    public ReloadPrompt()
        : this(PassthroughLocalizer.Instance, new StaticSoftwareUpdateSource(needRefresh: true), diagnostics: null)
    {
    }

    /// <summary>Creates the prompt over the i18n facade and the bound P1/S8 software-update seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="update">The software-update seam (web <c>useRegisterSW</c> pending-update state + reload).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ReloadPrompt(
        ILocalizer localizer,
        ISoftwareUpdateSource update,
        ReloadPromptDiagnostics? diagnostics = null)
        : this(new ReloadPromptViewModel(localizer, update), diagnostics)
    {
    }

    /// <summary>Creates the prompt over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ReloadPrompt(ReloadPromptViewModel viewModel, ReloadPromptDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ReloadPromptDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Bottom;
        VerticalContentAlignment = VerticalAlignment.Bottom;
        Padding = new Thickness(OuterPad);
        IsTabStop = false;

        BuildTree();

        AutomationProperties.SetAutomationId(this, ReloadPromptRegistration.PromptAutomationId);
        AutomationProperties.SetAutomationId(_reload, ReloadPromptRegistration.ReloadAutomationId);
        AutomationProperties.SetAutomationId(_later, ReloadPromptRegistration.LaterAutomationId);

        // web role="alert" aria-live="polite": the banner appears proactively — announce it politely so Narrator
        // surfaces it without moving focus.
        LiveRegion.Configure(this);

        _reload.Click += OnReloadClick;
        _later.Click += OnLaterClick;
        _countdownTimer.Tick += OnCountdownTick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>ReloadPrompt</c>).</summary>
    public static string Slug => ReloadPromptRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ReloadPromptViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (the prompt title).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _countdownTimer.Stop();
        _countdownTimer.Tick -= OnCountdownTick;
        StopStoryboard();
        StopSpin();
        _reload.Click -= OnReloadClick;
        _later.Click -= OnLaterClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ReloadPromptAutomationPeer(this);

    private void BuildTree()
    {
        _chip.Background = AccentTint(ReloadPromptRegistration.ChipTintOpacity);
        _chipGlyph.Foreground = AccentBrush();
        _chipGlyph.RenderTransform = _spinTransform;
        _chip.Child = _chipGlyph;

        _title.Foreground = DisplayTokens.TextPrimary;
        _subtitle.Foreground = DisplayTokens.TextSecondary;
        _textColumn.Children.Add(_title);
        _textColumn.Children.Add(_subtitle);

        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_chip, 0);
        Grid.SetColumn(_textColumn, 1);
        Grid.SetColumn(_later, 2);
        Grid.SetColumn(_reload, 3);

        _content.Children.Add(_chip);
        _content.Children.Add(_textColumn);
        _content.Children.Add(_later);
        _content.Children.Add(_reload);

        // The cyan chip is a decorative brand mark; the surface's Narrator name (the title) is authoritative.
        AutomationProperties.SetAccessibilityView(_chip, AccessibilityView.Raw);

        _card.BorderBrush = AccentTint(ReloadPromptRegistration.BorderTintOpacity);
        _card.Content = _content;
        _card.RenderTransform = _slide;
        _root.Children.Add(_card);
    }

    private void OnReloadClick(object sender, RoutedEventArgs e) => _ = _viewModel.ReloadAsync();

    private void OnLaterClick(object sender, RoutedEventArgs e) => _viewModel.Dismiss();

    private void OnCountdownTick(object? sender, object e) => _viewModel.Tick();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        // Snap to the correct state once layout is valid, then animate subsequent transitions.
        _ready = false;
        ApplyVisualState();
        _ready = true;

        if (_viewModel.Projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        var projection = _viewModel.Projection;

        _title.Text = projection.Title;
        _subtitle.Text = projection.CountdownMessage;
        _later.Text = projection.LaterLabel;
        _reload.Text = projection.ReloadNowLabel;

        AutomationProperties.SetName(_later, projection.LaterLabel);
        AutomationProperties.SetName(_reload, projection.ReloadNowLabel);

        // web role/labelling: the banner is named by its title and described by the countdown subtitle.
        AutomationProperties.SetName(this, projection.AccessibleName);
        AutomationProperties.SetFullDescription(this, projection.Description);

        ApplyVisualState();

        if (_ready && projection.IsVisible)
        {
            LiveRegion.Announce(this);
        }
    }

    private void ApplyVisualState()
    {
        var visible = _viewModel.Projection.IsVisible;

        UpdateCountdownTimer(visible);
        UpdateSpin(visible);

        if (!_ready || _reduceMotion)
        {
            StopStoryboard();
            Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
            _card.Opacity = 1;
            _slide.Y = 0;
            return;
        }

        if (visible)
        {
            AnimateIn();
        }
        else
        {
            AnimateOut();
        }
    }

    private void UpdateCountdownTimer(bool visible)
    {
        // web: the 1s interval runs only while needRefresh is set; clearCountdown on hide / reload / dismiss.
        if (visible && !_countdownTimer.IsEnabled)
        {
            _countdownTimer.Start();
        }
        else if (!visible && _countdownTimer.IsEnabled)
        {
            _countdownTimer.Stop();
        }
    }

    private void UpdateSpin(bool visible)
    {
        // web RefreshCw animate-spin: spin continuously while shown, honouring reduce-motion (no spin).
        if (visible && !_reduceMotion)
        {
            StartSpin();
        }
        else
        {
            StopSpin();
        }
    }

    private void StartSpin()
    {
        if (_spinStoryboard is not null)
        {
            return;
        }

        var spin = new DoubleAnimation
        {
            From = 0,
            To = 360,
            Duration = new Duration(TimeSpan.FromMilliseconds(SpinDurationMs)),
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(spin, _spinTransform);
        Storyboard.SetTargetProperty(spin, "Angle");

        var storyboard = new Storyboard();
        storyboard.Children.Add(spin);
        _spinStoryboard = storyboard;
        storyboard.Begin();
    }

    private void StopSpin()
    {
        if (_spinStoryboard is null)
        {
            return;
        }

        _spinStoryboard.Stop();
        _spinStoryboard = null;
        _spinTransform.Angle = 0;
    }

    private void AnimateIn()
    {
        Visibility = Visibility.Visible;
        AnimateTo(opacityTo: 1, translateTo: 0, onComplete: null);
    }

    private void AnimateOut()
    {
        AnimateTo(opacityTo: 0, translateTo: SlideOffset, onComplete: () => Visibility = Visibility.Collapsed);
    }

    private void AnimateTo(double opacityTo, double translateTo, Action? onComplete)
    {
        StopStoryboard();

        var duration = new Duration(TimeSpan.FromMilliseconds(TransitionMs));
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var storyboard = new Storyboard();

        var opacity = new DoubleAnimation
        {
            From = _card.Opacity,
            To = opacityTo,
            Duration = duration,
            EasingFunction = ease,
        };
        Storyboard.SetTarget(opacity, _card);
        Storyboard.SetTargetProperty(opacity, "Opacity");
        storyboard.Children.Add(opacity);

        var slide = new DoubleAnimation
        {
            From = _slide.Y,
            To = translateTo,
            Duration = duration,
            EnableDependentAnimation = true,
            EasingFunction = ease,
        };
        Storyboard.SetTarget(slide, _slide);
        Storyboard.SetTargetProperty(slide, "Y");
        storyboard.Children.Add(slide);

        if (onComplete is not null)
        {
            storyboard.Completed += (_, _) => onComplete();
        }

        _storyboard = storyboard;
        storyboard.Begin();
    }

    private void StopStoryboard()
    {
        _storyboard?.Stop();
        _storyboard = null;
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

    private static SolidColorBrush AccentBrush()
    {
        // web text-neon-cyan: the brand accent, theme-aware so light / dark / high-contrast flow from the W1 tokens.
        if (DisplayTokens.Brush(ReloadPromptRegistration.AccentBrushKey) is SolidColorBrush brush)
        {
            return new SolidColorBrush(brush.Color);
        }

        return new SolidColorBrush(AccentFallbackColor());
    }

    private static SolidColorBrush AccentTint(double opacity)
    {
        // web bg-neon-cyan/10 and border-neon-cyan/30: the accent at a fractional opacity.
        return new SolidColorBrush(AccentBrush().Color) { Opacity = opacity };
    }

    private static Windows.UI.Color AccentFallbackColor()
    {
        var span = ReloadPromptRegistration.AccentColorFallback.AsSpan().TrimStart('#');
        if (span.Length == 6
            && byte.TryParse(span[..2], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var r)
            && byte.TryParse(span[2..4], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var g)
            && byte.TryParse(span[4..6], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out var b))
        {
            return Windows.UI.Color.FromArgb(255, r, g, b);
        }

        return Microsoft.UI.Colors.Cyan;
    }

    private sealed class ReloadPromptAutomationPeer : FrameworkElementAutomationPeer
    {
        public ReloadPromptAutomationPeer(ReloadPrompt owner)
            : base(owner)
        {
        }

        private ReloadPrompt Surface => (ReloadPrompt)Owner;

        // The banner is a named, non-modal status region; the title is the authoritative Narrator name.
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
