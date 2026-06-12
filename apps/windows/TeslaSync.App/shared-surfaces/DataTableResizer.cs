using Microsoft.UI.Dispatching;
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;
using VirtualKey = Windows.System.VirtualKey;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 column-resize handle — a parity port of the web <c>DataTableResizer</c>
/// (web/src/components/ui/DataTableResizer.tsx). The web component is a fully presentational drag handle on the
/// right edge of a resizable <c>&lt;th&gt;</c>: a thin grip that is invisible at rest, tints with the accent colour
/// on hover / focus / drag (web <c>tableTokens.resizer</c> + <c>dragging &amp;&amp; 'opacity-100 bg-cyan-400/60'</c>),
/// shows a column-resize cursor, and follows the WAI-ARIA "Window Splitter" pattern. This surface reproduces it with
/// a focusable <see cref="ContentControl"/> hosting a single accent <see cref="Border"/> grip, a
/// <see cref="InputSystemCursorShape.SizeWestEast"/> cursor, pointer capture for the duration of a drag (so the
/// pointer can leave the grip without losing the gesture), and full keyboard operability. All clamp / label / state
/// logic lives in the UI-thread-free <see cref="DataTableResizerViewModel"/> + <see cref="DataTableResizerMath"/>;
/// the view only lays out the grip and forwards pointer / keyboard / automation input.
///
/// <para>
/// State coverage: the web source is presentational and fully controlled (props <c>columnKey</c> / <c>width</c> /
/// <c>minWidth</c> / <c>maxWidth</c> / <c>label</c> + the <c>onResize</c> / <c>onResizeEnd</c> callbacks); it performs
/// no data fetch, so — like the peer presentational surfaces (Spinner / TimelineScrubber) — it has no loading /
/// error / stale / offline chrome to reproduce. Every interaction branch it does have is reproduced in full: the
/// rest (invisible) grip, the hover tint, the focus tint, the drag-and-grow tint, the pointer drag, and the
/// Left/Right/Home/End keyboard resize.
/// </para>
///
/// <para>
/// Accessibility: the control reproduces the WAI-ARIA Window Splitter — it reports
/// <see cref="AutomationControlType.Separator"/> with a vertical orientation and a RangeValue pattern
/// (<c>aria-valuenow</c>/<c>min</c>/<c>max</c> = the current width and its bounds), carries the localized accessible
/// name (web <c>aria-label</c>), is a tab stop with system focus visuals, and is keyboard-operable (arrows nudge,
/// Home resets, End maxes out) — the genuinely accessible splitter behaviour the web keyboard handler provides.
/// </para>
/// </summary>
public sealed partial class DataTableResizer : ContentControl, IDisposable
{
    private const double HandleHitWidth = 8;     // grabbable hit target around the grip (touch-friendly).
    private const double HandleVisualWidth = 6;  // the visible grip, web w-1.5.
    private const double MinHandleHeight = 24;    // keeps a standalone grip visible outside a table header.
    private const double HoverOpacity = 0.4;     // web hover:bg-cyan-400/40.
    private const double ActiveOpacity = 0.6;    // web focus-visible / dragging bg-cyan-400/60.

    private readonly DataTableResizerViewModel _viewModel;
    private readonly DataTableResizerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _grip = new()
    {
        Width = HandleVisualWidth,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Stretch,
        Opacity = 0,
        IsHitTestVisible = false,
    };

    private double _startX;
    private int _startWidth;
    private bool _hovering;
    private bool _focused;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe handle bound to the inert resize sink and the passthrough localizer — the native
    /// analogue of mounting the web component with a no-op <c>onResize</c> and no <c>onResizeEnd</c>. Useful for
    /// galleries / design hosts; production callers use the seam constructor.
    /// </summary>
    public DataTableResizer()
        : this("column", 160, NoOpColumnResizeSink.Instance, PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the handle over its web props, the resize seam, the localizer and optional diagnostics.</summary>
    /// <param name="columnKey">The column key the handle resizes (web <c>columnKey</c>).</param>
    /// <param name="width">The initial column width in pixels (web <c>width</c>).</param>
    /// <param name="sink">The resize seam (web <c>onResize</c> / <c>onResizeEnd</c>); pass <see cref="NoOpColumnResizeSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade the accessible name resolves through.</param>
    /// <param name="minWidth">The minimum allowed width (web <c>minWidth</c>; defaults to 60).</param>
    /// <param name="maxWidth">The maximum allowed width (web <c>maxWidth</c>; defaults to 800).</param>
    /// <param name="label">An explicit accessible label, or null to compose from the column key (web <c>label</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DataTableResizer(
        string columnKey,
        double width,
        IColumnResizeSink sink,
        ILocalizer localizer,
        int minWidth = DataTableResizerRegistration.DefaultMinWidth,
        int maxWidth = DataTableResizerRegistration.DefaultMaxWidth,
        string? label = null,
        DataTableResizerDiagnostics? diagnostics = null)
        : this(
            new DataTableResizerViewModel(columnKey, width, sink, localizer, minWidth, maxWidth, label),
            diagnostics)
    {
    }

    /// <summary>Creates the handle over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DataTableResizer(DataTableResizerViewModel viewModel, DataTableResizerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new DataTableResizerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        Width = HandleHitWidth;
        MinHeight = MinHandleHeight;
        HorizontalContentAlignment = HorizontalAlignment.Right;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        IsTabStop = true;
        UseSystemFocusVisuals = true;
        Content = _grip;

        // The col-resize cursor (web cursor-col-resize) — the platform idiom for a horizontal-size grip.
        ProtectedCursor = InputSystemCursor.Create(InputSystemCursorShape.SizeWestEast);

        AutomationProperties.SetAutomationId(this, DataTableResizerRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        PointerEntered += OnPointerEnteredHandle;
        PointerExited += OnPointerExitedHandle;
        PointerPressed += OnPointerPressedHandle;
        PointerMoved += OnPointerMovedHandle;
        PointerReleased += OnPointerReleasedHandle;
        PointerCanceled += OnPointerCanceledHandle;
        PointerCaptureLost += OnPointerCanceledHandle;
        GotFocus += OnGotFocusHandle;
        LostFocus += OnLostFocusHandle;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>DataTableResizer</c>).</summary>
    public static string Slug => DataTableResizerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DataTableResizerViewModel ViewModel => _viewModel;

    /// <summary>The accessible name the automation peer reports (web <c>aria-label</c>).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>The column key the handle resizes (web <c>columnKey</c> prop).</summary>
    public string ColumnKey
    {
        get => _viewModel.ColumnKey;
        set => _viewModel.SetColumnKey(value);
    }

    /// <summary>
    /// The current column width in pixels (web <c>width</c> prop). Assigning echoes a controlled width (clamped, no
    /// seam callback). Distinct from <see cref="FrameworkElement.Width"/>, which sizes the thin grip itself.
    /// </summary>
    public int ColumnWidth
    {
        get => _viewModel.Width;
        set => _viewModel.SetWidth(value);
    }

    /// <summary>The minimum allowed column width in pixels (web <c>minWidth</c> prop).</summary>
    public int MinColumnWidth => _viewModel.MinWidth;

    /// <summary>The maximum allowed column width in pixels (web <c>maxWidth</c> prop).</summary>
    public int MaxColumnWidth => _viewModel.MaxWidth;

    /// <summary>Set the accessible label override (web <c>label</c> prop); null/blank composes from the column key.</summary>
    /// <param name="label">The new explicit label, or null/blank for the composed default.</param>
    public void SetLabel(string? label) => _viewModel.SetLabel(label);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        PointerEntered -= OnPointerEnteredHandle;
        PointerExited -= OnPointerExitedHandle;
        PointerPressed -= OnPointerPressedHandle;
        PointerMoved -= OnPointerMovedHandle;
        PointerReleased -= OnPointerReleasedHandle;
        PointerCanceled -= OnPointerCanceledHandle;
        PointerCaptureLost -= OnPointerCanceledHandle;
        GotFocus -= OnGotFocusHandle;
        LostFocus -= OnLostFocusHandle;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DataTableResizerAutomationPeer(this);

    /// <inheritdoc />
    protected override void OnKeyDown(KeyRoutedEventArgs e)
    {
        ArgumentNullException.ThrowIfNull(e);

        switch (e.Key)
        {
            case VirtualKey.Left:
                _viewModel.Nudge(-DataTableResizerRegistration.KeyboardStep);
                e.Handled = true;
                break;
            case VirtualKey.Right:
                _viewModel.Nudge(DataTableResizerRegistration.KeyboardStep);
                e.Handled = true;
                break;
            case VirtualKey.Home:
                _viewModel.ResetToHome();
                e.Handled = true;
                break;
            case VirtualKey.End:
                _viewModel.ResizeToMax();
                e.Handled = true;
                break;
            default:
                base.OnKeyDown(e);
                break;
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void OnPointerEnteredHandle(object sender, PointerRoutedEventArgs e)
    {
        _hovering = true;
        UpdateHighlight();
    }

    private void OnPointerExitedHandle(object sender, PointerRoutedEventArgs e)
    {
        _hovering = false;
        UpdateHighlight();
    }

    private void OnPointerPressedHandle(object sender, PointerRoutedEventArgs e)
    {
        PointerPoint point = e.GetCurrentPoint(this);
        if (point.Properties.IsRightButtonPressed || point.Properties.IsMiddleButtonPressed)
        {
            return;
        }

        Focus(FocusState.Pointer);
        _startX = point.Position.X;
        _startWidth = _viewModel.Width;
        _viewModel.BeginResize();
        CapturePointer(e.Pointer);
        UpdateHighlight();

        // Don't let the press bubble to a sortable header (web onClick stopPropagation).
        e.Handled = true;
    }

    private void OnPointerMovedHandle(object sender, PointerRoutedEventArgs e)
    {
        if (!_viewModel.IsDragging)
        {
            return;
        }

        double currentX = e.GetCurrentPoint(this).Position.X;
        _viewModel.Resize(_startWidth + (currentX - _startX));
        e.Handled = true;
    }

    private void OnPointerReleasedHandle(object sender, PointerRoutedEventArgs e)
    {
        if (!_viewModel.IsDragging)
        {
            return;
        }

        _viewModel.EndResize();
        ReleasePointerCapture(e.Pointer);
        UpdateHighlight();
        e.Handled = true;
    }

    private void OnPointerCanceledHandle(object sender, PointerRoutedEventArgs e)
    {
        if (!_viewModel.IsDragging)
        {
            return;
        }

        _viewModel.EndResize();
        UpdateHighlight();
    }

    private void OnGotFocusHandle(object sender, RoutedEventArgs e)
    {
        _focused = true;
        UpdateHighlight();
    }

    private void OnLostFocusHandle(object sender, RoutedEventArgs e)
    {
        _focused = false;
        UpdateHighlight();
    }

    private void Render()
    {
        _grip.Background = DisplayTokens.Accent;
        AutomationProperties.SetName(this, _viewModel.AccessibleName);
        UpdateHighlight();
    }

    private void UpdateHighlight()
    {
        // web: invisible at rest; tinted on hover (cyan-400/40); fully lit on focus or while dragging (cyan-400/60).
        _grip.Opacity = (_viewModel.IsDragging || _focused)
            ? ActiveOpacity
            : _hovering ? HoverOpacity : 0;
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
    /// The automation peer reproducing the WAI-ARIA Window Splitter: a vertical <see cref="AutomationControlType.Separator"/>
    /// exposing a RangeValue pattern (web <c>aria-valuenow</c>/<c>min</c>/<c>max</c>), named by the localized
    /// "Resize column {col}" label. Setting the value (a screen-reader resize) commits through the same seam the
    /// keyboard uses.
    /// </summary>
    private sealed class DataTableResizerAutomationPeer : FrameworkElementAutomationPeer, IRangeValueProvider
    {
        public DataTableResizerAutomationPeer(DataTableResizer owner)
            : base(owner)
        {
        }

        public bool IsReadOnly => false;

        public double LargeChange => DataTableResizerRegistration.KeyboardStep;

        public double SmallChange => DataTableResizerRegistration.KeyboardStep;

        public double Maximum => Vm.MaxWidth;

        public double Minimum => Vm.MinWidth;

        public double Value => Vm.Width;

        private DataTableResizerViewModel Vm => ((DataTableResizer)Owner).ViewModel;

        public void SetValue(double value) => Vm.SetWidthFromAutomation(value);

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Separator;

        protected override AutomationOrientation GetOrientationCore() => AutomationOrientation.Vertical;

        protected override object? GetPatternCore(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.RangeValue ? this : base.GetPatternCore(patternInterface);

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((DataTableResizer)Owner).AccessibleName : name;
        }
    }
}
