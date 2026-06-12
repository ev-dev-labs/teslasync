using System.Collections.Generic;
using System.ComponentModel;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;
using Windows.Foundation;
using Windows.System;
using Windows.UI;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>VehiclePaintPicker</c> shared surface — a parity port of the web
/// <c>VehiclePaintPicker</c> (web/src/components/vehicles/VehiclePaintPicker.tsx). It is the swatch row that lets
/// the user override the Digital Twin paint color for a specific vehicle: a leading "Paint" caption, a
/// mutually-exclusive group of five color swatches (one per <see cref="PaintPalettes.All"/> entry), a polite
/// live-region label echoing the active paint, and a "Reset to auto-detected" affordance shown only while the
/// user has overridden the auto-detected color. Picking a swatch flows through the shared
/// <see cref="VehiclePaintPickerViewModel"/> to the per-vehicle <see cref="IVehiclePaintStore"/> (the web
/// browser-local override); the view performs no I/O.
///
/// <para>
/// State coverage: the web source is presentational — it consumes only <c>useTranslation</c> and the local
/// <c>useVehiclePaint</c> store (no HTTP / query lifecycle), so — like the shipped <c>Checkbox</c> and
/// <c>DatePresetChips</c> surfaces — it has no loading / error / stale / offline chrome to reproduce, and
/// inventing those states would be drift. The honest branches it actually has are reproduced in full: the
/// auto-detected (not-overridden) state where the inferred swatch is selected, carries the "· Auto-detected"
/// tooltip and no reset button is shown; the overridden state where the chosen swatch is selected and the reset
/// affordance appears; and the per-swatch selected (check mark + checked) vs unselected visuals. The palette list
/// is a fixed five-entry constant so there is no empty state. Every string resolves through the i18n facade
/// (P1/S10); the group carries the radio-group Narrator name (web <c>role="radiogroup"</c> + <c>aria-label</c>),
/// each swatch reports as a <see cref="AutomationControlType.RadioButton"/> with an
/// <see cref="ISelectionItemProvider"/> exposing the checked state (web <c>role="radio"</c> +
/// <c>aria-checked</c>) plus a Narrator name and tooltip, and the active-paint label is a polite live region
/// (web <c>aria-live="polite"</c>). The layout uses platform tokens (no ported web Tailwind) and adds no custom
/// motion, so the reduced-motion system preference is honored by construction and all text scales with the
/// system text-scaling setting.
/// </para>
/// </summary>
public sealed partial class VehiclePaintPicker : ContentControl, IDisposable
{
    private const string CheckGlyph = "\uE73E";   // Segoe Fluent "CheckMark" — the web check SVG on the active swatch.
    private const double SwatchSize = 28;          // web h-7 w-7 (1.75rem).
    private const double SwatchBorder = 2;         // web border-2.
    private const double CheckFontSize = 14;       // web h-3.5 w-3.5 check.
    private const double SwatchGap = 8;            // web inner swatch row gap-2.
    private const double OuterGap = 12;            // web outer row gap-3.
    private const int CaptionTracking = 50;        // web tracking-wider (~0.05em → 1/1000 em units).

    private readonly VehiclePaintPickerViewModel _viewModel;
    private readonly VehiclePaintPickerDiagnostics _diagnostics;

    // Fully qualified: Windows.System (imported for VirtualKey) also declares a DispatcherQueue.
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;

    private readonly WrapRow _root = new()
    {
        HorizontalSpacing = OuterGap,
        VerticalSpacing = SwatchGap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _caption = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        CharacterSpacing = CaptionTracking,
    };

    private readonly StackPanel _swatchRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = SwatchGap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _activeLabel = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _reset = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly List<PaintSwatch> _swatches = new();

    private string _pickerLabel = string.Empty;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over the passthrough localizer and an in-memory store — the native
    /// analogue of mounting the web component in an isolated gallery host. Production callers use the seam
    /// constructor.
    /// </summary>
    public VehiclePaintPicker()
        : this(PassthroughLocalizer.Instance, new InMemoryVehiclePaintStore(), diagnostics: null)
    {
    }

    /// <summary>Creates the surface over the i18n facade, the per-vehicle paint store and optional diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="store">The per-vehicle override store (web <c>useVehiclePaint</c> storage layer).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event (P1/S11).</param>
    public VehiclePaintPicker(
        ILocalizer localizer,
        IVehiclePaintStore store,
        VehiclePaintPickerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(store);

        _diagnostics = diagnostics ?? new VehiclePaintPickerDiagnostics();
        _viewModel = new VehiclePaintPickerViewModel(localizer, store);
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        _caption.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _caption.Foreground = DisplayTokens.TextSecondary;

        _activeLabel.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _activeLabel.Foreground = DisplayTokens.TextSecondary;
        AutomationProperties.SetLiveSetting(_activeLabel, AutomationLiveSetting.Polite);

        _reset.Click += OnResetClicked;

        foreach (PaintPalette palette in PaintPalettes.All)
        {
            var swatch = new PaintSwatch(palette.Id, palette.Swatch);
            swatch.Activated += OnSwatchActivated;
            _swatches.Add(swatch);
            _swatchRow.Children.Add(swatch);
        }

        _root.Children.Add(_caption);
        _root.Children.Add(_swatchRow);
        _root.Children.Add(_activeLabel);
        _root.Children.Add(_reset);
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>VehiclePaintPicker</c>).</summary>
    public static string Slug => VehiclePaintPickerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public VehiclePaintPickerViewModel ViewModel => _viewModel;

    /// <summary>The vehicle the picker targets (web <c>vehicleId</c> prop).</summary>
    public long VehicleId
    {
        get => _viewModel.VehicleId;
        set => _viewModel.VehicleId = value;
    }

    /// <summary>The Tesla <c>exterior_color</c> code driving the auto-detected paint (web <c>exteriorColor</c> prop).</summary>
    public string? ExteriorColor
    {
        get => _viewModel.ExteriorColor;
        set => _viewModel.ExteriorColor = value;
    }

    /// <summary>
    /// Re-resolve every label from the localizer and re-render — call after the active language changes so the
    /// swatch labels, caption and reset label update without reconstructing the surface (web react-i18next
    /// parity).
    /// </summary>
    public void Reload() => _viewModel.Reload();

    /// <summary>Detach from the state holder and lifecycle events (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _reset.Click -= OnResetClicked;
        foreach (PaintSwatch swatch in _swatches)
        {
            swatch.Activated -= OnSwatchActivated;
        }

        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new VehiclePaintPickerAutomationPeer(this);

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

    private void OnSwatchActivated(object? sender, PaintPaletteId id)
    {
        // web onClick={() => setPaint(p.id)} — always a user pick (the diagnostics counter), state may or may not move.
        _viewModel.SetPaint(id);
        _diagnostics.RecordPaintSelected();
    }

    private void OnResetClicked(object sender, RoutedEventArgs e)
    {
        // web onClick={reset} — clears the override back to the inferred paint.
        _viewModel.Reset();
        _diagnostics.RecordPaintSelected();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;

        // An external (cross-instance) store write can be raised from a background thread; render on the UI thread.
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
        _pickerLabel = _viewModel.PickerLabel;
        AutomationProperties.SetName(this, _pickerLabel);
        AutomationProperties.SetName(_swatchRow, _pickerLabel);

        _caption.Text = _viewModel.Caption;

        IReadOnlyList<PaintSwatchItem> swatches = _viewModel.Swatches;
        for (int i = 0; i < _swatches.Count && i < swatches.Count; i++)
        {
            _swatches[i].Update(swatches[i]);
        }

        _activeLabel.Text = _viewModel.ActivePaintLabel;

        bool overridden = _viewModel.IsOverridden;
        _reset.Visibility = overridden ? Visibility.Visible : Visibility.Collapsed;
        if (overridden)
        {
            _reset.Text = _viewModel.ResetLabel;
            AutomationProperties.SetName(_reset, _viewModel.ResetLabel);
        }
    }

    /// <summary>
    /// A single paint swatch — a focusable color dot that reports to UI Automation as a
    /// <see cref="AutomationControlType.RadioButton"/> exposing the checked state through an
    /// <see cref="ISelectionItemProvider"/>, the faithful native mapping of the web swatch
    /// (<c>&lt;button role="radio" aria-checked&gt;</c>, web/src/components/vehicles/VehiclePaintPicker.tsx
    /// L52-L91). It composes its own visual — a tokenized <see cref="Ellipse"/> dot tinted by the palette swatch,
    /// a selected border and an overlaid check-mark <see cref="FontIcon"/> — rather than retemplating a platform
    /// radio, so the surface stays tokenized. Space / Enter and a pointer tap raise <see cref="Activated"/>; the
    /// swatch color is fixed per palette while the label, tooltip and selected state update on render.
    /// </summary>
    private sealed partial class PaintSwatch : ContentControl
    {
        private readonly Ellipse _dot = new()
        {
            Width = SwatchSize,
            Height = SwatchSize,
            StrokeThickness = SwatchBorder,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        private readonly FontIcon _check = new()
        {
            Glyph = CheckGlyph,
            FontSize = CheckFontSize,
            Visibility = Visibility.Collapsed,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        private readonly SolidColorBrush _selectedBorder = new(Colors.White);
        private bool _selected;

        public PaintSwatch(PaintPaletteId id, string swatchHex)
        {
            Id = id;
            _dot.Fill = DisplayPrimitives.HexBrush(swatchHex);
            _dot.Stroke = DisplayTokens.Border;
            _check.Foreground = ContrastCheckBrush(swatchHex);

            var grid = new Grid();
            grid.Children.Add(_dot);
            grid.Children.Add(_check);
            Content = grid;

            IsTabStop = true;
            UseSystemFocusVisuals = true;
            CornerRadius = new CornerRadius(SwatchSize / 2);
            HorizontalContentAlignment = HorizontalAlignment.Center;
            VerticalContentAlignment = VerticalAlignment.Center;

            // The dot / check / grid carry no separate accessible nodes — the swatch's automation peer is the
            // single RadioButton node Narrator reads (name + selected state), exactly as the web check SVG is
            // aria-hidden and the button carries the semantics.
            AutomationProperties.SetAccessibilityView(grid, AccessibilityView.Raw);
            AutomationProperties.SetAccessibilityView(_dot, AccessibilityView.Raw);
            AutomationProperties.SetAccessibilityView(_check, AccessibilityView.Raw);

            Tapped += OnTapped;
            KeyDown += OnKeyDown;
        }

        /// <summary>Raised when the swatch is picked (pointer tap, Space or Enter), carrying its palette id.</summary>
        public event EventHandler<PaintPaletteId>? Activated;

        /// <summary>The palette this swatch selects (web <c>p.id</c>).</summary>
        public PaintPaletteId Id { get; }

        /// <summary>Whether this swatch is the active paint (web <c>aria-checked</c>).</summary>
        public bool IsSelected => _selected;

        /// <summary>Apply the projected swatch (label, tooltip and selected state); the dot color is fixed.</summary>
        /// <param name="item">The render-ready swatch projection.</param>
        public void Update(PaintSwatchItem item)
        {
            ArgumentNullException.ThrowIfNull(item);

            AutomationProperties.SetName(this, item.Label);
            ToolTipService.SetToolTip(this, item.Title);

            bool was = _selected;
            _selected = item.Selected;
            _dot.Stroke = _selected ? _selectedBorder : DisplayTokens.Border;
            _check.Visibility = _selected ? Visibility.Visible : Visibility.Collapsed;

            if (was != _selected && FrameworkElementAutomationPeer.FromElement(this) is PaintSwatchAutomationPeer peer)
            {
                peer.RaiseSelectionChanged(was, _selected);
            }
        }

        // Routes an assistive-technology SelectionItem.Select through the same path as a pointer tap.
        internal void InvokeFromAutomation() => Activated?.Invoke(this, Id);

        /// <inheritdoc />
        protected override AutomationPeer OnCreateAutomationPeer() => new PaintSwatchAutomationPeer(this);

        private static SolidColorBrush ContrastCheckBrush(string hex)
        {
            // The web check is white with a drop shadow so it reads on any swatch; native picks a contrasting
            // tone by swatch luminance instead — a dark check on light swatches (e.g. Pearl White), white otherwise.
            if (TryRelativeLuminance(hex, out double luminance) && luminance > 0.6)
            {
                return new SolidColorBrush(Color.FromArgb(255, 15, 23, 42));
            }

            return new SolidColorBrush(Colors.White);
        }

        private static bool TryRelativeLuminance(string hex, out double luminance)
        {
            luminance = 0;
            if (string.IsNullOrWhiteSpace(hex))
            {
                return false;
            }

            string s = hex.Trim().TrimStart('#');
            if (s.Length != 6 ||
                !byte.TryParse(s.AsSpan(0, 2), System.Globalization.NumberStyles.HexNumber, null, out byte r) ||
                !byte.TryParse(s.AsSpan(2, 2), System.Globalization.NumberStyles.HexNumber, null, out byte g) ||
                !byte.TryParse(s.AsSpan(4, 2), System.Globalization.NumberStyles.HexNumber, null, out byte b))
            {
                return false;
            }

            luminance = ((0.299 * r) + (0.587 * g) + (0.114 * b)) / 255.0;
            return true;
        }

        private void OnTapped(object sender, TappedRoutedEventArgs e)
        {
            e.Handled = true;
            Activated?.Invoke(this, Id);
        }

        private void OnKeyDown(object sender, KeyRoutedEventArgs e)
        {
            // Native (and web <button>) activation keys: Space and Enter pick the swatch.
            if (e.Key is VirtualKey.Space or VirtualKey.Enter)
            {
                e.Handled = true;
                Activated?.Invoke(this, Id);
            }
        }

        /// <summary>
        /// Reports the swatch as a native <see cref="AutomationControlType.RadioButton"/> with an
        /// <see cref="ISelectionItemProvider"/> exposing the checked state — the faithful UIA mapping of the web
        /// <c>&lt;button role="radio" aria-checked&gt;</c>, so Narrator announces "&lt;label&gt;, radio button,
        /// selected / not selected" and assistive tech can select it.
        /// </summary>
        private sealed partial class PaintSwatchAutomationPeer : FrameworkElementAutomationPeer, ISelectionItemProvider
        {
            public PaintSwatchAutomationPeer(PaintSwatch owner)
                : base(owner)
            {
            }

            public bool IsSelected => Swatch.IsSelected;

            // A single, page-owned selection container is not modelled as a UIA Selection provider; returning null
            // is valid and Narrator still announces the per-item selected state.
            public IRawElementProviderSimple? SelectionContainer => null;

            private PaintSwatch Swatch => (PaintSwatch)Owner;

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

            public void AddToSelection() => Swatch.InvokeFromAutomation();

            // A radio cannot be individually de-selected (selecting another swatch deselects it), so this is inert.
            public void RemoveFromSelection()
            {
            }

            public void Select() => Swatch.InvokeFromAutomation();

            protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.RadioButton;

            protected override string GetClassNameCore() => nameof(PaintSwatch);

            protected override object? GetPatternCore(PatternInterface patternInterface) =>
                patternInterface == PatternInterface.SelectionItem ? this : base.GetPatternCore(patternInterface);
        }
    }

    /// <summary>
    /// A minimal flow panel that lays its children left to right, vertically centers them within each row and
    /// wraps to a new row when the next child would overflow the available width — the native equivalent of the
    /// web outer row's <c>flex flex-wrap items-center gap-3</c>. Base WinUI ships no wrap panel, so the surface
    /// carries its own (the same pattern the chip-cluster surfaces use). Collapsed children (the hidden reset
    /// button) are skipped so they leave no phantom gap.
    /// </summary>
    private sealed partial class WrapRow : Panel
    {
        /// <summary>Horizontal gap between items on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (UIElement child in Children)
            {
                if (child.Visibility == Visibility.Collapsed)
                {
                    continue;
                }

                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                Size desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            int index = 0;
            double y = 0;
            List<UIElement> visible = VisibleChildren();

            while (index < visible.Count)
            {
                int count = RowExtent(visible, index, finalSize.Width, out double rowHeight);
                double x = 0;
                for (int i = index; i < index + count; i++)
                {
                    UIElement child = visible[i];
                    Size desired = child.DesiredSize;
                    if (i > index)
                    {
                        x += HorizontalSpacing;
                    }

                    double offsetY = y + Math.Max(0, (rowHeight - desired.Height) / 2);
                    child.Arrange(new Rect(x, offsetY, desired.Width, desired.Height));
                    x += desired.Width;
                }

                y += rowHeight + VerticalSpacing;
                index += count;
            }

            return finalSize;
        }

        private List<UIElement> VisibleChildren()
        {
            var visible = new List<UIElement>(Children.Count);
            foreach (UIElement child in Children)
            {
                if (child.Visibility != Visibility.Collapsed)
                {
                    visible.Add(child);
                }
            }

            return visible;
        }

        private int RowExtent(List<UIElement> visible, int start, double maxWidth, out double rowHeight)
        {
            double rowWidth = 0;
            rowHeight = 0;
            int count = 0;

            for (int i = start; i < visible.Count; i++)
            {
                Size desired = visible[i].DesiredSize;
                double next = rowWidth + (count > 0 ? HorizontalSpacing : 0) + desired.Width;
                if (count > 0 && next > maxWidth)
                {
                    break;
                }

                rowWidth = next;
                rowHeight = Math.Max(rowHeight, desired.Height);
                count++;
            }

            return Math.Max(count, 1);
        }
    }

    /// <summary>
    /// Reports the surface as a UIA group carrying the localized radio-group <c>aria-label</c> — the faithful
    /// mapping of the web container's <c>role="radiogroup"</c> so Narrator announces the group name and
    /// enumerates the swatch radios within.
    /// </summary>
    private sealed partial class VehiclePaintPickerAutomationPeer : FrameworkElementAutomationPeer
    {
        public VehiclePaintPickerAutomationPeer(VehiclePaintPicker owner)
            : base(owner)
        {
        }

        private VehiclePaintPicker Surface => (VehiclePaintPicker)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface._pickerLabel : name;
        }
    }
}
