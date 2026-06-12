using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 data-table bulk bar surface — a parity port of the web <c>DataTableBulkBar</c>
/// (web/src/components/ui/DataTableBulkBar.tsx). It renders a translucent, cyan-accented <see cref="TsGlassPanel"/>
/// bar shown above a table while one or more rows are selected: a polite selection-count caption (web
/// <c>aria-live="polite"</c> <c>"{{count}} selected"</c>), the consumer-supplied bulk-actions slot
/// (<see cref="Actions"/> = web <c>children</c>, where a host mounts Export / Delete / Archive controls) and a
/// subtle clear-selection button with a leading close glyph (web <c>onClear</c> with the lucide <c>X</c>). The
/// bar collapses itself when nothing is selected (web <c>count &lt;= 0 ? null</c>) so consumers can mount it
/// unconditionally. All state flows through the shared <see cref="DataTableBulkBarViewModel"/> (P1/S8); the view
/// never performs I/O. Every label resolves through the i18n facade (P1/S10), the region carries the toolbar
/// Narrator name and exposes a Group automation peer, the count caption announces politely, and the clear
/// button carries an accessible name. Colours come from the W1 theme tokens (P1/S9) so the light theme keeps
/// working; no fixed font sizes are set, so the caption and button honour the system text-scale setting.
///
/// <para>
/// State coverage: the web source is a presentational bar driven by injected props (<c>count</c>, <c>onClear</c>,
/// <c>children</c>) — it performs no data fetch, so it has no loading / error / stale / offline chrome to
/// reproduce. The states it actually has are reproduced in full: hidden (nothing selected → the bar collapses)
/// and visible (the polite count caption + the actions slot + the clear button). It also has no animation, so
/// there is no motion to gate on the reduced-motion setting.
/// </para>
/// </summary>
public sealed partial class DataTableBulkBar : ContentControl, IDisposable
{
    private const string ClearGlyph = "\uE894"; // Segoe Fluent "Clear" — clears the current selection (web X icon).
    private const double PanelPaddingX = 12;     // web px-3.
    private const double PanelPaddingY = 8;      // web py-2.
    private const double BottomMargin = 8;       // web mb-2.
    private const double GroupSpacing = 8;       // web gap-2.

    private readonly DataTableBulkBarViewModel _viewModel;
    private readonly DataTableBulkBarDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.Cyan };
    private readonly Grid _layout = new();

    private readonly TextBlock _countText = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
        FontWeight = FontWeights.Medium, // web font-medium.
    };

    private readonly StackPanel _trailing = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = GroupSpacing,
        HorizontalAlignment = HorizontalAlignment.Right, // web ml-auto.
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly ContentPresenter _actionsSlot = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TsButton _clear = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = ClearGlyph,
    };

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface with the passthrough localizer — the native analogue of mounting the web
    /// component in an isolated host. Production callers use the seam constructor.
    /// </summary>
    public DataTableBulkBar()
        : this(PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its localizer and diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event (P1/S11).</param>
    public DataTableBulkBar(ILocalizer localizer, DataTableBulkBarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _diagnostics = diagnostics ?? new DataTableBulkBarDiagnostics();
        _viewModel = new DataTableBulkBarViewModel(localizer);

        IsTabStop = false;
        Margin = new Thickness(0, 0, 0, BottomMargin);

        // The count caption announces selection-count changes politely (web aria-live="polite") and reads as
        // the primary text colour (web text-[var(--text-primary)]).
        AutomationProperties.SetLiveSetting(_countText, AutomationLiveSetting.Polite);
        _countText.Foreground = (Brush)Application.Current.Resources["TsColorTextPrimaryBrush"];

        _layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });
        _layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _layout.ColumnSpacing = GroupSpacing;

        Grid.SetColumn(_countText, 0);
        Grid.SetColumn(_trailing, 1);

        // web: {children} render first, then the clear button (both inside the trailing ml-auto group).
        _trailing.Children.Add(_actionsSlot);
        _trailing.Children.Add(_clear);

        _layout.Children.Add(_countText);
        _layout.Children.Add(_trailing);

        _panel.Padding = new Thickness(PanelPaddingX, PanelPaddingY, PanelPaddingX, PanelPaddingY);
        _panel.Content = _layout;
        Content = _panel;

        // The clear button is the only built-in action; expose a stable automation id for UI-automation hooks.
        AutomationProperties.SetAutomationId(_clear, "clear");

        // The web root is a region landmark with an aria-label; carry the name on the panel and expose a Group
        // automation peer so Narrator reports the bar as a named region.
        AutomationProperties.SetName(_panel, _viewModel.RegionLabel);

        _clear.Click += OnClearClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>DataTableBulkBar</c>).</summary>
    public static string Slug => DataTableBulkBarRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DataTableBulkBarViewModel ViewModel => _viewModel;

    /// <summary>
    /// The consumer-supplied bulk-actions content rendered ahead of the clear button (web <c>children</c>): a
    /// host mounts its per-page action controls (Export, Delete, Archive, …) here. Null renders no actions.
    /// </summary>
    public object? Actions
    {
        get => _actionsSlot.Content;
        set => _actionsSlot.Content = value;
    }

    /// <summary>Raised when the user activates the clear button (web <c>onClear</c>); the host clears its selection.</summary>
    public event EventHandler? SelectionCleared;

    /// <summary>Set the current selection count, re-rendering the bar (web <c>count</c> prop change).</summary>
    public void SetCount(int count) => _viewModel.SetCount(count);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _clear.Click -= OnClearClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DataTableBulkBarAutomationPeer(this);

    private void OnClearClicked(object sender, RoutedEventArgs e)
    {
        _viewModel.RequestClear();
        SelectionCleared?.Invoke(this, EventArgs.Empty);
    }

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

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        // The bar collapses entirely when nothing is selected (web count <= 0 ? null).
        Visibility = _viewModel.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        _countText.Text = _viewModel.CountLabel;
        AutomationProperties.SetName(_countText, _viewModel.CountLabel);

        _clear.Text = _viewModel.ClearLabel;
        AutomationProperties.SetName(_clear, _viewModel.ClearLabel);

        AutomationProperties.SetName(_panel, _viewModel.RegionLabel);
    }

    private sealed class DataTableBulkBarAutomationPeer : FrameworkElementAutomationPeer
    {
        public DataTableBulkBarAutomationPeer(DataTableBulkBar owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((DataTableBulkBar)Owner).ViewModel.RegionLabel
                : name;
        }
    }
}
