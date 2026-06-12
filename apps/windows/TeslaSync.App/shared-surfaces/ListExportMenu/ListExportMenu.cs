using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 list export-menu surface — a parity port of the web <c>ListExportMenu</c>
/// (web/src/components/forms/ListExportMenu.tsx). It renders a single Download-icon trigger labelled "Export"
/// that opens a Fluent <see cref="Flyout"/> popover: an optional scope chooser (an "Export scope" legend with a
/// checklist icon plus Visible / Selected radios, shown only when rows are selected) followed by
/// "Download as CSV" and "Download as JSON" items, each handing the chosen <see cref="ListExportScope"/> back to
/// the caller. It reproduces the web overflow control's data, composition, states and i18n. The native flyout
/// supplies the light-dismiss + Escape close the web source wires by hand, and a disabled trigger cannot open it
/// (web <c>disabled</c>) — the trigger then announces "No data to export" (web <c>listExport.disabledTooltip</c>).
/// All state flows through the shared <see cref="ListExportMenuViewModel"/>; the view never performs I/O — the
/// caller owns serialising the rows, building the filename and triggering the download (web class doc). Every
/// label resolves through the i18n facade, the trigger carries a Narrator name (the menu label, or the
/// "No data to export" label while disabled), the scope group exposes its legend as the group's accessible name,
/// each radio + item carries its localized name, and the decorative icons are hidden from Narrator.
///
/// <para>
/// State coverage: the web source is a presentational menu driven by injected export callbacks — it performs no
/// data fetch, so (like the peer presentational surfaces ChartExportMenu / PlaybackSpeedMenu) it has no loading
/// / error / stale / offline chrome to reproduce. The states it actually has are reproduced in full: closed
/// (trigger only), open (the popover), disabled (trigger inert + "No data to export", the popover cannot open —
/// the surface's "no data" representation), the scope chooser present-vs-absent (rows selected or not), the
/// Visible label with-vs-without a count, and the chosen-scope selection (Visible vs Selected, including the
/// snap back to Visible when the selection drops to zero).
/// </para>
/// </summary>
public sealed partial class ListExportMenu : ContentControl, IDisposable
{
    private const string TriggerGlyph = "\uE896"; // Segoe Fluent "Download" — the web Download trigger icon.
    private const string ScopeGlyph = "\uE8FD";   // "List" — the scope legend icon (web ListChecks), decorative.
    private const string CsvGlyph = "\uE7C3";     // "Page" — the CSV row data file (web FileSpreadsheet).
    private const string JsonGlyph = "\uE943";    // "Code" — the JSON structured file (web FileJson).

    private const double PopoverWidth = 224;      // web w-56 (14rem).
    private const double ScopeIconSize = 12;      // web h-3 w-3.
    private const string ScopeGroupName = "ListExportScope";

    private readonly ListExportMenuViewModel _viewModel;
    private readonly ListExportMenuDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _trigger;
    private readonly Flyout _flyout = new() { Placement = FlyoutPlacementMode.BottomEdgeAlignedRight };

    private bool _opened;
    private bool _popoverOpen;
    private bool _rebuilding;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface bound to the inert export seam and the passthrough localizer — the native
    /// analogue of mounting the web component with no-op callbacks in an isolated host. Useful for galleries /
    /// design hosts; production callers use the seam constructor.
    /// </summary>
    public ListExportMenu()
        : this(NoOpListExportActions.Instance, PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its export-action seam, localizer, initial props and diagnostics.</summary>
    /// <param name="actions">The export-action seam (web <c>onExportCsv</c> / <c>onExportJson</c> props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="selectedCount">Rows currently selected (web <c>selectedCount</c>); &gt; 0 reveals the scope chooser.</param>
    /// <param name="visibleCount">Visible (filtered) rows (web <c>visibleCount</c>); drives "Visible (N)", or null for "Visible".</param>
    /// <param name="disabled">The initial disabled state (web <c>disabled</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ListExportMenu(
        IListExportActions actions,
        ILocalizer localizer,
        int selectedCount = 0,
        int? visibleCount = null,
        bool disabled = false,
        ListExportMenuDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(actions);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ListExportMenuDiagnostics();
        _viewModel = new ListExportMenuViewModel(actions, localizer, selectedCount, visibleCount, disabled);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // web Button variant="ghost" size="sm" with a Download icon + "Export" text → a small subtle icon+text button.
        _trigger = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = TriggerGlyph,
            Flyout = _flyout,
        };

        IsTabStop = false;

        // Transparent structural wrapper: the web root is a positioning <div> with no semantics, so the surface
        // hides itself from Narrator and lets the trigger button + its popover carry the accessible semantics.
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

    /// <summary>The canonical surface slug (<c>ListExportMenu</c>).</summary>
    public static string Slug => ListExportMenuRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ListExportMenuViewModel ViewModel => _viewModel;

    /// <summary>The disabled state (web <c>disabled</c> prop); while disabled the trigger is inert and the menu cannot open.</summary>
    public bool IsDisabled
    {
        get => _viewModel.IsDisabled;
        set => _viewModel.IsDisabled = value;
    }

    /// <summary>The number of selected rows (web <c>selectedCount</c> prop); &gt; 0 reveals the scope chooser.</summary>
    public int SelectedCount
    {
        get => _viewModel.SelectedCount;
        set => _viewModel.SelectedCount = value;
    }

    /// <summary>The number of visible (filtered) rows (web <c>visibleCount</c> prop); drives the "Visible (N)" label.</summary>
    public int? VisibleCount
    {
        get => _viewModel.VisibleCount;
        set => _viewModel.VisibleCount = value;
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
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ListExportMenuAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnFlyoutOpening(object? sender, object e) => RebuildPopover();

    private void OnFlyoutOpened(object? sender, object e)
    {
        _popoverOpen = true;
        _viewModel.OpenMenu();
    }

    private void OnFlyoutClosed(object? sender, object e)
    {
        _popoverOpen = false;
        _viewModel.CloseMenu();
    }

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
        // The trigger is disabled exactly when there is no data to export (web disabled prop); a disabled button
        // cannot open the flyout, reproducing "the menu cannot open while disabled".
        _trigger.IsEnabled = !_viewModel.IsDisabled;
        _trigger.Text = _viewModel.ButtonText;

        // The trigger shows "Export" but is named by the menu label (or the "No data to export" label while
        // disabled), matching the web aria-label / title that differs from the visible button text.
        AutomationProperties.SetName(_trigger, _viewModel.TriggerLabel);
        ToolTipService.SetToolTip(_trigger, _viewModel.TriggerLabel);

        if (_popoverOpen)
        {
            RebuildPopover();
        }
    }

    private void RebuildPopover()
    {
        var panel = new StackPanel
        {
            Width = PopoverWidth,
            Spacing = 2,
            Padding = new Thickness(8),
        };
        AutomationProperties.SetName(panel, _viewModel.TriggerLabel);

        // web: {selectedCount > 0 && (<fieldset>...scope radios...</fieldset>)}.
        if (_viewModel.ShowScope)
        {
            panel.Children.Add(BuildScopeSection());
            panel.Children.Add(BuildSeparator());
        }

        panel.Children.Add(BuildItem(ListExportFormat.Csv, CsvGlyph, _viewModel.CsvLabel));
        panel.Children.Add(BuildItem(ListExportFormat.Json, JsonGlyph, _viewModel.JsonLabel));

        _flyout.Content = panel;
    }

    private StackPanel BuildScopeSection()
    {
        var section = new StackPanel { Spacing = 2 };

        // The fieldset's legend is the group's accessible name (web <fieldset aria-label={scopeLegend}>).
        AutomationProperties.SetName(section, _viewModel.ScopeLegendLabel);

        var legendRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
        };
        var legendIcon = new FontIcon { Glyph = ScopeGlyph, FontSize = ScopeIconSize };

        // The legend icon is decorative (web aria-hidden); keep it out of the Narrator tree.
        AutomationProperties.SetAccessibilityView(legendIcon, AccessibilityView.Raw);
        legendRow.Children.Add(legendIcon);
        legendRow.Children.Add(new TextBlock
        {
            Text = _viewModel.ScopeLegendLabel,
            FontSize = 11,
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = Brush("TsColorTextMutedBrush"),
        });
        section.Children.Add(legendRow);

        // Build both radios with their handlers, then assign the checked state behind the rebuild guard so the
        // programmatic IsChecked does not echo back into SelectScope.
        RadioButton visible = BuildScopeRadio(ListExportScope.Visible, _viewModel.VisibleLabel);
        RadioButton selected = BuildScopeRadio(ListExportScope.Selected, _viewModel.SelectedLabel);

        _rebuilding = true;
        visible.IsChecked = _viewModel.VisibleChecked;
        selected.IsChecked = _viewModel.SelectedChecked;
        _rebuilding = false;

        section.Children.Add(visible);
        section.Children.Add(selected);
        return section;
    }

    private RadioButton BuildScopeRadio(ListExportScope scope, string label)
    {
        var radio = new RadioButton
        {
            Content = label,
            GroupName = ScopeGroupName,
            FontSize = 12,
            MinHeight = 0,
            Padding = new Thickness(4, 2, 4, 2),
        };
        AutomationProperties.SetName(radio, label);
        radio.Checked += (_, _) =>
        {
            if (_rebuilding)
            {
                return;
            }

            _viewModel.SelectScope(scope);
        };
        return radio;
    }

    private static Border BuildSeparator() => new()
    {
        Height = 1,
        Margin = new Thickness(0, 4, 0, 4),
        Background = Brush("TsColorBorderBrush"),
    };

    private TsButton BuildItem(ListExportFormat format, string glyph, string label)
    {
        var item = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = glyph,
            Text = label,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(item, label);
        item.Click += (_, _) => OnItemInvoked(format);
        return item;
    }

    private void OnItemInvoked(ListExportFormat format)
    {
        _flyout.Hide();
        switch (format)
        {
            case ListExportFormat.Csv:
                _viewModel.InvokeCsv();
                break;

            case ListExportFormat.Json:
            default:
                _viewModel.InvokeJson();
                break;
        }
    }

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out object? value) && value is Brush brush ? brush : null;

    private sealed class ListExportMenuAutomationPeer : FrameworkElementAutomationPeer
    {
        public ListExportMenuAutomationPeer(ListExportMenu owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((ListExportMenu)Owner).ViewModel.TriggerLabel
                : name;
        }
    }
}
