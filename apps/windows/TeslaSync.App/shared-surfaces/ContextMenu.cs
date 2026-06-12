using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 context-menu host — a parity port of the web <c>ContextMenuRoot</c> + <c>ContextMenuView</c>
/// (web/src/components/ui/ContextMenu.tsx L216-L477). Mount exactly once near the top of the app tree (the
/// native analogue of the single web mount alongside <c>RouteAnnouncer</c> in <c>App.tsx</c>). Like the web
/// root it renders no visible chrome of its own; it subscribes to the shared <see cref="ContextMenuController"/>
/// (the module store) through its <see cref="ContextMenuRootViewModel"/> and, whenever the store publishes an
/// open snapshot, projects the items into a Fluent <see cref="MenuFlyout"/> and shows it at the requested
/// viewport coordinates. Any call site anywhere in the app opens the one menu by calling
/// <see cref="IContextMenuController.Open"/> on the shared store (the web design where data-table rows / map
/// markers / other anchors open the same menu without prop-drilling).
///
/// <para>
/// The native flyout supplies, for free, the behaviours the web component wires by hand: keyboard navigation
/// that skips disabled items (Arrow / Home / End), Enter / Space activation, Escape + outside-click + scroll
/// light-dismiss, and focus restoration to the element that owned focus when the menu opened. The viewport
/// overflow flip the web computes in <c>useLayoutEffect</c> is reproduced by <see cref="ContextMenuPlacement"/>
/// (a pure, unit-tested helper) and applied as the show position; the flyout additionally bounds-corrects
/// natively. Each item maps faithfully: <c>destructive</c> → the danger token foreground (web
/// <c>text-rose-300</c>), <c>disabled</c> → a non-interactive item shown greyed (web <c>disabled</c>),
/// <c>shortcut</c> → the right-aligned accelerator text (web shortcut hint), <c>icon</c> → a leading
/// <see cref="FontIcon"/> hidden from Narrator as decoration (web <c>aria-hidden</c>). The menu carries the one
/// localized accessible name from the web source (<c>contextMenu.menuLabel</c> → "Context menu"), each item
/// carries its caller-supplied label as its Narrator name, and the <c>view.opened</c> diagnostic is emitted
/// once on <see cref="FrameworkElement.Loaded"/>, mirroring the web component mount.
/// </para>
///
/// <para>
/// State coverage: the web source is a presentational, store-driven overlay; it performs no data fetch, so
/// (like the peer presentational surfaces AnnouncerRegion / PlaybackSpeedMenu) it has no loading / error /
/// stale / offline chrome to reproduce. The states it actually has are reproduced in full: closed (no flyout),
/// open (the flyout with its items), the empty-open no-op (an empty item list never opens the menu), and the
/// per-item enabled / disabled / destructive / shortcut / icon variants.
/// </para>
/// </summary>
public sealed partial class ContextMenuRoot : ContentControl, IDisposable
{
    private const double ItemIconSize = 16;

    // Estimated menu metrics used only to seed the viewport flip (ContextMenuPlacement). The flyout autosizes
    // and the platform bounds-corrects, so these are a deliberate estimate, not a measured layout: the width
    // sits inside the web min/max (12rem-20rem), each row matches the web px-2 py-1.5 text-sm item, and the
    // chrome is the web p-1 container padding.
    private const double EstimatedWidth = 240;
    private const double EstimatedRowHeight = 34;
    private const double EstimatedChromeHeight = 8;

    private readonly ContextMenuRootViewModel _viewModel;
    private readonly ContextMenuDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly MenuFlyout _flyout = new();

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the host over the process-wide shared store and the passthrough localizer — the native analogue
    /// of the single web <c>ContextMenuRoot</c> mount. Production hosts pass the shell's real localizer through
    /// the seam constructor.
    /// </summary>
    public ContextMenuRoot()
        : this(ContextMenuController.Shared, PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the host over an explicit store seam, localizer and optional diagnostics collector.</summary>
    /// <param name="controller">The context-menu store (web module store); pass <see cref="ContextMenuController.Shared"/> in the app.</param>
    /// <param name="localizer">The i18n facade the menu's accessible name resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ContextMenuRoot(IContextMenuController controller, ILocalizer localizer, ContextMenuDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(controller);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ContextMenuDiagnostics();
        _viewModel = new ContextMenuRootViewModel(controller, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // The host contributes no visible or focusable chrome (the web root is a store subscriber that only
        // portals the menu); it is transparent to Narrator and the flyout carries the menu semantics.
        IsTabStop = false;
        IsHitTestVisible = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        ApplyMenuAccessibleName();

        _flyout.Closed += OnFlyoutClosed;
        _viewModel.SnapshotChanged += OnSnapshotChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical surface slug (<c>ContextMenu</c>).</summary>
    public static string Slug => ContextMenuRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ContextMenuRootViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _flyout.Closed -= OnFlyoutClosed;
        _viewModel.SnapshotChanged -= OnSnapshotChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        // If a menu was opened on the store before this host was mounted, show it now.
        if (_viewModel.Current is { } pending)
        {
            ShowMenu(pending);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnSnapshotChanged(object? sender, ContextMenuSnapshot? snapshot)
    {
        void Apply()
        {
            if (snapshot is null)
            {
                _flyout.Hide();
            }
            else
            {
                ShowMenu(snapshot);
            }
        }

        // The store can be opened from any thread (e.g. a background live/MQTT callback surfacing an action);
        // touch the flyout only on the UI thread.
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(Apply);
        }
        else
        {
            Apply();
        }
    }

    private void OnFlyoutClosed(object? sender, object e)
    {
        // A user dismiss (Escape / outside-click / scroll) or an item activation closes the flyout natively;
        // reconcile the store so its snapshot reflects the closed menu. Close() is idempotent, so when the
        // close was itself store-driven this is a harmless no-op and never recurses.
        _viewModel.Close();
    }

    private void ShowMenu(ContextMenuSnapshot snapshot)
    {
        if (XamlRoot is null || XamlRoot.Content is not FrameworkElement rootElement)
        {
            // Not mounted into a window yet; the pending snapshot is shown from OnLoaded once XamlRoot exists.
            return;
        }

        RebuildItems(snapshot);

        Size viewport = XamlRoot.Size;
        double estimatedHeight = (snapshot.Items.Count * EstimatedRowHeight) + EstimatedChromeHeight;
        ContextMenuPoint point = ContextMenuPlacement.Resolve(
            snapshot.X,
            snapshot.Y,
            EstimatedWidth,
            estimatedHeight,
            viewport.Width,
            viewport.Height);

        _flyout.ShowAt(rootElement, new FlyoutShowOptions
        {
            Position = new Point(point.Left, point.Top),
            ShowMode = FlyoutShowMode.Standard,
        });
    }

    private void RebuildItems(ContextMenuSnapshot snapshot)
    {
        _flyout.Items.Clear();
        foreach (ContextMenuItem item in snapshot.Items)
        {
            _flyout.Items.Add(BuildItem(item));
        }
    }

    private MenuFlyoutItem BuildItem(ContextMenuItem item)
    {
        var flyoutItem = new MenuFlyoutItem
        {
            Text = item.Label,
            IsEnabled = !item.IsDisabled,
        };

        if (!string.IsNullOrEmpty(item.IconGlyph))
        {
            var icon = new FontIcon { Glyph = item.IconGlyph, FontSize = ItemIconSize };

            // The web item icon is aria-hidden decoration; keep it out of the Narrator tree so the item's
            // label is the only announced name.
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            flyoutItem.Icon = icon;
        }

        if (!string.IsNullOrEmpty(item.Shortcut))
        {
            // web right-aligned shortcut hint; the native accelerator text renders trailing, right-aligned.
            flyoutItem.KeyboardAcceleratorTextOverride = item.Shortcut;
        }

        if (item.IsDestructive)
        {
            // web text-rose-300 → the theme-aware danger token. A disabled item keeps the platform's greyed
            // disabled visual, exactly as the web disabled style wins over the destructive tint.
            flyoutItem.Foreground = DisplayTokens.Brush(ContextMenuRegistration.DangerBrushKey);
        }

        AutomationProperties.SetName(flyoutItem, item.Label);
        flyoutItem.Click += (_, _) => _viewModel.Invoke(item);
        return flyoutItem;
    }

    private void ApplyMenuAccessibleName()
    {
        // web: role="menu" aria-label={t('contextMenu.menuLabel', 'Context menu')}. Name the menu presenter so
        // Narrator announces the menu's purpose. Base on the default presenter style so the Fluent chrome
        // (padding / background / shadow) is preserved; if the default style is unavailable, the per-item
        // names still carry the essential semantics.
        if (Application.Current?.Resources is { } resources &&
            resources.TryGetValue("DefaultMenuFlyoutPresenterStyle", out object? baseStyle) &&
            baseStyle is Style defaultStyle)
        {
            var presenterStyle = new Style(typeof(MenuFlyoutPresenter)) { BasedOn = defaultStyle };
            presenterStyle.Setters.Add(new Setter(AutomationProperties.NameProperty, _viewModel.MenuLabel));
            _flyout.MenuFlyoutPresenterStyle = presenterStyle;
        }
    }
}
