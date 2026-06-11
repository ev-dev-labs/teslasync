using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 chart export-menu surface — a parity port of the web <c>ChartExportMenu</c>
/// (web/src/components/charts/ChartExportMenu.tsx). It renders a single icon-only Download trigger that opens
/// a Fluent <see cref="MenuFlyout"/> of export actions — "Download data as CSV" (only when a CSV export is
/// wired), "Save as PNG", "Save as SVG" and "Copy image to clipboard" — reproducing the web overflow menu's
/// data, composition, states and i18n. The native flyout supplies the light-dismiss + Escape close the web
/// source wires by hand, and a disabled trigger cannot open it (web <c>disabled</c>). While a snapshot is in
/// flight the image-capture items are disabled but the CSV item stays enabled (web <c>disabled={busy}</c> on
/// the image items only). Selecting "Copy" awaits the clipboard outcome and announces success / "downloaded
/// instead" / failure on the optional toast. All state flows through the shared
/// <see cref="ChartExportMenuViewModel"/>; the view never performs I/O. Every label resolves through the i18n
/// facade, the trigger carries a Narrator name (the menu label, or the "not ready" label while disabled) and
/// each menu item carries its localized accessible name.
///
/// <para>
/// State coverage: the web source is a presentational menu driven by injected export callbacks and an
/// in-process toast channel — it performs no data fetch, so it has no loading / error / stale / offline
/// chrome to reproduce. The states it actually has are reproduced in full: closed (trigger only), open (the
/// flyout), disabled (trigger inert + "not ready" label, menu cannot open), busy (image items disabled, CSV
/// enabled) and the three copy outcomes (copied → success toast, fallback → info toast, failed → error toast).
/// </para>
/// </summary>
public sealed partial class ChartExportMenu : ContentControl, IDisposable
{
    private const string TriggerGlyph = "\uE896"; // Segoe Fluent "Download" — the web Download trigger icon.
    private const string CsvGlyph = "\uE7C3";      // "Page" — the CSV data file (web FileSpreadsheet).
    private const string PngGlyph = "\uEB9F";      // "Photo" — a raster image (web ImageIcon).
    private const string SvgGlyph = "\uE74E";      // "Save" — save the vector image (web FileImage).
    private const string CopyGlyph = "\uE8C8";     // "Copy" — copy to clipboard (web Copy).
    private const double TriggerIconSize = 14;     // web h-3.5 w-3.5.
    private const double ItemIconSize = 16;

    private readonly ChartExportMenuViewModel _viewModel;
    private readonly ChartExportMenuDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _trigger;
    private readonly MenuFlyout _flyout = new();

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface bound to the inert seams (no export wired, no toast host) and the
    /// passthrough localizer — the native analogue of mounting the web component with no callbacks in an
    /// isolated host. Useful for galleries / design hosts; production callers use the seam constructor.
    /// </summary>
    public ChartExportMenu()
        : this(NoOpChartExportActions.Instance, NoOpChartExportToast.Instance, PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its export-action seam, optional toast seam, localizer and diagnostics.</summary>
    /// <param name="actions">The export-action seam (web callback props); decides whether the CSV item shows.</param>
    /// <param name="toast">The optional toast seam (web <c>useOptionalToast()</c>); pass <see cref="NoOpChartExportToast.Instance"/> when none is mounted.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="disabled">The initial disabled state (web <c>disabled</c> prop).</param>
    /// <param name="busy">The initial busy state (web <c>busy</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChartExportMenu(
        IChartExportActions actions,
        IChartExportToast toast,
        ILocalizer localizer,
        bool disabled = false,
        bool busy = false,
        ChartExportMenuDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(actions);
        ArgumentNullException.ThrowIfNull(toast);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ChartExportMenuDiagnostics();
        _viewModel = new ChartExportMenuViewModel(actions, toast, localizer, disabled, busy);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _trigger = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = TriggerGlyph,
            Flyout = _flyout,
        };

        // The web menu trigger uses an icon-only ghost button (h-7 w-7 p-0); a subtle icon button is the Fluent
        // equivalent. Keep the glyph compact to match the web 3.5 sizing.
        _trigger.FontSize = TriggerIconSize;

        IsTabStop = false;

        // Transparent structural wrapper: the web root is a positioning <div> with no semantics, so the surface
        // hides itself from Narrator and lets the trigger button + its menu carry the accessible semantics.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Content = _trigger;

        _flyout.Opening += OnFlyoutOpening;
        _flyout.Opened += OnFlyoutOpened;
        _flyout.Closed += OnFlyoutClosed;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>ChartExportMenu</c>).</summary>
    public static string Slug => ChartExportMenuRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ChartExportMenuViewModel ViewModel => _viewModel;

    /// <summary>The disabled state (web <c>disabled</c> prop); while disabled the trigger is inert and the menu cannot open.</summary>
    public bool IsDisabled
    {
        get => _viewModel.IsDisabled;
        set => _viewModel.IsDisabled = value;
    }

    /// <summary>The busy state (web <c>busy</c> prop); disables the image-capture items while a snapshot is in flight.</summary>
    public bool IsBusy
    {
        get => _viewModel.IsBusy;
        set => _viewModel.IsBusy = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _flyout.Opening -= OnFlyoutOpening;
        _flyout.Opened -= OnFlyoutOpened;
        _flyout.Closed -= OnFlyoutClosed;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ChartExportMenuAutomationPeer(this);

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

    private void OnFlyoutOpening(object? sender, object e) => RebuildItems();

    private void OnFlyoutOpened(object? sender, object e) => _viewModel.OpenMenu();

    private void OnFlyoutClosed(object? sender, object e) => _viewModel.CloseMenu();

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
        // The trigger is disabled exactly when the chart is not ready (web disabled prop); a disabled button
        // cannot open the flyout, reproducing "the menu cannot open while disabled".
        _trigger.IsEnabled = !_viewModel.IsDisabled;

        // Icon-only buttons have no text to name them, so the trigger's accessible name + tooltip is the menu
        // label (or the "not ready" label while disabled), matching the web aria-label / title.
        AutomationProperties.SetName(_trigger, _viewModel.TriggerLabel);
        ToolTipService.SetToolTip(_trigger, _viewModel.TriggerLabel);
    }

    private void RebuildItems()
    {
        _flyout.Items.Clear();

        // web render order: optional CSV first, then PNG, SVG, Copy.
        if (_viewModel.HasCsv)
        {
            _flyout.Items.Add(BuildItem(
                ChartExportMenuItemKind.Csv,
                _viewModel.CsvLabel,
                CsvGlyph,
                _viewModel.IsCsvItemEnabled));
        }

        _flyout.Items.Add(BuildItem(
            ChartExportMenuItemKind.Png,
            _viewModel.PngLabel,
            PngGlyph,
            _viewModel.IsImageItemEnabled));

        _flyout.Items.Add(BuildItem(
            ChartExportMenuItemKind.Svg,
            _viewModel.SvgLabel,
            SvgGlyph,
            _viewModel.IsImageItemEnabled));

        _flyout.Items.Add(BuildItem(
            ChartExportMenuItemKind.Copy,
            _viewModel.CopyLabel,
            CopyGlyph,
            _viewModel.IsImageItemEnabled));
    }

    private MenuFlyoutItem BuildItem(ChartExportMenuItemKind kind, string label, string glyph, bool enabled)
    {
        var icon = new FontIcon { Glyph = glyph, FontSize = ItemIconSize };

        // The web item icons are aria-hidden decoration; keep them out of the Narrator tree so the item's
        // label is the only announced name.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var item = new MenuFlyoutItem
        {
            Text = label,
            Icon = icon,
            IsEnabled = enabled,
        };
        AutomationProperties.SetName(item, label);
        item.Click += (_, _) => OnItemInvoked(kind);
        return item;
    }

    private void OnItemInvoked(ChartExportMenuItemKind kind)
    {
        switch (kind)
        {
            case ChartExportMenuItemKind.Csv:
                _viewModel.InvokeCsv();
                break;

            case ChartExportMenuItemKind.Png:
                _viewModel.InvokePng();
                break;

            case ChartExportMenuItemKind.Svg:
                _viewModel.InvokeSvg();
                break;

            case ChartExportMenuItemKind.Copy:
            default:
                _viewModel.InvokeCopy();
                break;
        }
    }

    private sealed class ChartExportMenuAutomationPeer : FrameworkElementAutomationPeer
    {
        public ChartExportMenuAutomationPeer(ChartExportMenu owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((ChartExportMenu)Owner).ViewModel.MenuLabel
                : name;
        }
    }
}
