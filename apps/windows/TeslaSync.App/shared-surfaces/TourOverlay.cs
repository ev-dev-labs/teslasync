using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;
using Windows.UI;
using ShapesPath = Microsoft.UI.Xaml.Shapes.Path;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>TourOverlay</c> shared surface — a parity port of the web <c>TourOverlay</c> export
/// (web/src/components/feedback/TourOverlay.tsx). It is the onboarding-tour spotlight: a full-bleed dimming scrim
/// (token <c>TsSurfaceOverlayBrush</c>, the web <c>--surface-overlay</c>) with a rectangular cut-out punched around
/// the highlighted element via an even-odd <see cref="ShapesPath"/> geometry (the web clip-path polygon), an accent
/// glow border tracing the spotlight (the web <c>--theme-primary</c> ring), and an anchored tooltip card carrying a
/// step counter, the step title and description, a close ("X"), a skip-tour link, an optional back control, a
/// next / finish control and a row of progress dots. It binds the <see cref="TourOverlayViewModel"/> over the P1/S8
/// <see cref="ITourOverlaySource"/> content seam and never owns tour state itself: the owner feeds the active step,
/// its measured target rect and the step index / count, exactly as the web parent's <c>useTour</c> hook feeds props,
/// and the surface delegates next / back / skip back to that owner.
///
/// <para>
/// State coverage: the web source fetches no data, so it has no loading / error / stale / offline chrome of its own;
/// its sole render branch is <c>if (!targetRect) return null</c> — those data-source lifecycle states therefore
/// collapse to the inactive (hidden) state, which is reproduced and tested. The states the web actually has are
/// reproduced in full: inactive (no tour, or the highlighted element not yet measured) and active (the spotlight +
/// tooltip), across every placement, the first / middle / last step, and the back-shown / arrow-shown branches. The
/// tooltip slides up and fades in when the tour starts, snapping to its final state under the OS reduce-motion
/// preference (the web framer-motion <c>animate-in</c>). The surface is a polite live region named by the dialog
/// label, exposes every interactive control with a localized name, and emits the <c>view.opened</c> diagnostic once
/// when first shown.
/// </para>
/// </summary>
public sealed partial class TourOverlay : ContentControl, IDisposable
{
    private const double CardPadding = 16;            // web p-4.
    private const double CloseInset = 4;              // web top-1 right-1.
    private const double CloseTouchTarget = 44;       // web min-w/h-[44px].
    private const double CounterFontSize = 11;        // web text-[10px], nudged for native legibility.
    private const double TitleFontSize = 14;          // web text-sm.
    private const double DescriptionFontSize = 12;    // web text-xs.
    private const double CounterSpacing = 4;          // web mb-1.
    private const double TitleSpacing = 4;            // web mb-1.
    private const double DescriptionSpacing = 16;     // web mb-4.
    private const double DotsTopSpacing = 12;         // web mt-3.
    private const double NavSpacing = 8;              // web gap-2.
    private const double DotsSpacing = 4;             // web gap-1.
    private const double DotCornerRadius = 2;         // web rounded-full on a 4px-tall pill.
    private const double NavGlyphSize = 13;           // web ArrowLeft/Right h-3.5 w-3.5.
    private const double CloseGlyphSize = 16;         // web X h-4 w-4.
    private const double GlowInset = 4;               // soft halo extent beyond the spotlight border.
    private const int TransitionMs = 240;             // web reveal duration.

    private readonly TourOverlayViewModel _viewModel;
    private readonly TourOverlayDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly bool _reduceMotion;

    private readonly Canvas _canvas = new()
    {
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Stretch,
    };

    private readonly ShapesPath _scrim = new();

    private readonly Border _glow = new()
    {
        IsHitTestVisible = false,
    };

    private readonly Border _spotlight = new()
    {
        BorderThickness = new Thickness(TourOverlayRegistration.SpotlightBorderThickness),
        CornerRadius = new CornerRadius(TourOverlayRegistration.SpotlightCornerRadius),
        IsHitTestVisible = false,
    };

    private readonly Border _tooltip = new()
    {
        CornerRadius = new CornerRadius(TourOverlayRegistration.TooltipCornerRadius),
        BorderThickness = new Thickness(1),
    };

    private readonly TranslateTransform _tooltipSlide = new() { Y = 0 };
    private readonly Grid _tooltipGrid = new();
    private readonly StackPanel _body = new();

    private readonly TextBlock _counter = new()
    {
        FontSize = CounterFontSize,
        Margin = new Thickness(0, 0, 0, CounterSpacing),
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TitleFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 0, CloseTouchTarget - CardPadding, TitleSpacing),
    };

    private readonly TextBlock _description = new()
    {
        FontSize = DescriptionFontSize,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 0, 0, DescriptionSpacing),
    };

    private readonly Grid _navRow = new();

    private readonly Button _skip = new()
    {
        Background = new SolidColorBrush(Colors.Transparent),
        BorderThickness = new Thickness(0),
        MinHeight = CloseTouchTarget,
        Padding = new Thickness(8, 0, 8, 0),
        HorizontalAlignment = HorizontalAlignment.Left,
    };

    private readonly TextBlock _skipText = new() { FontSize = DescriptionFontSize };

    private readonly StackPanel _navButtons = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = NavSpacing,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly TsButton _back = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
    };

    private readonly StackPanel _backContent = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _backGlyph = new()
    {
        Glyph = TourOverlayRegistration.BackGlyph,
        FontSize = NavGlyphSize,
    };

    private readonly TextBlock _backText = new();

    private readonly TsButton _next = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
    };

    private readonly StackPanel _nextContent = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _nextText = new();

    private readonly FontIcon _nextGlyph = new()
    {
        Glyph = TourOverlayRegistration.NextGlyph,
        FontSize = NavGlyphSize,
    };

    private readonly Button _close = new()
    {
        Background = new SolidColorBrush(Colors.Transparent),
        BorderThickness = new Thickness(0),
        MinWidth = CloseTouchTarget,
        MinHeight = CloseTouchTarget,
        Padding = new Thickness(0),
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Top,
        Margin = new Thickness(0, CloseInset, CloseInset, 0),
    };

    private readonly FontIcon _closeGlyph = new()
    {
        Glyph = TourOverlayRegistration.CloseGlyph,
        FontSize = CloseGlyphSize,
    };

    private readonly StackPanel _dots = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = DotsSpacing,
        HorizontalAlignment = HorizontalAlignment.Center,
        Margin = new Thickness(0, DotsTopSpacing, 0, 0),
    };

    private Storyboard? _storyboard;
    private bool _ready;
    private bool _opened;
    private bool _wasActive;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe overlay with no composition root (the designer / parameterless host entry point): it
    /// binds an empty <see cref="StaticTourOverlaySource"/> over the passthrough localizer, so the surface starts
    /// inactive (no tour) exactly as the web overlay renders nothing until its parent starts a tour. Supply explicit
    /// seams via the other constructors to drive i18n and the tour state from the composition root.
    /// </summary>
    public TourOverlay()
        : this(PassthroughLocalizer.Instance, new StaticTourOverlaySource(), diagnostics: null)
    {
    }

    /// <summary>Creates the overlay over the i18n facade and a bound content seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The content state-holder seam (the owner-held tour state).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TourOverlay(ILocalizer localizer, ITourOverlaySource source, TourOverlayDiagnostics? diagnostics = null)
        : this(new TourOverlayViewModel(localizer, source), diagnostics)
    {
    }

    /// <summary>Creates the overlay over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TourOverlay(TourOverlayViewModel viewModel, TourOverlayDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new TourOverlayDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _reduceMotion = MotionPreference.ReduceMotion;

        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        IsTabStop = false;

        BuildTree();

        AutomationProperties.SetAutomationId(this, TourOverlayRegistration.OverlayAutomationId);
        AutomationProperties.SetAutomationId(_tooltip, TourOverlayRegistration.DialogAutomationId);
        AutomationProperties.SetAutomationId(_close, TourOverlayRegistration.CloseAutomationId);
        AutomationProperties.SetAutomationId(_skip, TourOverlayRegistration.SkipAutomationId);
        AutomationProperties.SetAutomationId(_back, TourOverlayRegistration.BackAutomationId);
        AutomationProperties.SetAutomationId(_next, TourOverlayRegistration.NextAutomationId);

        // web: the tour appears proactively — announce it politely so Narrator surfaces it without moving focus.
        LiveRegion.Configure(this);

        _scrim.Tapped += OnScrimTapped;
        _close.Click += OnSkipClick;
        _skip.Click += OnSkipClick;
        _back.Click += OnBackClick;
        _next.Click += OnNextClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _canvas.SizeChanged += OnCanvasSizeChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _canvas;
        Render();

        // Start in the correct visibility: the web renders nothing until a tour is active (`if (!targetRect)
        // return null`), so the overlay is collapsed until the source supplies a measured snapshot. Without this the
        // control would default to Visible and render an empty tooltip at the canvas origin before any tour starts.
        ApplyVisualState();
    }

    /// <summary>The canonical surface slug (<c>TourOverlay</c>).</summary>
    public static string Slug => TourOverlayRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TourOverlayViewModel ViewModel => _viewModel;

    /// <summary>The dialog accessible name the automation peer reports (the web <c>tour.dialogLabel</c>).</summary>
    internal string DialogLabel => _viewModel.Projection.DialogLabel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _storyboard?.Stop();
        _storyboard = null;
        _scrim.Tapped -= OnScrimTapped;
        _close.Click -= OnSkipClick;
        _skip.Click -= OnSkipClick;
        _back.Click -= OnBackClick;
        _next.Click -= OnNextClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _canvas.SizeChanged -= OnCanvasSizeChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TourOverlayAutomationPeer(this);

    private void BuildTree()
    {
        _close.Content = _closeGlyph;

        _skip.Content = _skipText;

        _backContent.Children.Add(_backGlyph);
        _backContent.Children.Add(_backText);
        _back.Content = _backContent;

        _nextContent.Children.Add(_nextText);
        _nextContent.Children.Add(_nextGlyph);
        _next.Content = _nextContent;

        _navRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _navRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_skip, 0);
        Grid.SetColumn(_navButtons, 1);
        _navButtons.Children.Add(_back);
        _navButtons.Children.Add(_next);
        _navRow.Children.Add(_skip);
        _navRow.Children.Add(_navButtons);

        _body.Children.Add(_counter);
        _body.Children.Add(_title);
        _body.Children.Add(_description);
        _body.Children.Add(_navRow);
        _body.Children.Add(_dots);
        _body.Margin = new Thickness(CardPadding);

        _tooltipGrid.Children.Add(_body);
        _tooltipGrid.Children.Add(_close);
        _tooltip.Child = _tooltipGrid;
        _tooltip.RenderTransform = _tooltipSlide;

        // The close glyph is decorative; the button's localized name is authoritative for Narrator.
        AutomationProperties.SetAccessibilityView(_closeGlyph, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_backGlyph, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_nextGlyph, AccessibilityView.Raw);

        _canvas.Children.Add(_scrim);
        _canvas.Children.Add(_glow);
        _canvas.Children.Add(_spotlight);
        _canvas.Children.Add(_tooltip);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        SyncViewport();

        // Snap to the correct state once layout is valid, then animate subsequent reveals.
        _ready = false;
        Render();
        _ready = true;
        ApplyVisualState();

        if (_viewModel.Projection.IsActive)
        {
            LiveRegion.Announce(this);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnCanvasSizeChanged(object sender, SizeChangedEventArgs e) => SyncViewport();

    private void OnScrimTapped(object sender, TappedRoutedEventArgs e) => _viewModel.Skip();

    private void OnSkipClick(object sender, RoutedEventArgs e) => _viewModel.Skip();

    private void OnBackClick(object sender, RoutedEventArgs e) => _viewModel.Prev();

    private void OnNextClick(object sender, RoutedEventArgs e) => _viewModel.Next();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() =>
        {
            Render();
            ApplyVisualState();
        });

    private void SyncViewport()
    {
        if (_canvas.ActualWidth > 0 && _canvas.ActualHeight > 0)
        {
            _viewModel.SetViewport(new TourViewport(_canvas.ActualWidth, _canvas.ActualHeight));
        }
    }

    private void Render()
    {
        TourOverlayProjection projection = _viewModel.Projection;

        AutomationProperties.SetName(this, projection.DialogLabel);
        AutomationProperties.SetName(_tooltip, projection.DialogLabel);
        AutomationProperties.SetName(_close, projection.CloseLabel);
        AutomationProperties.SetName(_skip, projection.SkipLabel);
        AutomationProperties.SetName(_back, projection.BackLabel);
        AutomationProperties.SetName(_next, projection.NextLabel);
        ToolTipService.SetToolTip(_close, projection.CloseLabel);

        if (!projection.IsActive)
        {
            return;
        }

        _scrim.Fill = OverlayBrush();
        _spotlight.BorderBrush = AccentBrush(TourOverlayRegistration.SpotlightBorderOpacity);
        _glow.Background = AccentBrush(TourOverlayRegistration.SpotlightGlowOpacity);
        _glow.CornerRadius = new CornerRadius(TourOverlayRegistration.SpotlightCornerRadius + GlowInset);

        _tooltip.Background = DisplayTokens.Surface;
        _tooltip.BorderBrush = DisplayTokens.Border;

        _counter.Foreground = DisplayTokens.TextMuted;
        _counter.Text = projection.StepCounterText;

        _title.Foreground = DisplayTokens.TextPrimary;
        _title.Text = projection.Title;

        _description.Foreground = DisplayTokens.TextSecondary;
        _description.Text = projection.Description;

        _closeGlyph.Foreground = DisplayTokens.TextMuted;

        _skipText.Foreground = DisplayTokens.TextMuted;
        _skipText.Text = projection.SkipLabel;

        _backText.Text = projection.BackLabel;
        _back.Visibility = projection.ShowBack ? Visibility.Visible : Visibility.Collapsed;

        _nextText.Text = projection.NextLabel;
        _nextGlyph.Visibility = projection.ShowNextArrow ? Visibility.Visible : Visibility.Collapsed;

        BuildDots(projection.ProgressDots);
        PositionGeometry(projection);
    }

    private void PositionGeometry(TourOverlayProjection projection)
    {
        TourViewport viewport = _viewModel.Viewport;
        if (viewport.Width <= 0 || viewport.Height <= 0)
        {
            return;
        }

        SpotlightRect spot = projection.Spotlight;

        _scrim.Data = CutoutGeometry(viewport, spot);

        Canvas.SetLeft(_spotlight, spot.Left);
        Canvas.SetTop(_spotlight, spot.Top);
        _spotlight.Width = Math.Max(0, spot.Width);
        _spotlight.Height = Math.Max(0, spot.Height);

        Canvas.SetLeft(_glow, spot.Left - GlowInset);
        Canvas.SetTop(_glow, spot.Top - GlowInset);
        _glow.Width = Math.Max(0, spot.Width + (GlowInset * 2));
        _glow.Height = Math.Max(0, spot.Height + (GlowInset * 2));

        _tooltip.MaxWidth = projection.Tooltip.MaxWidth;
        _tooltip.Measure(new Size(projection.Tooltip.MaxWidth, double.PositiveInfinity));
        Size desired = _tooltip.DesiredSize;

        Canvas.SetLeft(_tooltip, projection.Tooltip.ResolveLeft(desired.Width, viewport));
        Canvas.SetTop(_tooltip, projection.Tooltip.ResolveTop(desired.Height, viewport));
    }

    private void BuildDots(IReadOnlyList<TourProgressDot> dots)
    {
        _dots.Children.Clear();

        Brush active = DisplayTokens.Accent;
        Brush inactive = DisplayTokens.Border;

        foreach (TourProgressDot dot in dots)
        {
            _dots.Children.Add(new Border
            {
                Height = TourOverlayRegistration.DotHeight,
                Width = dot.IsActive ? TourOverlayRegistration.DotActiveWidth : TourOverlayRegistration.DotInactiveWidth,
                CornerRadius = new CornerRadius(DotCornerRadius),
                Background = dot.IsActive ? active : inactive,
            });
        }
    }

    private void ApplyVisualState()
    {
        bool active = _viewModel.Projection.IsActive;

        if (!active)
        {
            StopStoryboard();
            Visibility = Visibility.Collapsed;
            _wasActive = false;
            return;
        }

        Visibility = Visibility.Visible;

        bool justOpened = !_wasActive;
        _wasActive = true;

        if (!_ready || _reduceMotion || !justOpened)
        {
            StopStoryboard();
            _tooltip.Opacity = 1;
            _tooltipSlide.Y = 0;
            return;
        }

        AnimateIn();
    }

    private void AnimateIn()
    {
        StopStoryboard();

        var duration = new Duration(TimeSpan.FromMilliseconds(TransitionMs));
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        var storyboard = new Storyboard();

        var fade = new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = duration,
            EasingFunction = ease,
        };
        Storyboard.SetTarget(fade, _tooltip);
        Storyboard.SetTargetProperty(fade, "Opacity");
        storyboard.Children.Add(fade);

        var slide = new DoubleAnimation
        {
            From = TourOverlayRegistration.TooltipSlideOffset,
            To = 0,
            Duration = duration,
            EnableDependentAnimation = true,
            EasingFunction = ease,
        };
        Storyboard.SetTarget(slide, _tooltipSlide);
        Storyboard.SetTargetProperty(slide, "Y");
        storyboard.Children.Add(slide);

        _storyboard = storyboard;
        storyboard.Begin();
    }

    private void StopStoryboard()
    {
        _storyboard?.Stop();
        _storyboard = null;
    }

    private static GeometryGroup CutoutGeometry(TourViewport viewport, SpotlightRect spot)
    {
        // Even-odd fill of the full viewport minus the spotlight rectangle — the native form of the web clip-path
        // polygon: the ring is filled (and hit-testable, so a click skips), the hole is transparent and clicks fall
        // through to the highlighted element beneath.
        var outer = new RectangleGeometry { Rect = new Rect(0, 0, viewport.Width, viewport.Height) };
        var inner = new RectangleGeometry
        {
            Rect = new Rect(
                Math.Max(0, spot.Left),
                Math.Max(0, spot.Top),
                Math.Max(0, spot.Width),
                Math.Max(0, spot.Height)),
        };

        var group = new GeometryGroup { FillRule = FillRule.EvenOdd };
        group.Children.Add(outer);
        group.Children.Add(inner);
        return group;
    }

    private static SolidColorBrush OverlayBrush()
    {
        if (DisplayTokens.Brush("TsSurfaceOverlayBrush") is SolidColorBrush brush && brush.Color.A != 0)
        {
            return brush;
        }

        // Token resolution miss (no XAML host / absent resource): fall back to a 70% black scrim so the dim still
        // reads, mirroring the modal scrim fallback.
        return new SolidColorBrush(Color.FromArgb(0xB3, 0x00, 0x00, 0x00));
    }

    private static SolidColorBrush AccentBrush(double opacity) =>
        new(AccentColor()) { Opacity = opacity };

    private static Color AccentColor()
    {
        if (DisplayTokens.Accent is SolidColorBrush brush && brush.Color.A != 0)
        {
            return brush.Color;
        }

        // Token resolution miss: fall back to the web --theme-primary cyan so the spotlight ring still reads.
        return Color.FromArgb(0xFF, 0x00, 0xF0, 0xFF);
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

    private sealed class TourOverlayAutomationPeer : FrameworkElementAutomationPeer
    {
        public TourOverlayAutomationPeer(TourOverlay owner)
            : base(owner)
        {
        }

        private TourOverlay Surface => (TourOverlay)Owner;

        // The overlay is a named, non-modal guided-tour region; the dialog label is the authoritative Narrator name.
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Pane;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.DialogLabel : name;
        }
    }
}
