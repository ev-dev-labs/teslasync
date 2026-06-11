using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>DataFreshness</c> shared surface — a parity port of
/// web/src/components/data-display/DataFreshness.tsx. It is the query-result-driven freshness chip that lives in
/// a widget/page header: a status dot, a Segoe Fluent glyph standing in for the web Lucide icon (Wifi / RefreshCw
/// / WifiOff) and a relative "updated" label ("just now", "5m ago", "updating…", "error"). The four states are
/// derived from the bound <see cref="IDataFreshnessSource"/> with the web precedence
/// <c>error &gt; fetching &gt; stale &gt; fresh</c>: fresh/stale tint the chip success/warning with the Wifi
/// glyph and the relative age, fetching tints it info with the spinning refresh glyph and "updating…", and error
/// tints it danger with the WifiOff glyph (showing the cached age when offline-cached, else "error"). It is
/// reduced-motion-aware — the refresh glyph stops spinning, the dot stops its ping ring and the background-
/// refetch pulse is suppressed (the web <c>motion-safe:</c> behaviour); under reduced motion an in-flight fetch
/// is still surfaced through the "Updating…" tooltip. When a refresh affordance is offered the surface is a
/// keyboard-focusable button whose Narrator name is "Refresh" and whose invoke / click / Enter / Space forwards
/// a refresh (web <c>role="button"</c> + <c>onClick</c>); otherwise it is a polite status live region named
/// "Data freshness: {state}" (web <c>role="status" aria-live="polite"</c>). All state flows through
/// <see cref="DataFreshnessViewModel"/>; the view performs no I/O and reads no query itself. The relative label
/// advances on a 30-second tick (the web <c>setInterval</c>). The surface emits the <c>view.opened</c> diagnostic
/// once when it is shown.
/// </summary>
public sealed partial class DataFreshness : ContentControl, IDisposable
{
    private const double DotSize = 6;                 // web dot h-1.5 w-1.5
    private const double IconFontSize = 10;           // web icon h-2.5 w-2.5
    private const double CompactIconFontSize = 8;     // web compact icon h-2 w-2
    private const double TextFontSize = 10;           // web text-[10px]
    private const double TextMinWidth = 72;           // web min-w-[4.5rem]
    private const double RowSpacing = 4;              // web gap-1
    private const double CompactRowSpacing = 2;       // web gap-0.5
    private const double PingScale = 2.5;             // web animate-ping expansion
    private const double PingStartOpacity = 0.4;      // web animate-ping opacity-40
    private const double PulseTroughOpacity = 0.4;    // web animate-pulse trough
    private const int SpinMs = 1000;                  // web animate-spin cadence
    private const int PingMs = 1000;                  // web animate-ping cadence
    private const int PulseMs = 900;                  // shared PulseHelper cadence
    private const int RelativeTickSeconds = 30;       // web setInterval(…, 30_000)

    private readonly DataFreshnessViewModel _viewModel;
    private readonly DataFreshnessDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Horizontal,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Grid _dotHost = new()
    {
        Width = DotSize,
        Height = DotSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Ellipse _pingRing = new()
    {
        Width = DotSize,
        Height = DotSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        Opacity = 0,
        IsHitTestVisible = false,
    };

    private readonly Ellipse _dot = new()
    {
        Width = DotSize,
        Height = DotSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _icon = new()
    {
        FontSize = IconFontSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _text = new()
    {
        FontSize = TextFontSize,
        MinWidth = TextMinWidth,
        TextAlignment = TextAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
        IsTextSelectionEnabled = false,
    };

    private readonly ScaleTransform _pingScale = new();
    private readonly RotateTransform _iconRotation = new();

    private Storyboard? _spinStoryboard;
    private Storyboard? _pingStoryboard;
    private Storyboard? _pulseStoryboard;
    private DispatcherQueueTimer? _tickTimer;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the chip with no data and no refresh affordance (the designer / parameterless host entry point):
    /// it renders the "Never updated" empty state. Strings resolve through the resource facade; supply an
    /// explicit <see cref="ILocalizer"/> and a bound <see cref="IDataFreshnessSource"/> via the other
    /// constructors to drive i18n and data from the composition root.
    /// </summary>
    public DataFreshness()
        : this(
            PassthroughLocalizer.Instance,
            new StaticDataFreshnessSource(DataFreshnessSnapshot.Empty, canRefresh: false),
            compact: false,
            diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the chip over the i18n facade and a bound freshness seam (the production entry point), reading the
    /// system reduce-motion preference.
    /// </summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The freshness state-holder seam (web query result).</param>
    /// <param name="compact">Whether to render the icon-only compact chip (web <c>compact</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DataFreshness(
        ILocalizer localizer,
        IDataFreshnessSource source,
        bool compact = false,
        DataFreshnessDiagnostics? diagnostics = null)
        : this(
            new DataFreshnessViewModel(localizer, source, new SystemMotionPreferenceSource(), compact),
            diagnostics)
    {
    }

    /// <summary>Creates the chip over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DataFreshness(DataFreshnessViewModel viewModel, DataFreshnessDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new DataFreshnessDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;
        UseSystemFocusVisuals = true;

        BuildChrome();

        // web aria-live="polite": a polite live region whose Narrator name is the composed aria-label.
        AutomationProperties.SetAutomationId(this, DataFreshnessRegistration.RootAutomationId);
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Tapped += OnTapped;
        KeyDown += OnKeyDown;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>DataFreshness</c>).</summary>
    public static string Slug => DataFreshnessRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DataFreshnessViewModel ViewModel => _viewModel;

    /// <summary>Whether the chip is an interactive refresh affordance (drives the button vs text automation peer).</summary>
    internal bool Interactive => _viewModel.Interactive;

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
        StopStoryboards();
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
    protected override AutomationPeer OnCreateAutomationPeer() => new DataFreshnessAutomationPeer(this);

    /// <summary>Forward a refresh request to the state holder (the automation Invoke / click / key handlers).</summary>
    internal void InvokeRefresh() => _viewModel.RequestRefresh();

    private void BuildChrome()
    {
        _pingRing.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
        _pingRing.RenderTransform = _pingScale;
        _icon.RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5);
        _icon.RenderTransform = _iconRotation;

        _dotHost.Children.Add(_pingRing);
        _dotHost.Children.Add(_dot);

        _root.Children.Add(_dotHost);
        _root.Children.Add(_icon);
        _root.Children.Add(_text);

        // The dot / icon / relative-time subtree is decorative; the control's Narrator name (the web aria-label,
        // grouping the dot + icon + text as a single utterance via aria-atomic) is authoritative.
        AutomationProperties.SetAccessibilityView(_dotHost, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_text, AccessibilityView.Raw);
    }

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

    private void OnTapped(object sender, TappedRoutedEventArgs e)
    {
        if (!_viewModel.Interactive)
        {
            return;
        }

        e.Handled = true;
        _viewModel.RequestRefresh();
    }

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (!_viewModel.Interactive)
        {
            return;
        }

        if (e.Key is Windows.System.VirtualKey.Enter or Windows.System.VirtualKey.Space)
        {
            e.Handled = true;
            _viewModel.RequestRefresh();
        }
    }

    private void Render()
    {
        var projection = _viewModel.Projection;
        var accent = DisplayTokens.Brush(projection.AccentBrushKey);

        _dot.Fill = accent;
        _pingRing.Fill = accent;

        _icon.Glyph = projection.IconGlyph;
        _icon.Foreground = accent;
        _icon.FontSize = projection.Compact ? CompactIconFontSize : IconFontSize;

        _text.Text = projection.RelativeText;
        _text.Foreground = accent;
        _text.Visibility = projection.ShowText ? Visibility.Visible : Visibility.Collapsed;

        _root.Spacing = projection.Compact ? CompactRowSpacing : RowSpacing;

        IsTabStop = projection.Interactive;

        // web role="button" → a focusable, invokable control; role="status" → a non-focusable polite live region.
        AutomationProperties.SetName(this, projection.AutomationName);
        ToolTipService.SetToolTip(this, projection.Title);

        ApplyMotion();

        // web aria-live="polite": announce the freshness transition once the surface is mounted.
        if (IsLoaded)
        {
            LiveRegion.Announce(this);
        }
    }

    private void ApplyMotion()
    {
        StopStoryboards();

        var projection = _viewModel.Projection;
        _pingRing.Visibility = projection.Ping ? Visibility.Visible : Visibility.Collapsed;

        // Reset to the static resting pose before (optionally) restarting the loops.
        _iconRotation.Angle = 0;
        _pingScale.ScaleX = 1;
        _pingScale.ScaleY = 1;
        _pingRing.Opacity = projection.Ping ? PingStartOpacity : 0;
        _dot.Opacity = 1;

        if (!IsLoaded)
        {
            // Storyboards can only begin once the elements are in the live tree; OnLoaded re-applies.
            return;
        }

        if (projection.Spin)
        {
            StartSpin();
        }

        if (projection.Ping)
        {
            StartPing();
        }

        if (projection.PulseDot)
        {
            StartPulse();
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

    private void StartPing()
    {
        _pingScale.CenterX = DotSize / 2;
        _pingScale.CenterY = DotSize / 2;

        var storyboard = new Storyboard();
        foreach (var property in new[] { "ScaleX", "ScaleY" })
        {
            var scale = new DoubleAnimation
            {
                From = 1,
                To = PingScale,
                Duration = new Duration(TimeSpan.FromMilliseconds(PingMs)),
                RepeatBehavior = RepeatBehavior.Forever,
                EnableDependentAnimation = true,
            };
            Storyboard.SetTarget(scale, _pingScale);
            Storyboard.SetTargetProperty(scale, property);
            storyboard.Children.Add(scale);
        }

        var fade = new DoubleAnimation
        {
            From = PingStartOpacity,
            To = 0,
            Duration = new Duration(TimeSpan.FromMilliseconds(PingMs)),
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(fade, _pingRing);
        Storyboard.SetTargetProperty(fade, "Opacity");
        storyboard.Children.Add(fade);

        _pingStoryboard = storyboard;
        storyboard.Begin();
    }

    private void StartPulse()
    {
        var animation = new DoubleAnimation
        {
            From = 1.0,
            To = PulseTroughOpacity,
            Duration = new Duration(TimeSpan.FromMilliseconds(PulseMs)),
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
        };
        Storyboard.SetTarget(animation, _dot);
        Storyboard.SetTargetProperty(animation, "Opacity");

        _pulseStoryboard = new Storyboard();
        _pulseStoryboard.Children.Add(animation);
        _pulseStoryboard.Begin();
    }

    private void StopStoryboards()
    {
        _spinStoryboard?.Stop();
        _spinStoryboard = null;
        _pingStoryboard?.Stop();
        _pingStoryboard = null;
        _pulseStoryboard?.Stop();
        _pulseStoryboard = null;
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
    /// The system reduce-motion source backing the production view — reads the OS "show animations" flag once
    /// through <see cref="MotionPreference"/> (the read-once policy every motion-aware control in this app uses;
    /// the runtime-change subscription is intentionally a no-op to avoid the platform-gated UISettings change
    /// event). Lives with the view so the WinUI-free state-holder layer stays portable to the headless test host.
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

    private sealed class DataFreshnessAutomationPeer : FrameworkElementAutomationPeer, IInvokeProvider
    {
        public DataFreshnessAutomationPeer(DataFreshness owner)
            : base(owner)
        {
        }

        private DataFreshness Surface => (DataFreshness)Owner;

        public void Invoke() => Surface.InvokeRefresh();

        protected override AutomationControlType GetAutomationControlTypeCore() =>
            Surface.Interactive ? AutomationControlType.Button : AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }

        protected override object? GetPatternCore(PatternInterface patternInterface)
        {
            if (patternInterface == PatternInterface.Invoke && Surface.Interactive)
            {
                return this;
            }

            return base.GetPatternCore(patternInterface);
        }
    }
}
