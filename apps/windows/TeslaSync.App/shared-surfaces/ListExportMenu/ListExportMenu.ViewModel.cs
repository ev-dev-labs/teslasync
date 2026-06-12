using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ListExportMenu"/> view — the native port of the
/// web component body (web/src/components/forms/ListExportMenu.tsx). It mirrors the web source's behaviour
/// exactly: the controlled <see cref="IsOpen"/> menu state (web <c>useState(false)</c>) gated by
/// <see cref="IsDisabled"/> so the menu is visible only when <c>open &amp;&amp; !disabled</c>
/// (<see cref="IsMenuVisible"/>); the <see cref="Scope"/> chooser initialised to
/// <see cref="ListExportScope.Selected"/> when rows are selected else <see cref="ListExportScope.Visible"/>
/// (web <c>useState(selectedCount &gt; 0 ? 'selected' : 'visible')</c>); the scope group shown only when
/// <see cref="SelectedCount"/> is positive (<see cref="ShowScope"/>); the snap-back that forces the scope to
/// Visible when the selection drops to zero mid-menu (web <c>useEffect</c> guarding an unselectable scope);
/// the disabled-vs-enabled trigger label (web <c>listExport.disabledTooltip</c> vs <c>listExport.menuLabel</c>);
/// and the <c>handleCsv</c> / <c>handleJson</c> routing that closes the menu first, then fires the export with
/// the chosen scope (web <c>close()</c> then the callback). The view binds the projected labels + flags and
/// never performs I/O. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ListExportMenuViewModel : INotifyPropertyChanged
{
    private readonly IListExportActions _actions;
    private readonly ILocalizer _localizer;

    private bool _isOpen;
    private bool _isDisabled;
    private int _selectedCount;
    private int? _visibleCount;
    private ListExportScope _scope;

    /// <summary>
    /// Creates the holder over its export-action seam, the i18n facade and the initial props.
    /// </summary>
    /// <param name="actions">The export-action seam (web <c>onExportCsv</c> / <c>onExportJson</c> props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="selectedCount">Rows currently selected (web <c>selectedCount</c>); &gt; 0 reveals the scope chooser.</param>
    /// <param name="visibleCount">Visible (filtered) rows (web <c>visibleCount</c>); drives the "Visible (N)" label, or null for "Visible".</param>
    /// <param name="disabled">The initial disabled state (web <c>disabled</c> prop); the menu cannot open while disabled.</param>
    public ListExportMenuViewModel(
        IListExportActions actions,
        ILocalizer localizer,
        int selectedCount = 0,
        int? visibleCount = null,
        bool disabled = false)
    {
        ArgumentNullException.ThrowIfNull(actions);
        ArgumentNullException.ThrowIfNull(localizer);

        _actions = actions;
        _localizer = localizer;
        _selectedCount = selectedCount < 0 ? 0 : selectedCount;
        _visibleCount = visibleCount;
        _isDisabled = disabled;

        // web: useState(selectedCount > 0 ? 'selected' : 'visible').
        _scope = _selectedCount > 0 ? ListExportScope.Selected : ListExportScope.Visible;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Whether the menu is open (web <c>open</c> state). Opening is gated by <see cref="IsDisabled"/>; closing
    /// always succeeds. The view keeps this in sync with the native flyout's open/close.
    /// </summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set
        {
            if (_isOpen == value)
            {
                return;
            }

            _isOpen = value;
            Raise(nameof(IsOpen));
            Raise(nameof(IsMenuVisible));
        }
    }

    /// <summary>
    /// Whether the trigger is disabled (web <c>disabled</c> prop). While disabled the menu cannot open, the
    /// menu is not visible even if <see cref="IsOpen"/> is true (web <c>open &amp;&amp; !disabled</c>), and the
    /// trigger announces the "No data to export" label.
    /// </summary>
    public bool IsDisabled
    {
        get => _isDisabled;
        set
        {
            if (_isDisabled == value)
            {
                return;
            }

            _isDisabled = value;
            Raise(nameof(IsDisabled));
            Raise(nameof(IsMenuVisible));
            Raise(nameof(TriggerLabel));
        }
    }

    /// <summary>
    /// The number of selected rows (web <c>selectedCount</c>). A positive value reveals the scope chooser
    /// (<see cref="ShowScope"/>) and updates the "Selected (M)" label; setting it to zero snaps the scope back
    /// to <see cref="ListExportScope.Visible"/> so the chosen scope can never become unselectable (web
    /// <c>useEffect</c>).
    /// </summary>
    public int SelectedCount
    {
        get => _selectedCount;
        set
        {
            int normalized = value < 0 ? 0 : value;
            if (_selectedCount == normalized)
            {
                return;
            }

            bool wasShown = ShowScope;
            _selectedCount = normalized;
            Raise(nameof(SelectedCount));
            Raise(nameof(SelectedLabel));
            if (ShowScope != wasShown)
            {
                Raise(nameof(ShowScope));
            }

            // web: if the selection drops to 0 while 'selected' is chosen, snap back to 'visible'.
            if (_selectedCount == 0 && _scope == ListExportScope.Selected)
            {
                SetScope(ListExportScope.Visible);
            }
        }
    }

    /// <summary>
    /// The number of visible (filtered) rows (web <c>visibleCount</c>). When set, the visible radio reads
    /// "Visible (N)"; when null it reads "Visible".
    /// </summary>
    public int? VisibleCount
    {
        get => _visibleCount;
        set
        {
            if (_visibleCount == value)
            {
                return;
            }

            _visibleCount = value;
            Raise(nameof(VisibleCount));
            Raise(nameof(VisibleLabel));
        }
    }

    /// <summary>The currently chosen export scope (web <c>scope</c> state); handed to the export action.</summary>
    public ListExportScope Scope => _scope;

    /// <summary>
    /// True when the scope chooser is shown — rows are selected (web <c>{selectedCount &gt; 0 &amp;&amp; (...fieldset)}</c>).
    /// </summary>
    public bool ShowScope => _selectedCount > 0;

    /// <summary>
    /// True when the menu surface is actually shown — open and not disabled (web
    /// <c>{open &amp;&amp; !disabled &amp;&amp; (...menu)}</c>).
    /// </summary>
    public bool IsMenuVisible => _isOpen && !_isDisabled;

    /// <summary>True when the Visible radio is the chosen scope.</summary>
    public bool VisibleChecked => _scope == ListExportScope.Visible;

    /// <summary>True when the Selected radio is the chosen scope.</summary>
    public bool SelectedChecked => _scope == ListExportScope.Selected;

    /// <summary>
    /// The trigger's accessible name / tooltip — the "No data to export" copy while disabled, otherwise the
    /// menu label (web <c>disabled ? t('listExport.disabledTooltip', ...) : t('listExport.menuLabel', ...)</c>).
    /// </summary>
    public string TriggerLabel => _isDisabled
        ? _localizer.GetString(ListExportMenuRegistration.DisabledTooltipKey, ListExportMenuRegistration.DisabledTooltipFallback)
        : _localizer.GetString(ListExportMenuRegistration.MenuLabelKey, ListExportMenuRegistration.MenuLabelFallback);

    /// <summary>The trigger's visible text (web <c>t('listExport.button', 'Export')</c>).</summary>
    public string ButtonText =>
        _localizer.GetString(ListExportMenuRegistration.ButtonKey, ListExportMenuRegistration.ButtonFallback);

    /// <summary>The scope group legend (web <c>t('listExport.scopeLegend', 'Export scope')</c>).</summary>
    public string ScopeLegendLabel =>
        _localizer.GetString(ListExportMenuRegistration.ScopeLegendKey, ListExportMenuRegistration.ScopeLegendFallback);

    /// <summary>
    /// The Visible radio label — "Visible (N)" when <see cref="VisibleCount"/> is known, otherwise "Visible"
    /// (web <c>visibleCount != null ? t('listExport.visibleWithCount', ..., { count }) : t('listExport.visible', ...)</c>).
    /// </summary>
    public string VisibleLabel => _visibleCount.HasValue
        ? ListExportMenuRegistration.FormatCount(
            _localizer.GetString(ListExportMenuRegistration.VisibleWithCountKey, ListExportMenuRegistration.VisibleWithCountFallback),
            _visibleCount.Value)
        : _localizer.GetString(ListExportMenuRegistration.VisibleKey, ListExportMenuRegistration.VisibleFallback);

    /// <summary>The Selected radio label — "Selected (M)" (web <c>t('listExport.selectedWithCount', ..., { count: selectedCount })</c>).</summary>
    public string SelectedLabel => ListExportMenuRegistration.FormatCount(
        _localizer.GetString(ListExportMenuRegistration.SelectedWithCountKey, ListExportMenuRegistration.SelectedWithCountFallback),
        _selectedCount);

    /// <summary>The CSV item label (web <c>t('listExport.csv', 'Download as CSV')</c>).</summary>
    public string CsvLabel =>
        _localizer.GetString(ListExportMenuRegistration.CsvKey, ListExportMenuRegistration.CsvFallback);

    /// <summary>The JSON item label (web <c>t('listExport.json', 'Download as JSON')</c>).</summary>
    public string JsonLabel =>
        _localizer.GetString(ListExportMenuRegistration.JsonKey, ListExportMenuRegistration.JsonFallback);

    /// <summary>Open the menu (web <c>setOpen(true)</c>); a no-op while disabled, as the web trigger cannot fire.</summary>
    public void OpenMenu()
    {
        if (_isDisabled)
        {
            return;
        }

        IsOpen = true;
    }

    /// <summary>Close the menu (web <c>close()</c>).</summary>
    public void CloseMenu() => IsOpen = false;

    /// <summary>Toggle the menu (web trigger <c>onClick={() =&gt; setOpen(v =&gt; !v)}</c>).</summary>
    public void ToggleMenu()
    {
        if (_isOpen)
        {
            CloseMenu();
        }
        else
        {
            OpenMenu();
        }
    }

    /// <summary>Choose the export scope (web radio <c>onChange={() =&gt; setScope(...)}</c>).</summary>
    public void SelectScope(ListExportScope scope) => SetScope(scope);

    /// <summary>
    /// Fire the CSV export (web <c>handleCsv</c>) as a detached task — the view's click handler. Closes the
    /// menu first, then runs the export with the chosen scope.
    /// </summary>
    public void InvokeCsv() => _ = InvokeCsvAsync();

    /// <summary>
    /// Close the menu and run the CSV export with the chosen scope — the awaitable core of
    /// <see cref="InvokeCsv"/> (exposed for headless tests). Mirrors the web <c>handleCsv</c>: <c>close()</c>
    /// then <c>onExportCsv(scope)</c>.
    /// </summary>
    public Task InvokeCsvAsync()
    {
        CloseMenu();
        return _actions.ExportCsvAsync(_scope);
    }

    /// <summary>
    /// Fire the JSON export (web <c>handleJson</c>) as a detached task — the view's click handler. Closes the
    /// menu first, then runs the export with the chosen scope.
    /// </summary>
    public void InvokeJson() => _ = InvokeJsonAsync();

    /// <summary>
    /// Close the menu and run the JSON export with the chosen scope — the awaitable core of
    /// <see cref="InvokeJson"/> (exposed for headless tests). Mirrors the web <c>handleJson</c>: <c>close()</c>
    /// then <c>onExportJson(scope)</c>.
    /// </summary>
    public Task InvokeJsonAsync()
    {
        CloseMenu();
        return _actions.ExportJsonAsync(_scope);
    }

    private void SetScope(ListExportScope scope)
    {
        if (_scope == scope)
        {
            return;
        }

        _scope = scope;
        Raise(nameof(Scope));
        Raise(nameof(VisibleChecked));
        Raise(nameof(SelectedChecked));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
