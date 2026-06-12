namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The data seam the <see cref="WidgetStatusGridViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the props the web <c>WidgetStatusGrid</c> receives from its parent widget
/// (web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx L13-L19). The web component is purely
/// presentational and never fetches; likewise this seam simply holds the resolved
/// <see cref="WidgetStatusGridInput"/> (the cells, column request, compact flag and empty copy) and raises
/// <see cref="Changed"/> when it is reassigned — the analogue of the parent re-rendering with new props. The
/// view never touches this seam or HTTP directly; it observes the view-model.
/// </summary>
public interface IWidgetStatusGridSource
{
    /// <summary>The current grid inputs (cells, columns, compact flag, empty copy); never null.</summary>
    WidgetStatusGridInput Input { get; }

    /// <summary>Raised whenever the input is reassigned.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IWidgetStatusGridSource"/> — the canonical holder a consuming widget (or a test)
/// pushes the grid inputs into. It mirrors a parent passing fresh props to the web <c>WidgetStatusGrid</c>:
/// <see cref="SetInput"/> replaces the whole input, <see cref="SetCells"/> swaps just the cell list,
/// <see cref="SetColumns"/> changes the column request, <see cref="SetCompact"/> toggles the compact flag and
/// <see cref="SetEmpty"/> publishes the empty-surface copy, each raising <see cref="Changed"/> so the bound
/// view-model re-projects. A null assignment falls back to a safe default so the view-model never
/// dereferences null.
/// </summary>
public sealed class WidgetStatusGridSource : IWidgetStatusGridSource
{
    private WidgetStatusGridInput _input;

    /// <summary>Creates an empty source (no cells, two columns, the shared default empty message).</summary>
    public WidgetStatusGridSource()
        : this(new WidgetStatusGridInput())
    {
    }

    /// <summary>Creates a source seeded with an initial input.</summary>
    public WidgetStatusGridSource(WidgetStatusGridInput input) => _input = input ?? new WidgetStatusGridInput();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public WidgetStatusGridInput Input => _input;

    /// <summary>Replace the whole input (a null falls back to the default input) and notify.</summary>
    public void SetInput(WidgetStatusGridInput input)
    {
        _input = input ?? new WidgetStatusGridInput();
        RaiseChanged();
    }

    /// <summary>Swap just the cell list, keeping the column request, compact flag and empty copy.</summary>
    public void SetCells(IReadOnlyList<WidgetStatusCell> cells)
    {
        _input = _input with { Cells = cells ?? [] };
        RaiseChanged();
    }

    /// <summary>Change just the requested column count (web <c>cols</c>), keeping every other input.</summary>
    public void SetColumns(int cols)
    {
        if (_input.Cols == cols)
        {
            return;
        }

        _input = _input with { Cols = cols };
        RaiseChanged();
    }

    /// <summary>Toggle the compact flag (web <c>compact</c>), keeping every other input.</summary>
    public void SetCompact(bool compact)
    {
        if (_input.Compact == compact)
        {
            return;
        }

        _input = _input with { Compact = compact };
        RaiseChanged();
    }

    /// <summary>Publish the empty-surface copy (web <c>emptyMessage</c> / <c>emptyIcon</c>), keeping the cells.</summary>
    public void SetEmpty(string? message, string? iconGlyph = null)
    {
        _input = _input with { EmptyMessage = message, EmptyIconGlyph = iconGlyph };
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
