using System.Numerics;
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
using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>GotoIndicator</c> shared surface — a parity port of
/// web/src/components/feedback/GotoIndicator.tsx. It is the transient "go to" keyboard-chord hint: while the
/// shortcut leader is armed it floats a bottom-centre Fluent overlay reading the localized lead-in label
/// ("Go to...") followed by two monospace key-caps — <c>g</c> then <c>?</c> — joined by a muted <c>+</c>, and
/// while the leader is disarmed it collapses to nothing (the web <c>if (!visible) return null</c>). It composes
/// the overlay from native primitives tinted entirely through the generated design-token brushes (the
/// translucent surface-overlay background, the hairline border, the muted lead-in / separator text and the
/// surface-2 key-cap chips with secondary-coloured glyphs), binds the <see cref="GotoIndicatorViewModel"/> (over
/// the <see cref="ILocalizer"/> i18n facade) and shows or hides itself from the holder's <see cref="GotoIndicatorViewModel.Visibility"/>.
/// Because the web source reads no data — its only hook is <c>useTranslation</c> and its only input is the
/// <c>visible</c> prop owned by the parent — there is no loading / empty / error / stale / offline chrome; the
/// surface's states are exactly the web ones, hidden and shown. The entrance reproduces the web
/// <c>fade-in slide-in-from-bottom-4</c> (a fade plus a short upward slide) and is gated by the system
/// reduce-motion preference, collapsing to an instant reveal when the user has minimised animations. The
/// key-caps and lead-in text are decorative; the surface carries the composed hint as its Narrator name, exposes
/// the <c>goto-indicator</c> automation id, and announces politely when it appears (a live region). It emits the
/// <c>view.opened</c> diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class GotoIndicator : ContentControl, IDisposable
{
    private const double OverlayCornerRadius = 12;    // web rounded-xl
    private const double OverlayBorderThickness = 1;  // web border
    private const double OverlayPaddingH = 16;        // web px-4
    private const double OverlayPaddingV = 8;         // web py-2
    private const double BottomInset = 80;            // web bottom-20 (5rem)
    private const double LabelFontSize = 14;          // web text-sm
    private const double KeyCapFontSize = 12;         // web text-xs
    private const double KeyCapCornerRadius = 4;      // web rounded
    private const double KeyCapPaddingH = 6;          // web px-1.5
    private const double KeyCapPaddingV = 2;          // web py-0.5
    private const double LabelTrailingGap = 8;        // web mr-2
    private const double SeparatorGap = 4;            // web mx-1
    private const double SlideFromOffset = 16;        // web slide-in-from-bottom-4 (1rem)
    private const double ShadowDepth = 32;            // Fluent elevation for the web shadow-2xl
    private const int OverlayZIndex = 9999;           // web z-[9999]

    private readonly GotoIndicatorViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _row = new()
    {
        Orientation = Orientation.Horizontal,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _label = new();
    private readonly TextBlock _separator = new();
    private readonly Border _overlay = new();
    private readonly TranslateTransform _slide = new();

    private Storyboard? _entrance;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no composition root (the designer / parameterless host entry point): it binds a
    /// passthrough localizer and starts hidden. Supply an explicit <see cref="ILocalizer"/> (and the parent's
    /// armed state) via the other constructors to drive i18n and visibility from the composition root.
    /// </summary>
    public GotoIndicator()
        : this(new GotoIndicatorViewModel(PassthroughLocalizer.Instance))
    {
    }

    /// <summary>Creates the surface over the i18n facade and an initial armed state (the production entry point).</summary>
    /// <param name="localizer">The i18n facade the label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="visible">The initial armed state (web <c>visible</c> prop); defaults to hidden.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public GotoIndicator(
        ILocalizer localizer,
        bool visible = false,
        GotoIndicatorDiagnostics? diagnostics = null)
        : this(new GotoIndicatorViewModel(localizer, visible, diagnostics))
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts).</summary>
    /// <param name="viewModel">The backing state holder.</param>
    public GotoIndicator(GotoIndicatorViewModel viewModel)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // The hint floats bottom-centre over the shell and never captures input (a transient, non-interactive
        // affordance), mirroring the web fixed bottom-20 left-1/2 overlay.
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Bottom;
        Margin = new Thickness(0, 0, 0, BottomInset);
        IsTabStop = false;
        IsHitTestVisible = false;
        Canvas.SetZIndex(this, OverlayZIndex);

        BuildChrome();
        Content = _overlay;

        AutomationProperties.SetName(this, _viewModel.AccessibleName);
        AutomationProperties.SetAutomationId(this, GotoIndicatorRegistration.RootAutomationId);

        // Announce politely when the hint appears so Narrator surfaces the chord without moving focus.
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        InitializeRestingPose();
    }

    /// <summary>The canonical surface slug (<c>GotoIndicator</c>).</summary>
    public static string Slug => GotoIndicatorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public GotoIndicatorViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible name the automation peer reports.</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopEntrance();
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new GotoIndicatorAutomationPeer(this);

    private void BuildChrome()
    {
        _label.Text = _viewModel.Label;
        _label.FontSize = LabelFontSize;
        _label.Foreground = DisplayTokens.Brush(GotoIndicatorRegistration.LabelBrushKey);
        _label.VerticalAlignment = VerticalAlignment.Center;
        _label.Margin = new Thickness(0, 0, LabelTrailingGap, 0);
        AutomationProperties.SetAccessibilityView(_label, AccessibilityView.Raw);

        _separator.Text = GotoIndicatorRegistration.KeyChordSeparator;
        _separator.FontSize = LabelFontSize;
        _separator.Foreground = DisplayTokens.Brush(GotoIndicatorRegistration.LabelBrushKey);
        _separator.VerticalAlignment = VerticalAlignment.Center;
        _separator.Margin = new Thickness(SeparatorGap, 0, SeparatorGap, 0);
        AutomationProperties.SetAccessibilityView(_separator, AccessibilityView.Raw);

        _row.Children.Add(_label);
        _row.Children.Add(BuildKeyCap(GotoIndicatorRegistration.LeadingKeyCap));
        _row.Children.Add(_separator);
        _row.Children.Add(BuildKeyCap(GotoIndicatorRegistration.ChordKeyCap));

        _overlay.Background = DisplayTokens.Brush(GotoIndicatorRegistration.OverlayBrushKey);
        _overlay.BorderBrush = DisplayTokens.Brush(GotoIndicatorRegistration.BorderBrushKey);
        _overlay.BorderThickness = new Thickness(OverlayBorderThickness);
        _overlay.CornerRadius = new CornerRadius(OverlayCornerRadius);
        _overlay.Padding = new Thickness(OverlayPaddingH, OverlayPaddingV, OverlayPaddingH, OverlayPaddingV);
        _overlay.HorizontalAlignment = HorizontalAlignment.Center;
        _overlay.Child = _row;
        _overlay.RenderTransform = _slide;
        _overlay.RenderTransformOrigin = new Point(0.5, 0.5);

        // The web shadow-2xl elevation — a Fluent theme shadow cast from a small Z translation.
        _overlay.Shadow = new ThemeShadow();
        _overlay.Translation = new Vector3(0f, 0f, (float)ShadowDepth);
    }

    private static Border BuildKeyCap(string glyph)
    {
        var text = new TextBlock
        {
            Text = glyph,
            FontSize = KeyCapFontSize,
            FontFamily = MonoFontFamily(),
            Foreground = DisplayTokens.Brush(GotoIndicatorRegistration.KeyCapForegroundBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
            IsTextSelectionEnabled = false,
        };
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);

        var cap = new Border
        {
            Background = DisplayTokens.Brush(GotoIndicatorRegistration.KeyCapBackgroundBrushKey),
            CornerRadius = new CornerRadius(KeyCapCornerRadius),
            Padding = new Thickness(KeyCapPaddingH, KeyCapPaddingV, KeyCapPaddingH, KeyCapPaddingV),
            VerticalAlignment = VerticalAlignment.Center,
            Child = text,
        };
        AutomationProperties.SetAccessibilityView(cap, AccessibilityView.Raw);
        return cap;
    }

    private static FontFamily MonoFontFamily()
    {
        if (Application.Current?.Resources is { } resources &&
            resources.TryGetValue("TsTypeFontFamilyMono", out object? value) &&
            value is FontFamily family)
        {
            return family;
        }

        // The token resource is absent only in a headless / designer host; a standard Windows monospace keeps
        // the key-cap glyphs fixed-width (the web font-mono).
        return new FontFamily("Consolas");
    }

    private void InitializeRestingPose()
    {
        bool shown = _viewModel.Visibility == GotoIndicatorVisibility.Shown;
        Visibility = shown ? Visibility.Visible : Visibility.Collapsed;

        if (shown && MotionDuration.ShouldAnimate(MotionPreference.ReduceMotion))
        {
            // Start from the pre-entrance pose so OnLoaded animates in without a first-frame flash.
            _overlay.Opacity = 0;
            _slide.Y = SlideFromOffset;
        }
        else
        {
            _overlay.Opacity = 1;
            _slide.Y = 0;
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _viewModel.MarkOpened();
        }

        ApplyVisibility(animate: true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(GotoIndicatorViewModel.Visibility))
        {
            Marshal(() => ApplyVisibility(animate: true));
        }
    }

    private void ApplyVisibility(bool animate)
    {
        bool shown = _viewModel.Visibility == GotoIndicatorVisibility.Shown;
        Visibility = shown ? Visibility.Visible : Visibility.Collapsed;

        if (shown && animate && IsLoaded && MotionDuration.ShouldAnimate(MotionPreference.ReduceMotion))
        {
            PlayEntrance();
        }
        else
        {
            StopEntrance();
            RestingPose();
        }
    }

    private void RestingPose()
    {
        _overlay.Opacity = 1;
        _slide.Y = 0;
    }

    private void PlayEntrance()
    {
        StopEntrance();

        _overlay.Opacity = 0;
        _slide.Y = SlideFromOffset;

        var duration = new Duration(TimeSpan.FromMilliseconds(MotionDuration.Resolve(reduce: false)));
        var easing = new CubicEase { EasingMode = EasingMode.EaseOut };

        var fade = new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = duration,
            EasingFunction = easing,
        };
        Storyboard.SetTarget(fade, _overlay);
        Storyboard.SetTargetProperty(fade, "Opacity");

        var slide = new DoubleAnimation
        {
            From = SlideFromOffset,
            To = 0,
            Duration = duration,
            EnableDependentAnimation = true,
            EasingFunction = easing,
        };
        Storyboard.SetTarget(slide, _slide);
        Storyboard.SetTargetProperty(slide, "Y");

        _entrance = new Storyboard();
        _entrance.Children.Add(fade);
        _entrance.Children.Add(slide);
        _entrance.Begin();
    }

    private void StopEntrance()
    {
        _entrance?.Stop();
        _entrance = null;
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

    private sealed class GotoIndicatorAutomationPeer : FrameworkElementAutomationPeer
    {
        public GotoIndicatorAutomationPeer(GotoIndicator owner)
            : base(owner)
        {
        }

        private GotoIndicator Surface => (GotoIndicator)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
