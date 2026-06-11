using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>LiveIndicator</c> shared surface — a parity port of
/// web/src/components/data-display/LiveIndicator.tsx. It is the at-a-glance health pill for the live-data
/// pipeline that lives in the app shell / page headers, reproducing the four <c>useLiveConnection</c> states
/// (connected → emerald Wifi + "Live · {age}", reconnecting → amber spinning glyph + "Reconnecting…",
/// disconnected → rose WifiOff + "Offline", unknown → muted WifiOff + "Unknown") across the three web variants:
/// <see cref="LiveIndicatorVariant.Pill"/> (chip with icon, label and — when connected — a freshness timestamp),
/// <see cref="LiveIndicatorVariant.Compact"/> (chip with icon + label, no timestamp) and
/// <see cref="LiveIndicatorVariant.Dot"/> (a bare colored dot whose Narrator name and tooltip are the state
/// label, for dense headers). Every accent is the generated design token for the state (so light / dark /
/// high-contrast all flow from the token set); the reconnecting glyph spins (web <c>animate-spin</c>) only when
/// the OS reduce-motion preference allows it. All state flows through <see cref="LiveIndicatorViewModel"/>; the
/// view performs no I/O and reads no stream itself. The connected freshness label advances on a 30-second tick
/// (the web parent's re-render). The surface is a polite status live region (web <c>role="status"</c>) and emits
/// the <c>view.opened</c> diagnostic once when it is shown.
/// </summary>
public sealed partial class LiveIndicator : ContentControl, IDisposable
{
    private const double DotSize = 8;            // web dot h-2 w-2
    private const double IconFontSize = 12;      // web icon h-3 w-3
    private const double LabelFontSize = 12;     // web text-xs
    private const double RowSpacing = 6;         // web gap-1.5
    private const double ChipPaddingX = 8;       // web px-2
    private const double ChipPaddingY = 2;       // web py-0.5
    private const double TintAlpha = 0.10;       // web bg-{tone}-500/10
    private const int SpinMs = 1000;             // web animate-spin cadence
    private const int RelativeTickSeconds = 30;  // freshness stamp re-render cadence

    private readonly LiveIndicatorViewModel _viewModel;
    private readonly LiveIndicatorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Ellipse _dot = new()
    {
        Width = DotSize,
        Height = DotSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _row = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = RowSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _icon = new()
    {
        FontSize = IconFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _label = new()
    {
        FontSize = LabelFontSize,
        FontWeight = FontWeights.Medium,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _stamp = new()
    {
        FontSize = LabelFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _chip;
    private readonly RotateTransform _iconRotation = new();

    private Storyboard? _spinStoryboard;
    private DispatcherQueueTimer? _tickTimer;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the indicator with no live source (the designer / parameterless host entry point): it renders the
    /// "Unknown" state as a pill. Strings resolve through the passthrough localizer; supply an explicit
    /// <see cref="ILocalizer"/> and a bound <see cref="ILiveIndicatorSource"/> via the other constructors to drive
    /// i18n and data from the composition root.
    /// </summary>
    public LiveIndicator()
        : this(PassthroughLocalizer.Instance, new StaticLiveIndicatorSource(), LiveIndicatorVariant.Pill, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the indicator over the i18n facade and a bound live-connection seam (the production entry point),
    /// reading the system reduce-motion preference.
    /// </summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The live-connection state-holder seam (web <c>useLiveConnection</c>).</param>
    /// <param name="variant">The visual variant (web <c>variant</c>, default <see cref="LiveIndicatorVariant.Pill"/>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LiveIndicator(
        ILocalizer localizer,
        ILiveIndicatorSource source,
        LiveIndicatorVariant variant = LiveIndicatorVariant.Pill,
        LiveIndicatorDiagnostics? diagnostics = null)
        : this(
            new LiveIndicatorViewModel(localizer, source, new SystemMotionPreferenceSource(), variant),
            diagnostics)
    {
    }

    /// <summary>Creates the indicator over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LiveIndicator(LiveIndicatorViewModel viewModel, LiveIndicatorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new LiveIndicatorDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        _icon.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
        _icon.RenderTransform = _iconRotation;

        _row.Children.Add(_icon);
        _row.Children.Add(_label);
        _row.Children.Add(_stamp);

        _chip = new Border
        {
            Child = _row,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(ChipPaddingX, ChipPaddingY, ChipPaddingX, ChipPaddingY),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // web role="status" (⇒ implicit aria-live="polite"): a polite live region whose Narrator name is the label.
        AutomationProperties.SetLiveSetting(this, AutomationLiveSetting.Polite);
        AutomationProperties.SetAutomationId(this, LiveIndicatorRegistration.RootAutomationId);

        // The dot / icon / label / stamp subtree is decorative; the control's Narrator name is authoritative.
        AutomationProperties.SetAccessibilityView(_dot, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_chip, AccessibilityView.Raw);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>LiveIndicator</c>).</summary>
    public static string Slug => LiveIndicatorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public LiveIndicatorViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports (web <c>aria-label</c>).</summary>
    internal string AccessibleName => _viewModel.AutomationName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopSpin();
        if (_tickTimer is { } timer)
        {
            timer.Stop();
            _tickTimer = null;
        }

        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new LiveIndicatorAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        StartTickTimer();
        ApplyMotion();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var projection = _viewModel.Projection;
        var accent = DisplayTokens.Brush(projection.AccentBrushKey);

        if (projection.ShowDot)
        {
            // web variant === 'dot': a bare colored dot; the label is exposed as the tooltip + Narrator name.
            _dot.Fill = accent;
            Content = _dot;
            ToolTipService.SetToolTip(this, projection.Label);
        }
        else
        {
            // web variant 'pill' / 'compact': a tinted, hairline-ringed chip with icon + label (+ freshness stamp).
            _icon.Glyph = projection.IconGlyph;
            _icon.Foreground = accent;

            _label.Text = projection.Label;
            _label.Foreground = accent;
            _label.Visibility = projection.ShowLabel ? Visibility.Visible : Visibility.Collapsed;

            _stamp.Text = projection.ShowTimestamp
                ? $"{LiveIndicatorRegistration.MiddleDot} {projection.RelativeText}"
                : string.Empty;
            _stamp.Foreground = DisplayTokens.TextMuted;
            _stamp.Visibility = projection.ShowTimestamp ? Visibility.Visible : Visibility.Collapsed;

            _chip.Background = Tint(accent, TintAlpha);
            Content = _chip;
            ToolTipService.SetToolTip(this, null);
        }

        // web aria-label / role="status": the control's Narrator name is the state label.
        AutomationProperties.SetName(this, projection.AutomationName);

        ApplyMotion();
    }

    private void ApplyMotion()
    {
        StopSpin();
        _iconRotation.Angle = 0;

        if (!IsLoaded)
        {
            // Storyboards can only begin once the element is in the live tree; OnLoaded re-applies.
            return;
        }

        if (_viewModel.Projection.Spin)
        {
            StartSpin();
        }
    }

    private void StartSpin()
    {
        var animation = new DoubleAnimation
        {
            From = 0,
            To = 360,
            Duration = new Duration(TimeSpan.FromMilliseconds(SpinMs)),
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(animation, _iconRotation);
        Storyboard.SetTargetProperty(animation, "Angle");

        _spinStoryboard = new Storyboard();
        _spinStoryboard.Children.Add(animation);
        _spinStoryboard.Begin();
    }

    private void StopSpin()
    {
        _spinStoryboard?.Stop();
        _spinStoryboard = null;
    }

    private void StartTickTimer()
    {
        if (_tickTimer is not null || _dispatcher is null)
        {
            return;
        }

        var timer = _dispatcher.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(RelativeTickSeconds);
        timer.IsRepeating = true;
        timer.Tick += (_, _) => _viewModel.NotifyTimeChanged();
        timer.Start();
        _tickTimer = timer;
    }

    private static Brush Tint(Brush source, double alpha)
    {
        if (source is SolidColorBrush scb)
        {
            var c = scb.Color;
            var a = (byte)Math.Clamp(alpha * 255, 0, 255);
            return new SolidColorBrush(Windows.UI.Color.FromArgb(a, c.R, c.G, c.B));
        }

        return source;
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

    /// <summary>
    /// The system reduce-motion source backing the production view — reads the OS "show animations" flag through
    /// <see cref="MotionPreference"/> (the read-once policy every motion-aware control in this app uses; the
    /// runtime-change subscription is intentionally inert to avoid the platform-gated UISettings change event).
    /// Lives with the view so the WinUI-free state-holder layer stays portable to the headless test host.
    /// </summary>
    private sealed class SystemMotionPreferenceSource : IMotionPreferenceSource
    {
        public bool ReduceMotion => MotionPreference.ReduceMotion;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            return NoOpSubscription.Instance;
        }

        private sealed class NoOpSubscription : IDisposable
        {
            public static NoOpSubscription Instance { get; } = new();

            private NoOpSubscription()
            {
            }

            public void Dispose()
            {
                // Read-once: the preference is not observed for runtime changes.
            }
        }
    }

    private sealed class LiveIndicatorAutomationPeer : FrameworkElementAutomationPeer
    {
        public LiveIndicatorAutomationPeer(LiveIndicator owner)
            : base(owner)
        {
        }

        private LiveIndicator Surface => (LiveIndicator)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.StatusBar;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
