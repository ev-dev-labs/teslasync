using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>FreshnessIndicator</c> shared surface — a parity port of
/// web/src/components/data-display/FreshnessIndicator.tsx. It is the per-datum freshness dot that sits next to a
/// value: a small status-coloured dot plus an optional relative-age label ("just now", "12s ago", "5m ago",
/// "3h ago"), indicating how recently a SPECIFIC data point was sampled (e.g. the last battery_level reading or
/// GPS fix). The four states are derived from the bound <see cref="IFreshnessIndicatorSource"/> timestamp: fresh
/// tints the dot success and pulses it, stale tints it warning, offline tints it danger, and the no-reading
/// unknown state renders the muted dot beside an em dash (it is the always-visible rendering for "no reading
/// yet" / "could not load" — never a hidden surface). It is reduced-motion-aware — under reduced motion the
/// fresh dot stops pulsing (the web <c>animate-pulse</c> under <c>prefers-reduced-motion</c>). The surface is a
/// read-only status indicator named "Data freshness: {state}, {age}" so Narrator conveys the colour-only
/// semantic. All state flows through <see cref="FreshnessIndicatorViewModel"/>; the view performs no I/O and
/// reads no query itself. The relative label advances on a 10-second tick (the web <c>setInterval</c>). The
/// surface emits the <c>view.opened</c> diagnostic once when it is shown.
/// </summary>
public sealed partial class FreshnessIndicator : ContentControl, IDisposable
{
    private const double PulseTroughOpacity = 0.4;   // web animate-pulse trough
    private const int PulseMs = 900;                 // shared pulse cadence
    private const int RelativeTickSeconds = 10;      // web setInterval(…, 10_000)
    private const double RowSpacing = 4;             // web gap-1

    private readonly FreshnessIndicatorViewModel _viewModel;
    private readonly FreshnessIndicatorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Horizontal,
        VerticalAlignment = VerticalAlignment.Center,
        Spacing = RowSpacing,
    };

    private readonly Ellipse _dot = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _label = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        IsTextSelectionEnabled = false,
    };

    private Storyboard? _pulseStoryboard;
    private DispatcherQueueTimer? _tickTimer;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the indicator with no reading (the designer / parameterless host entry point): it renders the
    /// unknown state (muted dot + em dash). Strings resolve through the resource facade; supply an explicit
    /// <see cref="ILocalizer"/> and a bound <see cref="IFreshnessIndicatorSource"/> via the other constructors to
    /// drive i18n and data from the composition root.
    /// </summary>
    public FreshnessIndicator()
        : this(
            PassthroughLocalizer.Instance,
            new StaticFreshnessIndicatorSource(FreshnessIndicatorSnapshot.Empty),
            diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the indicator over the i18n facade and a bound freshness seam (the production entry point),
    /// reading the system reduce-motion preference.
    /// </summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The freshness state-holder seam (web <c>timestamp</c> prop).</param>
    /// <param name="size">The size variant (web <c>size</c>); defaults to <see cref="FreshnessIndicatorSize.Small"/>.</param>
    /// <param name="showLabel">Whether the relative label is shown (web <c>showLabel</c>); defaults to true.</param>
    /// <param name="staleThreshold">Seconds before the data point is stale (web <c>staleThreshold</c>).</param>
    /// <param name="offlineThreshold">Seconds before the data point is offline (web <c>offlineThreshold</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FreshnessIndicator(
        ILocalizer localizer,
        IFreshnessIndicatorSource source,
        FreshnessIndicatorSize size = FreshnessIndicatorSize.Small,
        bool showLabel = true,
        int staleThreshold = FreshnessIndicatorRegistration.DefaultStaleThresholdSeconds,
        int offlineThreshold = FreshnessIndicatorRegistration.DefaultOfflineThresholdSeconds,
        FreshnessIndicatorDiagnostics? diagnostics = null)
        : this(
            new FreshnessIndicatorViewModel(
                localizer,
                source,
                new SystemMotionPreferenceSource(),
                size,
                showLabel,
                staleThreshold,
                offlineThreshold),
            diagnostics)
    {
    }

    /// <summary>Creates the indicator over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FreshnessIndicator(FreshnessIndicatorViewModel viewModel, FreshnessIndicatorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new FreshnessIndicatorDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;
        IsTabStop = false;

        BuildChrome();

        AutomationProperties.SetAutomationId(this, FreshnessIndicatorRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>FreshnessIndicator</c>).</summary>
    public static string Slug => FreshnessIndicatorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public FreshnessIndicatorViewModel ViewModel => _viewModel;

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
        StopStoryboard();
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
    protected override AutomationPeer OnCreateAutomationPeer() => new FreshnessIndicatorAutomationPeer(this);

    private void BuildChrome()
    {
        _root.Children.Add(_dot);
        _root.Children.Add(_label);

        // The dot + relative-time pair is decorative; the control's composed Narrator name is authoritative.
        AutomationProperties.SetAccessibilityView(_dot, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_label, AccessibilityView.Raw);
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

    private void Render()
    {
        var projection = _viewModel.Projection;
        var accent = DisplayTokens.Brush(projection.AccentBrushKey);

        _dot.Width = projection.DotDiameter;
        _dot.Height = projection.DotDiameter;
        _dot.Fill = accent;

        _label.Text = projection.Label;
        _label.FontSize = projection.LabelFontSize;
        _label.Foreground = DisplayTokens.TextMuted;
        _label.Visibility = projection.ShowLabel ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, projection.AutomationName);

        // web title={timestamp ?? undefined}: a tooltip only when a reading exists.
        if (string.IsNullOrEmpty(projection.Title))
        {
            ToolTipService.SetToolTip(this, null);
        }
        else
        {
            ToolTipService.SetToolTip(this, projection.Title);
        }

        ApplyMotion();
    }

    private void ApplyMotion()
    {
        StopStoryboard();

        var projection = _viewModel.Projection;

        // Reset to the static resting pose before (optionally) restarting the loop.
        _dot.Opacity = 1;

        if (!IsLoaded)
        {
            // Storyboards can only begin once the element is in the live tree; OnLoaded re-applies.
            return;
        }

        if (projection.Pulse)
        {
            StartPulse();
        }
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

    private void StopStoryboard()
    {
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
    /// the runtime-change subscription is intentionally inert to avoid the platform-gated UISettings change
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

    private sealed class FreshnessIndicatorAutomationPeer : FrameworkElementAutomationPeer
    {
        public FreshnessIndicatorAutomationPeer(FreshnessIndicator owner)
            : base(owner)
        {
        }

        private FreshnessIndicator Surface => (FreshnessIndicator)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
