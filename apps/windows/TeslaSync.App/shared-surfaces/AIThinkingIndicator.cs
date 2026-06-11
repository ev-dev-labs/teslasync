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
using TeslaSync.App.Core.Notifications;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using ShapePath = Microsoft.UI.Xaml.Shapes.Path;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 AI thinking indicator — a parity port of <c>web/src/components/ai/AIThinkingIndicator.tsx</c>.
/// It is the streaming-but-empty state shown while the SSE connection is open and the first <c>delta.text</c>
/// frame has not yet arrived: a Helix brand mark (the cyan double-helix, gently pulsing) beside the
/// "Helix is thinking" label and three bouncing dots, above three shimmering prose skeleton lines whose
/// decreasing widths (full, 11/12, 9/12) mimic text. The surface is a polite live region
/// (<c>role="status"</c> / <c>aria-live="polite"</c>) whose accessible name is the label; the mark, dots and
/// skeleton are decorative and hidden from assistive technology (the web <c>aria-hidden</c> halves). It is
/// reduced-motion-aware: when the OS minimises animations the dots stop bouncing, the mark stops pulsing and the
/// lines drop their shimmer (the static skeleton is still shown) — the web <c>motion-safe:</c> behaviour. There
/// is no loading / error / stale / offline chrome because the indicator is purely presentational and reads no
/// network data (its only data source is the i18n facade); the reproduced branches are default-label,
/// custom-label and full-/reduced-motion. All state flows through <see cref="AIThinkingIndicatorViewModel"/>;
/// the view performs no I/O. The compact in-button variant is <see cref="AIThinkingDots"/>.
/// </summary>
public sealed partial class AIThinkingIndicator : ContentControl, IDisposable
{
    private const double ColumnSpacing = 12;       // web gap-3
    private const double StatusRowSpacing = 8;     // web gap-2
    private const double DotSpacing = 4;           // web gap-1
    private const double SkeletonSpacing = 8;      // web gap-2
    private const double SkeletonLineHeight = 12;  // web h-3
    private const double SkeletonRadius = 6;       // web rounded-md
    private const double HelixSize = 16;           // web h-4 w-4
    private const double HelixViewport = 24;       // web viewBox 0 0 24 24
    private const double HelixStrokeThickness = 1.75; // web HelixMark default strokeWidth
    private const double DotSize = 4;              // web h-1 w-1
    private const double LabelFontSize = 14;       // web text-sm
    private const double DotBounceOffset = -3;     // web animate-bounce rise
    private const double PulseMinOpacity = 0.5;    // web animate-pulse trough
    private const int DotBounceMs = 600;
    private const int DotStaggerMs = 150;          // web -0.15s cadence between dots
    private const int PulseMs = 900;

    // web HelixMark geometry: two intertwined quadratic strands + two horizontal rungs (viewBox 0 0 24 24).
    private static readonly string[] HelixGeometries =
    {
        "M 8 2 Q 18 7 12 12 Q 6 17 16 22",
        "M 16 2 Q 6 7 12 12 Q 18 17 8 22",
        "M 10 7 L 14 7",
        "M 10 17 L 14 17",
    };

    private readonly AIThinkingIndicatorViewModel _viewModel;
    private readonly AIThinkingIndicatorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = ColumnSpacing };
    private readonly StackPanel _statusRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = StatusRowSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Viewbox _helix = new()
    {
        Width = HelixSize,
        Height = HelixSize,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _label = new()
    {
        FontSize = LabelFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        VerticalAlignment = VerticalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly StackPanel _dots = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = DotSpacing,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private readonly StackPanel _skeletonColumn = new() { Spacing = SkeletonSpacing };

    private readonly List<TranslateTransform> _dotTransforms = new();

    private Storyboard? _bounceStoryboard;
    private Storyboard? _pulseStoryboard;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the indicator with the default Helix label and the system motion preference (the parameterless
    /// host/designer entry point). Strings resolve through the resource facade; supply an explicit
    /// <see cref="ILocalizer"/> via the other constructors to drive i18n from the composition root.
    /// </summary>
    public AIThinkingIndicator()
        : this(PassthroughLocalizer.Instance, label: null, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the indicator over the i18n facade, an optional already-translated label override (web
    /// <c>label</c> prop) and the system reduce-motion preference.
    /// </summary>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    /// <param name="label">An optional already-translated override label, or null for the Helix default.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AIThinkingIndicator(ILocalizer localizer, string? label = null, AIThinkingIndicatorDiagnostics? diagnostics = null)
        : this(
            new AIThinkingIndicatorViewModel(localizer, label, new SystemMotionPreferenceSource()),
            diagnostics)
    {
    }

    /// <summary>Creates the indicator over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AIThinkingIndicator(AIThinkingIndicatorViewModel viewModel, AIThinkingIndicatorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new AIThinkingIndicatorDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();

        // web role="status" aria-live="polite": a polite live region whose accessible name is the label.
        AutomationProperties.SetAutomationId(this, AIThinkingIndicatorRegistration.RootAutomationId);
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _root;
        Render();
    }

    /// <summary>The canonical surface slug (<c>AIThinkingIndicator</c>).</summary>
    public static string Slug => AIThinkingIndicatorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AIThinkingIndicatorViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopStoryboards();
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ThinkingAutomationPeer(this);

    private static Geometry ParseGeometry(string path) =>
        (Geometry)Microsoft.UI.Xaml.Markup.XamlBindingHelper.ConvertValue(typeof(Geometry), path);

    private void BuildChrome()
    {
        BuildHelix();
        BuildDots();

        _label.Foreground = DisplayTokens.Accent;

        _statusRow.Children.Add(_helix);
        _statusRow.Children.Add(_label);
        _statusRow.Children.Add(_dots);

        // The whole status row carries the label as the live-region content; the mark and dots are decorative.
        AutomationProperties.SetAccessibilityView(_helix, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_dots, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_skeletonColumn, AccessibilityView.Raw);

        _root.Children.Add(_statusRow);
        _root.Children.Add(_skeletonColumn);
    }

    private void BuildHelix()
    {
        var canvas = new Canvas { Width = HelixViewport, Height = HelixViewport };
        var accent = DisplayTokens.Accent;
        foreach (var geometry in HelixGeometries)
        {
            canvas.Children.Add(new ShapePath
            {
                Data = ParseGeometry(geometry),
                Stroke = accent,
                StrokeThickness = HelixStrokeThickness,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
            });
        }

        _helix.Child = canvas;
    }

    private void BuildDots()
    {
        var accent = DisplayTokens.Accent;
        for (var i = 0; i < AIThinkingIndicatorRegistration.DotCount; i++)
        {
            var transform = new TranslateTransform();
            _dotTransforms.Add(transform);
            _dots.Children.Add(new Ellipse
            {
                Width = DotSize,
                Height = DotSize,
                Fill = accent,
                VerticalAlignment = VerticalAlignment.Bottom,
                RenderTransform = transform,
            });
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        ApplyMotion(_viewModel.Animate);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        _label.Text = _viewModel.Label;

        // The status surface's accessible name is the label (the web role="status" element's only visible text).
        AutomationProperties.SetName(this, _viewModel.Label);

        ApplyMotion(_viewModel.Animate);
    }

    private void ApplyMotion(bool animate)
    {
        StopStoryboards();
        BuildSkeletonColumn(reduceMotion: !animate);

        if (!animate)
        {
            ResetToStatic();
            return;
        }

        if (!IsLoaded)
        {
            // Storyboards can only begin once the elements are in the live tree; OnLoaded re-applies.
            return;
        }

        StartBounce();
        StartPulse();
    }

    private void BuildSkeletonColumn(bool reduceMotion)
    {
        _skeletonColumn.Children.Clear();
        foreach ((int numerator, int denominator) in AIThinkingIndicatorRegistration.SkeletonLineFractions)
        {
            _skeletonColumn.Children.Add(BuildSkeletonLine(numerator, denominator, reduceMotion));
        }
    }

    private static FrameworkElement BuildSkeletonLine(int numerator, int denominator, bool reduceMotion)
    {
        var line = new TsSkeleton
        {
            BlockHeight = SkeletonLineHeight,
            Radius = SkeletonRadius,
            ReduceMotion = reduceMotion,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        if (numerator >= denominator)
        {
            return line;
        }

        // web w-11/12 and w-9/12: lay the line out proportionally so it tracks the container width responsively.
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(numerator, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition
        {
            Width = new GridLength(denominator - numerator, GridUnitType.Star),
        });
        Grid.SetColumn(line, 0);
        grid.Children.Add(line);
        return grid;
    }

    private void StartBounce()
    {
        var storyboard = new Storyboard();
        for (var i = 0; i < _dotTransforms.Count; i++)
        {
            var animation = new DoubleAnimation
            {
                From = 0,
                To = DotBounceOffset,
                Duration = new Duration(TimeSpan.FromMilliseconds(DotBounceMs)),
                BeginTime = TimeSpan.FromMilliseconds((long)i * DotStaggerMs),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EnableDependentAnimation = true,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            };
            Storyboard.SetTarget(animation, _dotTransforms[i]);
            Storyboard.SetTargetProperty(animation, "Y");
            storyboard.Children.Add(animation);
        }

        _bounceStoryboard = storyboard;
        storyboard.Begin();
    }

    private void StartPulse()
    {
        var animation = new DoubleAnimation
        {
            From = 1.0,
            To = PulseMinOpacity,
            Duration = new Duration(TimeSpan.FromMilliseconds(PulseMs)),
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
        };
        Storyboard.SetTarget(animation, _helix);
        Storyboard.SetTargetProperty(animation, "Opacity");

        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);
        _pulseStoryboard = storyboard;
        storyboard.Begin();
    }

    private void StopStoryboards()
    {
        _bounceStoryboard?.Stop();
        _bounceStoryboard = null;
        _pulseStoryboard?.Stop();
        _pulseStoryboard = null;
    }

    private void ResetToStatic()
    {
        foreach (var transform in _dotTransforms)
        {
            transform.Y = 0;
        }

        _helix.Opacity = 1;
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
    /// through <see cref="MotionPreference"/> (the same read-once policy every motion-aware control in this app
    /// uses; the runtime-change subscription is intentionally a no-op to avoid the platform-gated UISettings
    /// change event). Lives with the view so the WinUI-free state-holder layer stays portable to the headless
    /// test host.
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

    private sealed class ThinkingAutomationPeer : FrameworkElementAutomationPeer
    {
        public ThinkingAutomationPeer(AIThinkingIndicator owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AIThinkingIndicator)Owner).ViewModel.Label
                : name;
        }
    }
}
