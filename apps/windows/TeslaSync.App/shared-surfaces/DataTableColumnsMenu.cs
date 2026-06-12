using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 column-visibility chooser surface — a parity port of the web <c>DataTableColumnsMenu</c>
/// (web/src/components/ui/DataTableColumnsMenu.tsx). It renders the web default trigger — a subtle "Columns"
/// icon button — that opens a Fluent <see cref="Flyout"/> reproducing the web popover: a "Visible columns"
/// heading with a "Show all" action, then one <see cref="TsCheckbox"/> per column. Toggling a checkbox runs the
/// web <c>toggle</c> rule (the last visible column and any required column cannot be hidden); "Show all"
/// reveals every column. The native flyout supplies the light-dismiss + Escape close the web source wires by
/// hand (click-outside / <c>Escape</c>) and keeps the popover open while the user toggles checkboxes inside it.
/// All state flows through the shared <see cref="DataTableColumnsMenuViewModel"/> over its
/// <see cref="IDataTableColumnsSource"/> seam; the view never performs I/O. Every label resolves through the
/// i18n facade, the trigger carries the menu's Narrator name (web <c>aria-label</c>), the flyout surface is
/// named, and each checkbox carries its column label so Narrator voices "checkbox, checked/unchecked".
///
/// <para>
/// State coverage: the web source's only data source is <c>useTranslation</c> — it is a controlled,
/// presentational popover driven by injected <c>columns</c> / <c>visibleKeys</c> props, so it has no loading /
/// error / stale / offline chrome to reproduce. The states it actually has are reproduced in full: closed
/// (trigger only), open (the popover) and the no-column set (the heading + "Show all" over an empty list,
/// mirroring the web empty <c>&lt;ul&gt;</c> — never a blank box).
/// </para>
/// </summary>
public sealed partial class DataTableColumnsMenu : ContentControl, IDisposable
{
    private const string TriggerGlyph = "\uE8A9"; // Segoe Fluent "ViewAll" — the columns/view-options trigger (web lucide Columns3).
    private const double TriggerFontSize = 12;    // web text-xs.
    private const double PopoverMinWidth = 224;   // web w-56 (14rem).
    private const double ListMaxHeight = 256;     // web max-h-64 (16rem).
    private const double HeadingFontSize = 11;    // web text-[10px] heading, nudged up for native legibility.
    private const double HeadingOpacity = 0.65;   // web text-[var(--text-muted)].
    private const double RowPaddingX = 8;         // web px-2.

    private readonly DataTableColumnsMenuViewModel _viewModel;
    private readonly DataTableColumnsMenuDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _trigger;
    private readonly Flyout _flyout = new();
    private readonly StackPanel _menuRoot = new() { Spacing = 8, MinWidth = PopoverMinWidth };
    private readonly Grid _header = new();
    private readonly TextBlock _heading = new()
    {
        FontSize = HeadingFontSize,
        FontWeight = FontWeights.SemiBold,
        Opacity = HeadingOpacity,
        VerticalAlignment = VerticalAlignment.Center,
        TextWrapping = TextWrapping.NoWrap,
    };

    private readonly TsButton _showAll = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly ScrollViewer _scroll = new()
    {
        MaxHeight = ListMaxHeight,
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        HorizontalScrollMode = ScrollMode.Disabled,
    };

    private readonly StackPanel _list = new() { Orientation = Orientation.Vertical, Spacing = 2 };

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over an empty in-memory source and the passthrough localizer — the
    /// native analogue of mounting the web component with no columns in an isolated gallery host. It renders the
    /// no-column popover. Production callers use the seam constructor.
    /// </summary>
    public DataTableColumnsMenu()
        : this(new DataTableColumnsSource(), PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its column / visible-key seam, the i18n facade and diagnostics.</summary>
    /// <param name="source">The column + visible-key seam (web <c>columns</c> / <c>visibleKeys</c> / <c>onChange</c>); the surface's P1/S8 seam.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DataTableColumnsMenu(
        IDataTableColumnsSource source,
        ILocalizer localizer,
        DataTableColumnsMenuDiagnostics? diagnostics = null)
        : this(new DataTableColumnsMenuViewModel(source, localizer), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DataTableColumnsMenu(DataTableColumnsMenuViewModel viewModel, DataTableColumnsMenuDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new DataTableColumnsMenuDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _trigger = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = TriggerGlyph,
            FontSize = TriggerFontSize,
            Flyout = _flyout,
        };

        IsTabStop = false;

        // Transparent structural wrapper: the web root is a positioning <div> with no semantics, so the surface
        // hides itself from Narrator and lets the trigger button + its popover carry the accessible semantics.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        BuildFlyoutContent();
        Content = _trigger;

        _flyout.Opening += OnFlyoutOpening;
        _flyout.Opened += OnFlyoutOpened;
        _flyout.Closed += OnFlyoutClosed;
        _showAll.Click += OnShowAllClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>DataTableColumnsMenu</c>).</summary>
    public static string Slug => DataTableColumnsMenuRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DataTableColumnsMenuViewModel ViewModel => _viewModel;

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
        _showAll.Click -= OnShowAllClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _flyout.Hide();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DataTableColumnsMenuAutomationPeer(this);

    private void BuildFlyoutContent()
    {
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_heading, 0);
        Grid.SetColumn(_showAll, 1);
        _header.Children.Add(_heading);
        _header.Children.Add(_showAll);

        _scroll.Content = _list;
        _menuRoot.Children.Add(_header);
        _menuRoot.Children.Add(_scroll);

        _flyout.Content = _menuRoot;
        _flyout.Placement = FlyoutPlacementMode.BottomEdgeAlignedRight; // web absolute right-0 mt-1.
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

    private void OnFlyoutOpening(object? sender, object e) => RebuildRows();

    private void OnFlyoutOpened(object? sender, object e) => _viewModel.OpenMenu();

    private void OnFlyoutClosed(object? sender, object e) => _viewModel.CloseMenu();

    private void OnShowAllClicked(object sender, RoutedEventArgs e) => _viewModel.ShowAll();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;

        // Always marshal onto the dispatcher: a row toggle re-projects synchronously inside the CheckBox click,
        // so deferring the row rebuild keeps us from mutating the list while a child's click is on the stack.
        if (_dispatcher is { } dispatcher)
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
        DataTableColumnsMenuDisplay display = _viewModel.Display;

        _trigger.Text = display.ButtonLabel;

        // Icon + text trigger: the visible text is "Columns", but the accessible name + tooltip is the web
        // aria-label ("Show or hide columns"), so Narrator and the tooltip match the web source.
        AutomationProperties.SetName(_trigger, display.MenuLabel);
        ToolTipService.SetToolTip(_trigger, display.MenuLabel);

        _heading.Text = display.HeadingLabel;
        _showAll.Text = display.ShowAllLabel;
        AutomationProperties.SetName(_showAll, display.ShowAllLabel);

        // The flyout surface carries the web role="menu" aria-label.
        AutomationProperties.SetName(_menuRoot, display.MenuLabel);

        RebuildRows();
    }

    private void RebuildRows()
    {
        _list.Children.Clear();

        IReadOnlyList<DataTableColumnRow> rows = _viewModel.Display.Rows;
        for (int i = 0; i < rows.Count; i++)
        {
            DataTableColumnRow row = rows[i];
            var checkbox = new TsCheckbox
            {
                Content = row.Label,
                IsChecked = row.IsChecked,
                IsEnabled = !row.IsDisabled,
                Padding = new Thickness(RowPaddingX, 4, RowPaddingX, 4),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
            };

            // Narrator already announces the checkbox role + checked state; name it with the column label so the
            // announcement carries the column it controls (web <span>{col.header || col.key}</span>).
            AutomationProperties.SetName(checkbox, row.Label);

            string key = row.Key;
            checkbox.Click += (_, _) => _viewModel.Toggle(key);
            _list.Children.Add(checkbox);
        }
    }

    private sealed class DataTableColumnsMenuAutomationPeer : FrameworkElementAutomationPeer
    {
        public DataTableColumnsMenuAutomationPeer(DataTableColumnsMenu owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((DataTableColumnsMenu)Owner).ViewModel.Display.MenuLabel
                : name;
        }
    }
}
