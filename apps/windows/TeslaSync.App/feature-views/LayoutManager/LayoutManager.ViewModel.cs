using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// A request to rename one layout — the native analogue of the web <c>onRename(id, name)</c> callback
/// (web/src/features/dashboard/components/LayoutManager.tsx). Carries the target <see cref="Id"/> and the
/// trimmed new <see cref="Name"/> (never empty — the view-model raises this only when the trimmed name is
/// non-empty, mirroring the web <c>if (editName.trim())</c> guard).
/// </summary>
/// <param name="Id">The id of the layout being renamed.</param>
/// <param name="Name">The trimmed, non-empty new name.</param>
public sealed record LayoutRenameRequest(string Id, string Name);

/// <summary>
/// A request to reorder the layouts — the native analogue of the web <c>onReorder(fromIndex, toIndex)</c>
/// callback (web/src/features/dashboard/components/LayoutManager.tsx). Raised only for a real move
/// (<see cref="From"/> != <see cref="To"/>), mirroring the web <c>dragIndex !== targetIndex</c> guard.
/// </summary>
/// <param name="From">The source index of the dragged layout.</param>
/// <param name="To">The destination index the layout was dropped on.</param>
public sealed record LayoutReorderRequest(int From, int To);

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LayoutManager"/> view — the native port of the web
/// <c>LayoutManager</c>'s hook + state composition
/// (web/src/features/dashboard/components/LayoutManager.tsx). The web component is fully controlled: its only
/// hook is <c>useTranslation('dashboard')</c> and every mutation flows out through a callback prop
/// (<c>onSwitch</c>, <c>onCreate</c>, <c>onRename</c>, <c>onDelete</c>, <c>onReorder</c>, <c>onDuplicate</c>,
/// <c>onOpenSettings</c>, <c>onOpenTemplates</c>) while the parent owns the layout collection. This holder
/// reproduces that contract exactly: it owns only the transient interaction state the web keeps in
/// <c>useState</c> (which tab is being renamed, whether the inline create field is open) and surfaces every
/// mutation as an event for the host to apply, then to push back via <see cref="UpdateDashboards"/>. The active
/// selection (web <c>onSwitch</c> immediately reflected through the re-rendered <c>activeId</c> prop) and a drag
/// reorder are applied optimistically so the strip updates without a round-trip; all other mutations stay
/// controlled because only the host can mint ids and persist. <see cref="Reload"/> re-resolves every label after
/// the active language changes. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class LayoutManagerViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    private List<LayoutDashboard> _dashboards;
    private string? _activeId;
    private string? _editingId;
    private string _editingName;
    private bool _isCreating;
    private LayoutManagerDisplay _display;

    /// <summary>
    /// Creates the holder over the i18n facade, an optional initial layout collection, the active layout id and
    /// whether a template picker is wired (the web <c>onOpenTemplates</c> prop). When templates are supported the
    /// "New Layout" affordance opens the picker instead of the inline create field, mirroring the web
    /// <c>startCreate</c> early-return.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="dashboards">The initial saved layouts (null is treated as empty).</param>
    /// <param name="activeId">The initially active layout id (web <c>activeId</c>).</param>
    /// <param name="supportsTemplates">True when a template picker is wired (web <c>onOpenTemplates</c> present).</param>
    public LayoutManagerViewModel(
        ILocalizer localizer,
        IReadOnlyList<LayoutDashboard>? dashboards = null,
        string? activeId = null,
        bool supportsTemplates = false)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _dashboards = dashboards is null ? new List<LayoutDashboard>() : new List<LayoutDashboard>(dashboards);
        _activeId = activeId;
        _editingName = string.Empty;
        SupportsTemplates = supportsTemplates;
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a layout is selected (web <c>onSwitch(id)</c>).</summary>
    public event EventHandler<string>? SwitchRequested;

    /// <summary>Raised with the trimmed new name when a layout is created inline (web <c>onCreate(name)</c>).</summary>
    public event EventHandler<string>? CreateRequested;

    /// <summary>Raised when a rename is confirmed with a non-empty name (web <c>onRename(id, name)</c>).</summary>
    public event EventHandler<LayoutRenameRequest>? RenameRequested;

    /// <summary>Raised when a non-default layout is deleted (web <c>onDelete(id)</c>).</summary>
    public event EventHandler<string>? DeleteRequested;

    /// <summary>Raised when a layout is duplicated (web <c>onDuplicate(id)</c>).</summary>
    public event EventHandler<string>? DuplicateRequested;

    /// <summary>Raised when a layout's settings are opened (web <c>onOpenSettings(id)</c>).</summary>
    public event EventHandler<string>? OpenSettingsRequested;

    /// <summary>Raised when a drag reorder is dropped on a new index (web <c>onReorder(from, to)</c>).</summary>
    public event EventHandler<LayoutReorderRequest>? ReorderRequested;

    /// <summary>Raised when the template picker should open (web <c>onOpenTemplates()</c>).</summary>
    public event EventHandler? OpenTemplatesRequested;

    /// <summary>True when a template picker is wired — the "New Layout" affordance opens it instead of inline create.</summary>
    public bool SupportsTemplates { get; }

    /// <summary>The current saved layouts, in display order.</summary>
    public IReadOnlyList<LayoutDashboard> Dashboards => _dashboards;

    /// <summary>The active layout id (the highlighted tab), or <see langword="null"/>.</summary>
    public string? ActiveId => _activeId;

    /// <summary>The id of the layout currently being renamed inline, or <see langword="null"/>.</summary>
    public string? EditingId => _editingId;

    /// <summary>True when a layout is being renamed inline (web <c>editingId !== null</c>).</summary>
    public bool IsEditing => _editingId is not null;

    /// <summary>The seed text for the rename field (the layout's current name, web <c>editName</c>).</summary>
    public string EditingName => _editingName;

    /// <summary>True when the inline create field is open (web <c>isCreating</c>).</summary>
    public bool IsCreating => _isCreating;

    /// <summary>The projected, render-ready display for the current layouts.</summary>
    public LayoutManagerDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(State));
            Raise(nameof(Tabs));
            Raise(nameof(HasTabs));
        }
    }

    /// <summary>The current mutually-exclusive surface state.</summary>
    public LayoutManagerState State => _display.State;

    /// <summary>The projected, localized layout tabs.</summary>
    public IReadOnlyList<LayoutTab> Tabs => _display.Tabs;

    /// <summary>True when at least one layout tab is present.</summary>
    public bool HasTabs => _display.Tabs.Count > 0;

    /// <summary>
    /// Replace the layout collection (and optionally the active id) and re-project — the native analogue of the
    /// parent re-rendering the web component with new <c>dashboards</c> / <c>activeId</c> props after handling a
    /// mutation. If the layout being renamed inline is no longer present, the rename is cancelled so the editor
    /// never dangles over a removed tab.
    /// </summary>
    /// <param name="dashboards">The new saved layouts (null is treated as empty).</param>
    /// <param name="activeId">The new active id; pass <see langword="null"/> to leave the current one unchanged.</param>
    public void UpdateDashboards(IReadOnlyList<LayoutDashboard>? dashboards, string? activeId = null)
    {
        _dashboards = dashboards is null ? new List<LayoutDashboard>() : new List<LayoutDashboard>(dashboards);
        if (activeId is not null)
        {
            _activeId = activeId;
            Raise(nameof(ActiveId));
        }

        if (_editingId is not null && !_dashboards.Exists(d => string.Equals(d.Id, _editingId, StringComparison.Ordinal)))
        {
            ClearEditing();
        }

        Display = Project();
    }

    /// <summary>
    /// Select a layout — raises <see cref="SwitchRequested"/> and optimistically marks it active so the strip
    /// highlights immediately (web <c>onSwitch(id)</c> reflected through the re-rendered <c>activeId</c>).
    /// </summary>
    /// <param name="id">The id of the layout to activate.</param>
    public void Select(string id)
    {
        ArgumentNullException.ThrowIfNull(id);

        SwitchRequested?.Invoke(this, id);
        if (!string.Equals(_activeId, id, StringComparison.Ordinal))
        {
            _activeId = id;
            Raise(nameof(ActiveId));
            Display = Project();
        }
    }

    /// <summary>
    /// Begin creating a layout — opens the template picker when one is wired (web <c>startCreate</c> early
    /// return), otherwise opens the inline create field with an empty value (web <c>setIsCreating(true)</c>).
    /// </summary>
    public void BeginCreate()
    {
        if (SupportsTemplates)
        {
            OpenTemplatesRequested?.Invoke(this, EventArgs.Empty);
            return;
        }

        if (_editingId is not null)
        {
            ClearEditing();
        }

        if (!_isCreating)
        {
            _isCreating = true;
            Raise(nameof(IsCreating));
        }
    }

    /// <summary>
    /// Confirm the inline create — raises <see cref="CreateRequested"/> with the trimmed name only when it is
    /// non-empty (web <c>if (newName.trim()) onCreate(newName.trim())</c>) and always closes the field (web
    /// <c>setIsCreating(false)</c>).
    /// </summary>
    /// <param name="name">The raw name typed into the create field (null is treated as empty).</param>
    public void ConfirmCreate(string? name)
    {
        string trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length > 0)
        {
            CreateRequested?.Invoke(this, trimmed);
        }

        CancelCreate();
    }

    /// <summary>Cancel the inline create and close the field (web <c>setIsCreating(false)</c>).</summary>
    public void CancelCreate()
    {
        if (_isCreating)
        {
            _isCreating = false;
            Raise(nameof(IsCreating));
        }
    }

    /// <summary>
    /// Begin renaming a layout inline — seeds the field with the layout's current name and closes the create
    /// field if open (web <c>startRename</c>). A no-op for an unknown id.
    /// </summary>
    /// <param name="id">The id of the layout to rename.</param>
    public void BeginRename(string id)
    {
        ArgumentNullException.ThrowIfNull(id);

        LayoutDashboard? target = _dashboards.Find(d => string.Equals(d.Id, id, StringComparison.Ordinal));
        if (target is null)
        {
            return;
        }

        CancelCreate();
        _editingId = id;
        _editingName = target.Name ?? string.Empty;
        Raise(nameof(EditingId));
        Raise(nameof(IsEditing));
        Raise(nameof(EditingName));
    }

    /// <summary>
    /// Confirm the inline rename — raises <see cref="RenameRequested"/> with the trimmed name only when it is
    /// non-empty (web <c>if (editingId &amp;&amp; editName.trim()) onRename(...)</c>) and always ends editing (web
    /// <c>setEditingId(null)</c>).
    /// </summary>
    /// <param name="name">The raw name typed into the rename field (null is treated as empty).</param>
    public void ConfirmRename(string? name)
    {
        string? id = _editingId;
        string trimmed = (name ?? string.Empty).Trim();
        if (id is not null && trimmed.Length > 0)
        {
            RenameRequested?.Invoke(this, new LayoutRenameRequest(id, trimmed));
        }

        CancelRename();
    }

    /// <summary>Cancel the inline rename and end editing (web <c>setEditingId(null)</c>).</summary>
    public void CancelRename()
    {
        if (_editingId is not null)
        {
            ClearEditing();
        }
    }

    /// <summary>Duplicate a layout (web <c>onDuplicate(id)</c>).</summary>
    /// <param name="id">The id of the layout to duplicate.</param>
    public void Duplicate(string id)
    {
        ArgumentNullException.ThrowIfNull(id);
        DuplicateRequested?.Invoke(this, id);
    }

    /// <summary>Open a layout's settings (web <c>onOpenSettings(id)</c>).</summary>
    /// <param name="id">The id of the layout whose settings to open.</param>
    public void OpenSettings(string id)
    {
        ArgumentNullException.ThrowIfNull(id);
        OpenSettingsRequested?.Invoke(this, id);
    }

    /// <summary>
    /// Delete a layout — raises <see cref="DeleteRequested"/> unless the layout is the default one, which is
    /// non-deletable (web <c>disabled={!!ctxDash.isDefault}</c>). A no-op for an unknown id.
    /// </summary>
    /// <param name="id">The id of the layout to delete.</param>
    public void Delete(string id)
    {
        ArgumentNullException.ThrowIfNull(id);

        LayoutDashboard? target = _dashboards.Find(d => string.Equals(d.Id, id, StringComparison.Ordinal));
        if (target is null || target.IsDefault)
        {
            return;
        }

        DeleteRequested?.Invoke(this, id);
    }

    /// <summary>
    /// Reorder the layouts after a drag-and-drop — raises <see cref="ReorderRequested"/> and applies the move
    /// optimistically so the strip updates without a round-trip (web <c>handleDrop</c>). A no-op move or an
    /// out-of-range index leaves the order untouched (web <c>dragIndex !== targetIndex</c>).
    /// </summary>
    /// <param name="from">The source index of the dragged layout.</param>
    /// <param name="to">The destination index it was dropped on.</param>
    public void Reorder(int from, int to)
    {
        if (from < 0 || from >= _dashboards.Count || to < 0 || to >= _dashboards.Count || from == to)
        {
            return;
        }

        ReorderRequested?.Invoke(this, new LayoutReorderRequest(from, to));
        _dashboards = new List<LayoutDashboard>(LayoutManagerProjection.Reorder(_dashboards, from, to));
        Raise(nameof(Dashboards));
        Display = Project();
    }

    /// <summary>Open the template picker (web <c>onOpenTemplates()</c>) when one is wired.</summary>
    public void OpenTemplates()
    {
        if (SupportsTemplates)
        {
            OpenTemplatesRequested?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <summary>
    /// Re-resolve every label from the localizer and re-project — the native analogue of react-i18next
    /// re-rendering the strip after the active language changes.
    /// </summary>
    public void Reload() => Display = Project();

    private void ClearEditing()
    {
        _editingId = null;
        _editingName = string.Empty;
        Raise(nameof(EditingId));
        Raise(nameof(IsEditing));
        Raise(nameof(EditingName));
    }

    private LayoutManagerDisplay Project() =>
        LayoutManagerProjection.Project(_dashboards, _activeId, _localizer);

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
