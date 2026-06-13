using System.Collections.Generic;
using System.ComponentModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.UI;
using Windows.System;
using Windows.UI;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 PillFilterBar shared surface — a parity port of the web <c>PillFilterBar</c>
/// (<c>web/src/components/forms/PillFilterBar.tsx</c>). It is the accessible single-select filter row used for
/// trend metric switchers and list-page collections ("All / Anomalies / Notable / …"): a horizontally-scrollable
/// strip of pills (or flat tabs) where exactly one pill is active. It implements the WAI-ARIA Tabs pattern — the
/// strip reports as a <see cref="AutomationControlType.Tab"/> carrying the caller-supplied
/// <see cref="AriaLabel"/>, each pill reports as a <see cref="AutomationControlType.TabItem"/> with an
/// <see cref="ISelectionItemProvider"/> exposing its selected state, the active pill is the strip's single tab
/// stop (roving tabindex, web <c>tabIndex={selected ? 0 : -1}</c>) and Left / Right wrap around the enabled pills
/// while Home / End jump to the first / last (web <c>handleKeyDown</c>, skipping disabled pills). Picking a pill
/// flows through the shared <see cref="PillFilterBarViewModel"/> to the page-owned <see cref="OnChange"/> callback
/// (web <c>onChange</c>); the view performs no I/O and owns no panels.
///
/// <para>
/// State coverage: the web source is a controlled presentational tablist driven entirely by its injected
/// <c>items</c> — its only hook is React's <c>useId</c> (a tablist id generator, not a data source), so it has no
/// loading / error / stale / offline chrome to reproduce and inventing those states would be drift. The honest
/// branches it actually has are reproduced in full: the populated pills and tabs variants; the per-pill selected
/// vs unselected visuals (active fill + leading accent dot for pills, accent underline for tabs); each of the six
/// accents (cyan / green / amber / red / purple / blue); the optional leading icon and the optional muted count
/// suffix; the disabled (dimmed, non-interactive, navigation-skipped) pill; and the defensive empty branch where
/// an empty <c>items</c> array renders a friendly muted marker rather than a blank box. Every visible string is
/// caller-composed (the web source declares no <c>t()</c> calls — its lone assistive string is the
/// <c>ariaLabel</c> prop, supplied already-localized), the strip carries the tablist Narrator name, each pill
/// carries its label (+ count) as its accessible name, and the layout uses platform tokens (no ported web
/// Tailwind) and adds no custom motion, so the reduced-motion system preference is honored by construction and
/// all text scales with the system text-scaling setting.
/// </para>
/// </summary>
public sealed partial class PillFilterBar : ContentControl, IDisposable
{
    private readonly PillFilterBarViewModel _viewModel;
    private readonly PillFilterBarDiagnostics _diagnostics;
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;

    private readonly Border _outer = new();
    private readonly ScrollViewer _scroller = new();

    private readonly StackPanel _row = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = PillFilterBarRegistration.PillGap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _emptyMark = new()
    {
        Text = PillFilterBarRegistration.EmptyMarker,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly List<Pill> _pills = new();

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over a fresh state holder — the native analogue of mounting the web
    /// component with no items in an isolated gallery host. Production callers use the seam constructor.
    /// </summary>
    public PillFilterBar()
        : this(new PillFilterBarViewModel(), diagnostics: null)
    {
    }

    /// <summary>Creates the surface over a shared state holder and an optional PII-safe diagnostics collector.</summary>
    /// <param name="viewModel">The shared state holder backing the strip (P1/S8).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event (P1/S11).</param>
    public PillFilterBar(PillFilterBarViewModel viewModel, PillFilterBarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new PillFilterBarDiagnostics();
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;

        _emptyMark.FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12);
        _emptyMark.Foreground = TypographyTokens.Brush("TsColorTextMutedBrush");

        _scroller.VerticalScrollMode = ScrollMode.Disabled;
        _scroller.VerticalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _scroller.HorizontalContentAlignment = HorizontalAlignment.Left;
        _scroller.Content = _row;

        _outer.Child = _scroller;
        Content = _outer;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>PillFilterBar</c>).</summary>
    public static string Slug => PillFilterBarRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public PillFilterBarViewModel ViewModel => _viewModel;

    /// <summary>The active pill key (web controlled <c>activeKey</c>); a programmatic set never fires <see cref="OnChange"/>.</summary>
    public string ActiveKey
    {
        get => _viewModel.ActiveKey;
        set => _viewModel.ActiveKey = value;
    }

    /// <summary>The tablist Narrator name (web <c>ariaLabel</c>); caller-supplied, already localized.</summary>
    public string AriaLabel
    {
        get => _viewModel.AriaLabel;
        set => _viewModel.AriaLabel = value;
    }

    /// <summary>The render style (web <c>variant</c>); defaults to <see cref="PillFilterBarVariant.Pills"/>.</summary>
    public PillFilterBarVariant Variant
    {
        get => _viewModel.Variant;
        set => _viewModel.Variant = value;
    }

    /// <summary>Whether the strip scrolls horizontally on overflow (web <c>scrollable</c>); defaults to true.</summary>
    public bool Scrollable
    {
        get => _viewModel.Scrollable;
        set => _viewModel.Scrollable = value;
    }

    /// <summary>The page-owned selection callback (web <c>onChange</c>); invoked by every user pick.</summary>
    public Action<string>? OnChange
    {
        get => _viewModel.OnChange;
        set => _viewModel.OnChange = value;
    }

    /// <summary>Replace the pills, re-rendering the strip (web <c>items</c> prop change).</summary>
    /// <param name="items">The pills, in render order.</param>
    public void SetItems(IReadOnlyList<PillItemDescriptor> items) => _viewModel.SetItems(items);

    /// <summary>Detach from the state holder and lifecycle events (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        ClearPills();
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PillFilterBarAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        string label = _viewModel.AriaLabel;
        AutomationProperties.SetName(this, label);
        AutomationProperties.SetName(_row, label);
        AutomationProperties.SetName(_scroller, label);

        bool scrollable = _viewModel.Scrollable;
        _scroller.HorizontalScrollMode = scrollable ? ScrollMode.Auto : ScrollMode.Disabled;
        _scroller.HorizontalScrollBarVisibility = scrollable ? ScrollBarVisibility.Auto : ScrollBarVisibility.Disabled;

        bool tabs = _viewModel.Variant == PillFilterBarVariant.Tabs;
        _outer.BorderBrush = TypographyTokens.Brush("TsColorBorderBrush");
        _outer.BorderThickness = new Thickness(0, 0, 0, tabs ? 1 : 0);

        if (_viewModel.IsEmpty)
        {
            ClearPills();
            _row.Children.Clear();
            _row.Children.Add(_emptyMark);
            return;
        }

        SyncPills(_viewModel.Items);

        string activeKey = _viewModel.ActiveKey;
        bool selectionPresent = _viewModel.HasSelection;
        string? firstEnabled = _viewModel.FirstEnabledKey;

        for (int i = 0; i < _pills.Count; i++)
        {
            Pill pill = _pills[i];
            PillItemDescriptor item = _viewModel.Items[i];
            bool selected = string.Equals(item.Key, activeKey, StringComparison.Ordinal);

            // Roving tabindex (web tabIndex={selected ? 0 : -1}): the selected pill is the single tab stop. When
            // nothing is selected yet, the first enabled pill takes the stop so the strip stays keyboard-reachable.
            bool tabStop = selectionPresent
                ? selected
                : string.Equals(item.Key, firstEnabled, StringComparison.Ordinal);

            pill.Update(item, _viewModel.Variant, selected, tabStop);
        }
    }

    private void SyncPills(IReadOnlyList<PillItemDescriptor> items)
    {
        if (!KeySequenceMatches(items))
        {
            ClearPills();
            _row.Children.Clear();
            foreach (PillItemDescriptor item in items)
            {
                var pill = new Pill(item.Key);
                pill.Activated += OnPillActivated;
                pill.NavigationRequested += OnPillNavigationRequested;
                _pills.Add(pill);
                _row.Children.Add(pill);
            }
        }
    }

    private bool KeySequenceMatches(IReadOnlyList<PillItemDescriptor> items)
    {
        if (_pills.Count != items.Count)
        {
            return false;
        }

        for (int i = 0; i < _pills.Count; i++)
        {
            if (!string.Equals(_pills[i].Key, items[i].Key, StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    private void ClearPills()
    {
        foreach (Pill pill in _pills)
        {
            pill.Activated -= OnPillActivated;
            pill.NavigationRequested -= OnPillNavigationRequested;
        }

        _pills.Clear();
    }

    private void OnPillActivated(object? sender, string key)
    {
        // web onClick={() => onChange(item.key)} — always a user pick; the diagnostics counter advances only when
        // the active key actually moves.
        if (_viewModel.RequestSelect(key))
        {
            _diagnostics.RecordSelectionChanged();
        }
    }

    private void OnPillNavigationRequested(object? sender, PillNavigation navigation)
    {
        // web handleKeyDown: Arrow keys wrap around the enabled pills; Home / End jump to the first / last.
        string? target = navigation.Direction switch
        {
            PillNavDirection.Next => _viewModel.NextEnabledKey(navigation.FromKey),
            PillNavDirection.Previous => _viewModel.PreviousEnabledKey(navigation.FromKey),
            PillNavDirection.First => _viewModel.FirstEnabledKey,
            PillNavDirection.Last => _viewModel.LastEnabledKey,
            _ => null,
        };

        if (string.IsNullOrEmpty(target))
        {
            return;
        }

        // web moveFocus: onChange(next) then focus the next pill on the following frame. RequestSelect schedules a
        // render; enqueue the focus after it so the (possibly re-projected) pill is focused once laid out.
        if (_viewModel.RequestSelect(target))
        {
            _diagnostics.RecordSelectionChanged();
        }

        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(() => FocusPill(target));
        }
        else
        {
            FocusPill(target);
        }
    }

    private void FocusPill(string key)
    {
        foreach (Pill pill in _pills)
        {
            if (string.Equals(pill.Key, key, StringComparison.Ordinal))
            {
                _ = pill.Focus(FocusState.Programmatic);
                return;
            }
        }
    }

    private static Color ResolveAccentColor(string key)
    {
        if (Application.Current?.Resources is { } resources &&
            resources.TryGetValue(key, out object? value) &&
            value is SolidColorBrush brush)
        {
            return brush.Color;
        }

        // #06B6D4 — the cyan default, mirroring the web fallback "to match the rest of the app's neon palette".
        return Color.FromArgb(0xFF, 0x06, 0xB6, 0xD4);
    }

    private enum PillNavDirection
    {
        Previous,
        Next,
        First,
        Last,
    }

    private readonly struct PillNavigation
    {
        public PillNavigation(PillNavDirection direction, string fromKey)
        {
            Direction = direction;
            FromKey = fromKey;
        }

        public PillNavDirection Direction { get; }

        public string FromKey { get; }
    }

    /// <summary>
    /// A single pill — a focusable chip that reports to UI Automation as a
    /// <see cref="AutomationControlType.TabItem"/> exposing its selected state through an
    /// <see cref="ISelectionItemProvider"/>, the faithful native mapping of the web <c>&lt;button role="tab"
    /// aria-selected&gt;</c> (web/src/components/forms/PillFilterBar.tsx L156-L191). It composes its own
    /// tokenized visual — an optional leading accent dot, an optional icon, the label and an optional muted count —
    /// rather than retemplating a platform control, so the active fill / dot / ring (pills) and the accent
    /// underline (tabs) stay token-driven. Space / Enter and a pointer tap raise <see cref="Activated"/>; Left /
    /// Right / Home / End raise <see cref="NavigationRequested"/> so the strip moves selection + focus.
    /// </summary>
    private sealed partial class Pill : ContentControl
    {
        private readonly Ellipse _dot = new()
        {
            Width = PillFilterBarRegistration.DotDiameter,
            Height = PillFilterBarRegistration.DotDiameter,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };

        private readonly FontIcon _icon = new()
        {
            FontSize = PillFilterBarRegistration.IconSize,
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };

        private readonly TextBlock _label = new() { VerticalAlignment = VerticalAlignment.Center };

        private readonly TextBlock _count = new()
        {
            VerticalAlignment = VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };

        private readonly StackPanel _content = new()
        {
            Orientation = Orientation.Horizontal,
            Spacing = PillFilterBarRegistration.PillGap,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The visual chrome lives on this inner Border: the bare ContentControl template does not paint
        // Background / BorderBrush / CornerRadius, so the active fill / ring / underline are drawn here while the
        // ContentControl stays the focusable, automation host (the same split the shipped swatch surfaces use).
        private readonly Border _visual = new();

        private bool _selected;
        private bool _disabled;
        private bool _hovered;
        private PillFilterBarVariant _variant = PillFilterBarRegistration.DefaultVariant;
        private Brush _fillBrush = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        private Brush? _hoverBrush;

        public Pill(string key)
        {
            Key = key;

            _content.Children.Add(_dot);
            _content.Children.Add(_icon);
            _content.Children.Add(_label);
            _content.Children.Add(_count);
            _visual.Child = _content;
            Content = _visual;

            IsTabStop = false;
            UseSystemFocusVisuals = true;
            HorizontalContentAlignment = HorizontalAlignment.Stretch;
            VerticalContentAlignment = VerticalAlignment.Stretch;

            // The inner glyphs carry no separate accessible nodes — the pill's automation peer is the single
            // TabItem node Narrator reads (name + selected state), exactly as the web icon SVG is aria-hidden.
            AutomationProperties.SetAccessibilityView(_visual, AccessibilityView.Raw);
            AutomationProperties.SetAccessibilityView(_content, AccessibilityView.Raw);
            AutomationProperties.SetAccessibilityView(_dot, AccessibilityView.Raw);
            AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
            AutomationProperties.SetAccessibilityView(_count, AccessibilityView.Raw);

            Tapped += OnTapped;
            KeyDown += OnKeyDown;
            PointerEntered += OnPointerEntered;
            PointerExited += OnPointerExited;
            PointerCanceled += OnPointerExited;
            PointerCaptureLost += OnPointerExited;
        }

        /// <summary>Raised when the pill is picked (pointer tap, Space or Enter), carrying its key.</summary>
        public event EventHandler<string>? Activated;

        /// <summary>Raised when an arrow / Home / End key requests a focus move, carrying the direction and origin key.</summary>
        public event EventHandler<PillNavigation>? NavigationRequested;

        /// <summary>The key this pill selects (web <c>item.key</c>).</summary>
        public string Key { get; }

        /// <summary>Whether this pill is the active tab (web <c>aria-selected</c>).</summary>
        public bool IsSelected => _selected;

        /// <summary>Apply the projected pill state — visuals, accessible name, selected state and the roving tab stop.</summary>
        /// <param name="item">The pill descriptor (label, icon, count, accent, disabled).</param>
        /// <param name="variant">The strip render style.</param>
        /// <param name="selected">Whether this pill is the active tab.</param>
        /// <param name="tabStop">Whether this pill is the strip's single keyboard tab stop.</param>
        public void Update(PillItemDescriptor item, PillFilterBarVariant variant, bool selected, bool tabStop)
        {
            ArgumentNullException.ThrowIfNull(item);

            bool was = _selected;
            _selected = selected;
            _disabled = item.Disabled;
            _variant = variant;

            Color accent = ResolveAccentColor(item.AccentBrushKey);
            var accentSolid = new SolidColorBrush(accent);
            _fillBrush = new SolidColorBrush(accent) { Opacity = PillFilterBarRegistration.ActiveFillOpacity };
            var ringBrush = new SolidColorBrush(accent) { Opacity = PillFilterBarRegistration.ActiveRingOpacity };
            _hoverBrush = TypographyTokens.Brush("TsColorSurfaceGlassBrush");

            Brush textBrush = selected
                ? accentSolid
                : (TypographyTokens.Brush("TsColorTextMutedBrush") ?? accentSolid);

            bool pills = variant == PillFilterBarVariant.Pills;

            _label.Text = item.Label;
            _label.Foreground = textBrush;
            _label.FontSize = TypographyTokens.Size(pills ? "TsTypeCaptionFontSize" : "TsTypeBodyFontSize", pills ? 12 : 14);
            _label.FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeWeightMedium", 500));

            _dot.Fill = accentSolid;
            _dot.Visibility = pills && selected ? Visibility.Visible : Visibility.Collapsed;

            if (item.IconGlyph is { Length: > 0 } glyph)
            {
                _icon.Glyph = glyph;
                _icon.Foreground = textBrush;
                _icon.Visibility = Visibility.Visible;
            }
            else
            {
                _icon.Visibility = Visibility.Collapsed;
            }

            if (item.Count is int count)
            {
                _count.Text = PillFilterBarRegistration.FormatCount(count);
                _count.Foreground = textBrush;
                _count.FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 10);
                _count.Opacity = selected ? 0.8 : 0.6;
                _count.Visibility = Visibility.Visible;
            }
            else
            {
                _count.Visibility = Visibility.Collapsed;
            }

            if (pills)
            {
                var radius = new CornerRadius(PillFilterBarRegistration.PillCornerRadius);
                CornerRadius = radius;
                _visual.CornerRadius = radius;
                _visual.Padding = new Thickness(12, 4, 12, 4);
                _visual.BorderThickness = new Thickness(1);
                _visual.BorderBrush = selected ? ringBrush : new SolidColorBrush(Microsoft.UI.Colors.Transparent);
            }
            else
            {
                CornerRadius = new CornerRadius(0);
                _visual.CornerRadius = new CornerRadius(0);
                _visual.Padding = new Thickness(12, 8, 12, 8);
                _visual.BorderThickness = new Thickness(0, 0, 0, PillFilterBarRegistration.TabUnderlineThickness);
                _visual.BorderBrush = selected ? accentSolid : new SolidColorBrush(Microsoft.UI.Colors.Transparent);
            }

            Opacity = _disabled ? PillFilterBarRegistration.DisabledOpacity : 1;
            IsEnabled = !_disabled;
            IsTabStop = tabStop && !_disabled;
            AutomationProperties.SetName(this, item.AccessibleText);

            ApplyBackground();

            if (was != _selected && FrameworkElementAutomationPeer.FromElement(this) is PillAutomationPeer peer)
            {
                peer.RaiseSelectionChanged(was, _selected);
            }
        }

        // Routes an assistive-technology SelectionItem.Select through the same path as a pointer tap.
        internal void InvokeFromAutomation() => Activated?.Invoke(this, Key);

        /// <inheritdoc />
        protected override AutomationPeer OnCreateAutomationPeer() => new PillAutomationPeer(this);

        private void ApplyBackground()
        {
            bool pills = _variant == PillFilterBarVariant.Pills;
            if (pills && _selected)
            {
                _visual.Background = _fillBrush;
            }
            else if (pills && _hovered && !_disabled)
            {
                _visual.Background = _hoverBrush ?? new SolidColorBrush(Microsoft.UI.Colors.Transparent);
            }
            else
            {
                _visual.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
            }
        }

        private void OnTapped(object sender, TappedRoutedEventArgs e)
        {
            if (_disabled)
            {
                return;
            }

            e.Handled = true;
            Activated?.Invoke(this, Key);
        }

        private void OnKeyDown(object sender, KeyRoutedEventArgs e)
        {
            if (_disabled)
            {
                return;
            }

            switch (e.Key)
            {
                case VirtualKey.Space:
                case VirtualKey.Enter:
                    e.Handled = true;
                    Activated?.Invoke(this, Key);
                    break;
                case VirtualKey.Left:
                    e.Handled = true;
                    NavigationRequested?.Invoke(this, new PillNavigation(PillNavDirection.Previous, Key));
                    break;
                case VirtualKey.Right:
                    e.Handled = true;
                    NavigationRequested?.Invoke(this, new PillNavigation(PillNavDirection.Next, Key));
                    break;
                case VirtualKey.Home:
                    e.Handled = true;
                    NavigationRequested?.Invoke(this, new PillNavigation(PillNavDirection.First, Key));
                    break;
                case VirtualKey.End:
                    e.Handled = true;
                    NavigationRequested?.Invoke(this, new PillNavigation(PillNavDirection.Last, Key));
                    break;
                default:
                    break;
            }
        }

        private void OnPointerEntered(object sender, PointerRoutedEventArgs e)
        {
            _hovered = true;
            ApplyBackground();
        }

        private void OnPointerExited(object sender, PointerRoutedEventArgs e)
        {
            _hovered = false;
            ApplyBackground();
        }

        /// <summary>
        /// Reports the pill as a native <see cref="AutomationControlType.TabItem"/> with an
        /// <see cref="ISelectionItemProvider"/> exposing its selected state — the faithful UIA mapping of the web
        /// <c>&lt;button role="tab" aria-selected&gt;</c>, so Narrator announces "&lt;label&gt;, tab item,
        /// selected / not selected" and assistive tech can select it.
        /// </summary>
        private sealed partial class PillAutomationPeer : FrameworkElementAutomationPeer, ISelectionItemProvider
        {
            public PillAutomationPeer(Pill owner)
                : base(owner)
            {
            }

            public bool IsSelected => Pill.IsSelected;

            // A single, page-owned tablist is not modelled as a UIA Selection container; returning null is valid
            // and Narrator still announces the per-item selected state (matching the shipped VehiclePaintPicker).
            public IRawElementProviderSimple? SelectionContainer => null;

            private Pill Pill => (Pill)Owner;

            public void RaiseSelectionChanged(bool wasSelected, bool isSelected)
            {
                RaisePropertyChangedEvent(
                    SelectionItemPatternIdentifiers.IsSelectedProperty,
                    wasSelected,
                    isSelected);

                if (isSelected)
                {
                    RaiseAutomationEvent(AutomationEvents.SelectionItemPatternOnElementSelected);
                }
            }

            public void AddToSelection() => Pill.InvokeFromAutomation();

            // A tab cannot be individually de-selected (selecting another tab deselects it), so this is inert.
            public void RemoveFromSelection()
            {
            }

            public void Select() => Pill.InvokeFromAutomation();

            protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.TabItem;

            protected override string GetClassNameCore() => nameof(Pill);

            protected override object? GetPatternCore(PatternInterface patternInterface) =>
                patternInterface == PatternInterface.SelectionItem ? this : base.GetPatternCore(patternInterface);
        }
    }

    /// <summary>
    /// Reports the surface as a UIA <see cref="AutomationControlType.Tab"/> strip carrying the caller-supplied
    /// tablist <c>aria-label</c> — the faithful mapping of the web container's <c>role="tablist"</c> so Narrator
    /// announces the strip name and enumerates the pill tab-items within.
    /// </summary>
    private sealed partial class PillFilterBarAutomationPeer : FrameworkElementAutomationPeer
    {
        public PillFilterBarAutomationPeer(PillFilterBar owner)
            : base(owner)
        {
        }

        private PillFilterBar Surface => (PillFilterBar)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Tab;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface._viewModel.AriaLabel : name;
        }
    }
}
