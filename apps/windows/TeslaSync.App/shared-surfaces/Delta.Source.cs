namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data seam the <see cref="DeltaViewModel"/> binds to (P1/S8 state-holder seam) — the native analogue of
/// the props the web <c>Delta</c> receives from its parent and the units/currency context it reads from
/// <c>useUnits()</c> / <c>useFormatting()</c> (web/src/components/data-display/Delta.tsx). The web component is
/// presentational and never fetches; likewise this seam simply holds the resolved <see cref="Input"/> (the
/// metric, values, display mode, comparedTo and flags) and the <see cref="Context"/> (the user's unit + currency
/// preferences) and raises <see cref="Changed"/> when either is reassigned — the analogue of the parent
/// re-rendering with new props or the settings holder publishing a new unit preference. The view never touches
/// this seam or HTTP directly; it observes the view-model.
/// </summary>
public interface IDeltaSource
{
    /// <summary>The current indicator inputs (metric, values, display mode, comparedTo, flags); never null.</summary>
    DeltaInput Input { get; }

    /// <summary>The current unit + currency display context; never null.</summary>
    DeltaUnitContext Context { get; }

    /// <summary>Raised whenever the input or the unit context changes.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IDeltaSource"/> — the canonical holder a page (or a test) pushes the indicator
/// inputs and the active unit context into. It mirrors a parent passing fresh props to the web <c>Delta</c>:
/// <see cref="SetInput"/> replaces the whole input, <see cref="SetValues"/> moves just the current/previous
/// pair, <see cref="SetLoading"/> toggles the skeleton and <see cref="SetContext"/> publishes a new unit
/// preference, each raising <see cref="Changed"/> so the bound view-model re-projects. A null assignment falls
/// back to a safe default so the view-model never dereferences null.
/// </summary>
public sealed class DeltaSource : IDeltaSource
{
    private DeltaInput _input;
    private DeltaUnitContext _context;

    /// <summary>Creates an empty source (a neutral, unit-less metric with no values, the metric unit context).</summary>
    public DeltaSource()
        : this(new DeltaInput(), DeltaUnitContext.Metric)
    {
    }

    /// <summary>Creates a source seeded with an initial input and unit context.</summary>
    public DeltaSource(DeltaInput input, DeltaUnitContext context)
    {
        _input = input ?? new DeltaInput();
        _context = context ?? DeltaUnitContext.Metric;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public DeltaInput Input => _input;

    /// <inheritdoc />
    public DeltaUnitContext Context => _context;

    /// <summary>Replace the whole input (a null falls back to the default input) and notify.</summary>
    public void SetInput(DeltaInput input)
    {
        _input = input ?? new DeltaInput();
        RaiseChanged();
    }

    /// <summary>
    /// Move just the current/previous pair, keeping every other input flag — the analogue of the parent passing
    /// new <c>current</c> / <c>previous</c> props while the metric, display mode and comparedTo stay put.
    /// </summary>
    public void SetValues(double? current, double? previous)
    {
        _input = _input with { Current = current, Previous = previous };
        RaiseChanged();
    }

    /// <summary>Toggle the forced loading skeleton (web <c>loading</c> prop), keeping every other input.</summary>
    public void SetLoading(bool loading)
    {
        if (_input.Loading == loading)
        {
            return;
        }

        _input = _input with { Loading = loading };
        RaiseChanged();
    }

    /// <summary>Publish a new unit + currency context (a null falls back to the metric context) and notify.</summary>
    public void SetContext(DeltaUnitContext context)
    {
        _context = context ?? DeltaUnitContext.Metric;
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
