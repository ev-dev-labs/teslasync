namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data seam the <see cref="DataTableColumnsMenuViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the props the web <c>DataTableColumnsMenu</c> receives from its parent
/// (web/src/components/ui/DataTableColumnsMenu.tsx L13-L20: <c>columns</c>, <c>visibleKeys</c> and the
/// <c>onChange</c> callback). The web component is fully controlled: the parent (the owning <c>DataTable</c>,
/// which persists via <c>tableId</c>) owns the column + visible-key state and the child reports new
/// visible-key sets through <c>onChange</c>. This seam plays the parent's role: it holds the current state,
/// applies a new visible-key set through <see cref="Apply"/> (web <c>onChange</c>) and raises
/// <see cref="Changed"/> whenever the state is reassigned. The view never touches HTTP and never owns the
/// state; it observes the view-model and drives the mutators.
/// </summary>
public interface IDataTableColumnsSource
{
    /// <summary>The columns the chooser lists, in display order (never null).</summary>
    IReadOnlyList<DataTableColumnDescriptor> Columns { get; }

    /// <summary>The currently visible column keys (web <c>visibleKeys</c>); never null.</summary>
    IReadOnlyList<string> VisibleKeys { get; }

    /// <summary>Raised whenever the columns or the visible-key set is reassigned.</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Apply a new visible-key set (web <c>onChange(next)</c>): the parent's state is updated and the surface
    /// re-projects. A null set falls back to empty so the view-model never dereferences null.
    /// </summary>
    void Apply(IReadOnlyList<string> visibleKeys);
}

/// <summary>
/// The in-memory <see cref="IDataTableColumnsSource"/> — the canonical state holder a page (or a test) drives.
/// It mirrors the controlled web <c>DataTableColumnsMenu</c>'s parent: <see cref="Apply"/> is the child's
/// <c>onChange</c> reaching the parent (it stores the new visible-key set and also raises
/// <see cref="VisibleKeysChanged"/> so a host can persist it — the web <c>DataTable</c>'s <c>tableId</c>
/// persistence), while <see cref="SetColumns"/> / <see cref="SetVisibleKeys"/> are the parent pushing fresh
/// state down (web prop changes). Each raises <see cref="Changed"/> so the bound view-model re-projects. Null
/// assignments fall back to empty sets so the view-model never dereferences null.
/// </summary>
public sealed class DataTableColumnsSource : IDataTableColumnsSource
{
    private IReadOnlyList<DataTableColumnDescriptor> _columns;
    private IReadOnlyList<string> _visibleKeys;

    /// <summary>Creates an empty source (no columns, nothing visible) — the headless / gallery default.</summary>
    public DataTableColumnsSource()
        : this(Array.Empty<DataTableColumnDescriptor>(), Array.Empty<string>())
    {
    }

    /// <summary>Creates a source seeded with an initial column set and visible-key set.</summary>
    public DataTableColumnsSource(
        IReadOnlyList<DataTableColumnDescriptor> columns,
        IReadOnlyList<string> visibleKeys)
    {
        _columns = columns ?? Array.Empty<DataTableColumnDescriptor>();
        _visibleKeys = visibleKeys ?? Array.Empty<string>();
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <summary>Raised when the surface applies a new visible-key set (web <c>onChange(next)</c>).</summary>
    public event EventHandler<IReadOnlyList<string>>? VisibleKeysChanged;

    /// <inheritdoc />
    public IReadOnlyList<DataTableColumnDescriptor> Columns => _columns;

    /// <inheritdoc />
    public IReadOnlyList<string> VisibleKeys => _visibleKeys;

    /// <inheritdoc />
    public void Apply(IReadOnlyList<string> visibleKeys)
    {
        _visibleKeys = visibleKeys ?? Array.Empty<string>();
        RaiseChanged();
        VisibleKeysChanged?.Invoke(this, _visibleKeys);
    }

    /// <summary>Replace the column set (a null falls back to empty) and notify (web <c>columns</c> prop change).</summary>
    public void SetColumns(IReadOnlyList<DataTableColumnDescriptor> columns)
    {
        _columns = columns ?? Array.Empty<DataTableColumnDescriptor>();
        RaiseChanged();
    }

    /// <summary>Replace the visible-key set from the host (a null falls back to empty) and notify, without re-firing <see cref="VisibleKeysChanged"/>.</summary>
    public void SetVisibleKeys(IReadOnlyList<string> visibleKeys)
    {
        _visibleKeys = visibleKeys ?? Array.Empty<string>();
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
