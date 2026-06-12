using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using System.ComponentModel;
using TeslaSync.App.Components.DataDisplay;
using Windows.System;

namespace TeslaSync.App.SharedSurfaces.CheckboxSurface;

/// <summary>
/// The native WinUI 3 <c>Checkbox</c> shared surface — a parity port of the web <c>Checkbox</c> primitive
/// (<c>web/src/components/ui/Checkbox.tsx</c>), the shared accessible checkbox used by "select all" headers,
/// bulk-selection rows and settings toggles. Like the web source it composes its own indicator — a tokenized
/// rounded <see cref="Border"/> box hosting a check / mixed-dash <see cref="FontIcon"/> glyph, with an optional
/// inline label to its right — rather than retemplating the platform <see cref="CheckBox"/>, so the box, glyph
/// and accent tint all flow from the generated design tokens (P1/S9) and light / dark / high-contrast themes
/// follow automatically. It binds the <see cref="CheckboxViewModel"/> and reproduces every state the web
/// indicator renders: the empty box, the checked box (web <c>Check</c> icon), the mixed box (web <c>Minus</c>
/// icon, which overrides checked), the dimmed non-interactive disabled box, and the keyboard focus ring (the
/// system focus visual, the native analogue of the web <c>peer-focus-visible:ring</c>).
///
/// <para>
/// The surface carries first-class checkbox accessibility: its automation peer reports
/// <see cref="AutomationControlType.CheckBox"/> with the label as its accessible name and an
/// <see cref="IToggleProvider"/> exposing the three-state <see cref="ToggleState"/>, so Narrator announces
/// "&lt;label&gt;, checkbox, checked / unchecked / mixed" and assistive tech can toggle it. Space toggles (the
/// native and web checkbox key); a pointer tap toggles; both honor the disabled guard. The composed glyph /
/// box / label add no separate accessible nodes. The web component is presentational and prop-driven (its
/// consuming page owns any data fetching), so — like the shipped <c>ScoreBadge</c> and <c>Combobox</c>
/// surfaces — it has no loading / error / stale / offline chrome to reproduce. The view performs no I/O and
/// emits the <c>view.opened</c> diagnostic once when shown.
/// </para>
/// </summary>
public sealed partial class Checkbox : ContentControl, IDisposable
{
    private const string CheckGlyph = "\uE73E";  // Segoe Fluent "CheckMark" — the web Check icon.
    private const string MixedGlyph = "\uE738";  // Segoe Fluent "Remove" (minus) — the web Minus / mixed dash.
    private const double DisabledOpacity = 0.6;  // web `disabled && opacity-60` on the label wrapper.

    private readonly CheckboxViewModel _viewModel;
    private readonly CheckboxDiagnostics _diagnostics;
    // Fully qualified: Windows.System (imported for VirtualKey) also declares a DispatcherQueue.
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;
    private readonly SolidColorBrush _onAccent = new(Colors.White);

    private readonly StackPanel _layout = new()
    {
        Orientation = Orientation.Horizontal,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _box = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _glyph = new()
    {
        Visibility = Visibility.Collapsed,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _label = new() { VerticalAlignment = VerticalAlignment.Center };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over a default (unchecked, medium, unlabeled) state — the native
    /// analogue of mounting the web component in an isolated gallery host. Production callers use the
    /// seam constructor.
    /// </summary>
    public Checkbox()
        : this(new CheckboxViewModel())
    {
    }

    /// <summary>Creates the surface over its state holder and an optional PII-safe diagnostics collector.</summary>
    /// <param name="viewModel">The bound state holder (the web props); the surface's P1/S8 seam.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event (P1/S11).</param>
    public Checkbox(CheckboxViewModel viewModel, CheckboxDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new CheckboxDiagnostics();
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        _box.Child = _glyph;
        _layout.Children.Add(_box);
        _layout.Children.Add(_label);
        Content = _layout;

        IsTabStop = true;
        UseSystemFocusVisuals = true;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        // The composed glyph / box / label carry no separate accessible nodes — the surface's automation peer
        // is the single CheckBox node Narrator reads (name + toggle state), exactly as the web indicator is
        // aria-hidden and the input carries the semantics.
        AutomationProperties.SetAccessibilityView(_box, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_glyph, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_label, AccessibilityView.Raw);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        KeyDown += OnKeyDown;
        Tapped += OnTapped;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>Checkbox</c>).</summary>
    public static string Slug => CheckboxRegistration.Slug;

    /// <summary>The bound state holder (exposed for hosting / diagnostics / tests).</summary>
    public CheckboxViewModel ViewModel => _viewModel;

    /// <summary>Detach from the state holder and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        KeyDown -= OnKeyDown;
        Tapped -= OnTapped;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new CheckboxAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => Marshal(Render);

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        // Native (and web) checkbox semantics: Space toggles; Enter does not.
        if (e.Key == VirtualKey.Space)
        {
            e.Handled = true;
            ToggleFromUser();
        }
    }

    private void OnTapped(object sender, TappedRoutedEventArgs e)
    {
        e.Handled = true;
        ToggleFromUser();
    }

    // Routes an assistive-technology Toggle request through the same path as a click (the web input's onChange).
    internal void ToggleFromAutomation() => ToggleFromUser();

    // Maps the projected view-model state to the WinUI automation toggle enum.
    internal ToggleState ResolveToggleState() => _viewModel.ToggleState switch
    {
        CheckboxToggleState.Checked => ToggleState.On,
        CheckboxToggleState.Indeterminate => ToggleState.Indeterminate,
        _ => ToggleState.Off,
    };

    private void ToggleFromUser()
    {
        if (!IsEnabled || _viewModel.IsDisabled)
        {
            return;
        }

        ToggleState previous = ResolveToggleState();
        if (_viewModel.Toggle())
        {
            RaiseToggleStateChanged(previous, ResolveToggleState());
        }
    }

    private void RaiseToggleStateChanged(ToggleState previous, ToggleState current)
    {
        if (previous == current)
        {
            return;
        }

        if (FrameworkElementAutomationPeer.FromElement(this) is CheckboxAutomationPeer peer)
        {
            peer.RaisePropertyChangedEvent(TogglePatternIdentifiers.ToggleStateProperty, previous, current);
        }
    }

    private void Render()
    {
        CheckboxMetrics metrics = CheckboxMetricsTable.For(_viewModel.Size);

        _box.Width = metrics.BoxSize;
        _box.Height = metrics.BoxSize;
        _box.CornerRadius = new CornerRadius(metrics.CornerRadius);
        _box.BorderThickness = new Thickness(metrics.BorderThickness);

        _glyph.FontSize = metrics.GlyphSize;

        bool hasLabel = !string.IsNullOrEmpty(_viewModel.Label);
        _label.Text = _viewModel.Label ?? string.Empty;
        _label.FontSize = metrics.LabelFontSize;
        _label.Foreground = DisplayTokens.TextPrimary;
        _label.Margin = new Thickness(metrics.Gap, 0, 0, 0);
        _label.Visibility = hasLabel ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, _viewModel.State.AccessibleName);

        bool disabled = _viewModel.IsDisabled;
        IsEnabled = !disabled;
        _layout.Opacity = disabled ? DisabledOpacity : 1.0;

        switch (_viewModel.ToggleState)
        {
            case CheckboxToggleState.Checked:
                ApplyMarkedVisual(CheckGlyph);
                break;
            case CheckboxToggleState.Indeterminate:
                ApplyMarkedVisual(MixedGlyph);
                break;
            default:
                ApplyUncheckedVisual();
                break;
        }
    }

    // web `peer-checked` / `peer-indeterminate`: the accent-filled box with the glyph (a solid Fluent fill +
    // on-accent glyph, the Windows-idiomatic mapping of the web translucent cyan indicator).
    private void ApplyMarkedVisual(string glyph)
    {
        _box.Background = DisplayTokens.Accent;
        _box.BorderBrush = DisplayTokens.Accent;
        _glyph.Glyph = glyph;
        _glyph.Foreground = _onAccent;
        _glyph.Visibility = Visibility.Visible;
    }

    // web default indicator: the empty box — a hairline border over the subtle glass surface (web
    // `border-[var(--border-strong)] bg-white/[0.04]`).
    private void ApplyUncheckedVisual()
    {
        _box.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _box.BorderBrush = DisplayTokens.Border;
        _glyph.Visibility = Visibility.Collapsed;
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
    /// Reports the surface as a native <see cref="AutomationControlType.CheckBox"/> with an
    /// <see cref="IToggleProvider"/> exposing the three-state <see cref="ToggleState"/> — the faithful UIA
    /// mapping of the web <c>&lt;input type="checkbox"&gt;</c> (with its indeterminate state), so Narrator
    /// announces the toggle state and assistive tech can toggle the box.
    /// </summary>
    private sealed partial class CheckboxAutomationPeer : FrameworkElementAutomationPeer, IToggleProvider
    {
        public CheckboxAutomationPeer(Checkbox owner)
            : base(owner)
        {
        }

        public ToggleState ToggleState => ((Checkbox)Owner).ResolveToggleState();

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.CheckBox;

        protected override string GetClassNameCore() => nameof(Checkbox);

        protected override object? GetPatternCore(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.Toggle ? this : base.GetPatternCore(patternInterface);

        public void Toggle() => ((Checkbox)Owner).ToggleFromAutomation();
    }
}
