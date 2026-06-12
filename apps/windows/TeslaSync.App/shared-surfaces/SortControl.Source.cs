using TeslaSync.App.Core;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data seam the <see cref="SortControlViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the props the web <c>SortControl</c> receives from its parent
/// (web/src/components/forms/SortControl.tsx L15-L27: <c>field</c>, <c>direction</c>, <c>options</c> and the
/// optional <c>directionAriaLabel</c>). The web component is fully controlled — the parent owns the state and
/// the child reports changes through <c>onFieldChange</c> / <c>onDirectionChange</c>. This seam plays the
/// parent's role: it holds the current state and raises <see cref="Changed"/> when any of it is reassigned.
/// The view never touches HTTP and never owns the state; it observes the view-model and drives the mutators.
/// </summary>
public interface ISortControlSource
{
    /// <summary>The field options to choose from (never null).</summary>
    IReadOnlyList<SortControlOption> Options { get; }

    /// <summary>The currently selected field key (web <c>field</c>); never null.</summary>
    string Field { get; }

    /// <summary>The current sort direction (web <c>direction</c>).</summary>
    SortDirection Direction { get; }

    /// <summary>An explicit accessible label for the direction toggle (web <c>directionAriaLabel</c>), or null.</summary>
    string? DirectionAccessibleLabel { get; }

    /// <summary>Raised whenever the options, field, direction or accessible label changes.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="ISortControlSource"/> — the canonical state holder a page (or a test) drives. It
/// mirrors the controlled web <c>SortControl</c>'s parent: <see cref="SetField"/> selects a new field
/// (web <c>onFieldChange</c>), <see cref="ToggleDirection"/> flips ascending ↔ descending (web <c>flip</c> /
/// <c>onDirectionChange</c>, L51), <see cref="SetDirection"/> sets it explicitly, and <see cref="SetOptions"/>
/// replaces the option set — each raising <see cref="Changed"/> so the bound view-model re-projects. The
/// specific <see cref="FieldChanged"/> / <see cref="DirectionChanged"/> events mirror the web callbacks so a
/// host can react to exactly what the user changed. A null assignment falls back to a safe default so the
/// view-model never dereferences null.
/// </summary>
public sealed class SortControlSource : ISortControlSource
{
    private IReadOnlyList<SortControlOption> _options;
    private string _field;
    private SortDirection _direction;
    private string? _directionAccessibleLabel;

    /// <summary>Creates an empty source (no options, no selected field, ascending).</summary>
    public SortControlSource()
        : this(Array.Empty<SortControlOption>(), string.Empty, SortDirection.Ascending)
    {
    }

    /// <summary>Creates a source seeded with an initial option set, field, direction and optional toggle label.</summary>
    public SortControlSource(
        IReadOnlyList<SortControlOption> options,
        string field,
        SortDirection direction,
        string? directionAccessibleLabel = null)
    {
        _options = options ?? Array.Empty<SortControlOption>();
        _field = field ?? string.Empty;
        _direction = Normalize(direction);
        _directionAccessibleLabel = string.IsNullOrEmpty(directionAccessibleLabel) ? null : directionAccessibleLabel;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <summary>Raised when the selected field changes (web <c>onFieldChange(field)</c>).</summary>
    public event EventHandler<string>? FieldChanged;

    /// <summary>Raised when the direction changes (web <c>onDirectionChange(dir)</c>).</summary>
    public event EventHandler<SortDirection>? DirectionChanged;

    /// <inheritdoc />
    public IReadOnlyList<SortControlOption> Options => _options;

    /// <inheritdoc />
    public string Field => _field;

    /// <inheritdoc />
    public SortDirection Direction => _direction;

    /// <inheritdoc />
    public string? DirectionAccessibleLabel => _directionAccessibleLabel;

    /// <summary>Replace the option set (a null falls back to an empty set) and notify.</summary>
    public void SetOptions(IReadOnlyList<SortControlOption> options)
    {
        _options = options ?? Array.Empty<SortControlOption>();
        RaiseChanged();
    }

    /// <summary>Select a new field (web <c>onFieldChange</c>); a no-op when unchanged. Raises <see cref="FieldChanged"/>.</summary>
    public void SetField(string field)
    {
        string next = field ?? string.Empty;
        if (string.Equals(_field, next, StringComparison.Ordinal))
        {
            return;
        }

        _field = next;
        RaiseChanged();
        FieldChanged?.Invoke(this, _field);
    }

    /// <summary>Set the direction explicitly; a no-op when unchanged. Raises <see cref="DirectionChanged"/>.</summary>
    public void SetDirection(SortDirection direction)
    {
        SortDirection next = Normalize(direction);
        if (_direction == next)
        {
            return;
        }

        _direction = next;
        RaiseChanged();
        DirectionChanged?.Invoke(this, _direction);
    }

    /// <summary>
    /// Flip the direction ascending ↔ descending — the native port of the web <c>flip</c> handler (L51). Always
    /// changes state, raising <see cref="DirectionChanged"/>; returns the new direction.
    /// </summary>
    public SortDirection ToggleDirection()
    {
        _direction = _direction == SortDirection.Ascending ? SortDirection.Descending : SortDirection.Ascending;
        RaiseChanged();
        DirectionChanged?.Invoke(this, _direction);
        return _direction;
    }

    /// <summary>Publish an explicit toggle accessible label (web <c>directionAriaLabel</c>); empty clears it.</summary>
    public void SetDirectionAccessibleLabel(string? label)
    {
        _directionAccessibleLabel = string.IsNullOrEmpty(label) ? null : label;
        RaiseChanged();
    }

    private static SortDirection Normalize(SortDirection direction) =>
        direction == SortDirection.Descending ? SortDirection.Descending : SortDirection.Ascending;

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
