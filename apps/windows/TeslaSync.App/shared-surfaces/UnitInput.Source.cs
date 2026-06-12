namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data seam the <see cref="UnitInputViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the props the web <c>&lt;UnitInput&gt;</c> receives from its parent plus the
/// <c>useSettings()</c> slice it reads and re-syncs against (web/src/components/forms/UnitInput.tsx). The
/// web component is presentational and fetches nothing; likewise this seam simply holds the resolved
/// <see cref="Props"/> (the canonical value, the unit family, the display settings, the labels and the
/// disabled / error flags) and raises <see cref="Changed"/> when any of them is reassigned — the analogue
/// of the parent re-rendering with a new <c>value</c> or the settings holder publishing a new unit
/// preference / locale. The view never touches this seam or any HTTP directly; it observes the view-model,
/// which re-projects on <see cref="Changed"/>.
/// </summary>
public interface IUnitInputSource
{
    /// <summary>The current presentational inputs (value, unit, settings, labels, flags); never null.</summary>
    UnitInputProps Props { get; }

    /// <summary>Raised whenever the props are reassigned (a parent re-render or a settings change).</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IUnitInputSource"/> — the canonical holder a page (or a test) pushes the
/// field's inputs into. It mirrors a parent passing fresh props to the web <c>&lt;UnitInput&gt;</c>:
/// <see cref="SetProps"/> replaces the whole input, <see cref="SetValue"/> moves just the canonical value
/// (the analogue of the parent re-rendering with a new <c>value</c> after handling <c>onChange</c>),
/// <see cref="SetSettings"/> publishes a new display context (the analogue of <c>useSettings()</c>
/// changing), <see cref="SetUnit"/> changes the unit family, and <see cref="SetDisabled"/> /
/// <see cref="SetHasError"/> toggle the passthrough flags — each raising <see cref="Changed"/> so the bound
/// view-model re-projects. A null assignment falls back to a safe default so the view-model never
/// dereferences null.
/// </summary>
public sealed class UnitInputSource : IUnitInputSource
{
    private UnitInputProps _props;

    /// <summary>Creates an empty source (a null distance value at the default settings).</summary>
    public UnitInputSource()
        : this(new UnitInputProps())
    {
    }

    /// <summary>Creates a source seeded with an initial set of inputs (a null falls back to the default props).</summary>
    /// <param name="props">The initial inputs.</param>
    public UnitInputSource(UnitInputProps props) => _props = props ?? new UnitInputProps();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public UnitInputProps Props => _props;

    /// <summary>Replace the whole input (a null falls back to the default props) and notify.</summary>
    /// <param name="props">The new inputs.</param>
    public void SetProps(UnitInputProps props)
    {
        _props = props ?? new UnitInputProps();
        RaiseChanged();
    }

    /// <summary>
    /// Move just the canonical value, keeping every other input — the analogue of the parent re-rendering
    /// with a new <c>value</c> prop after handling the field's <c>onChange</c>.
    /// </summary>
    /// <param name="value">The new canonical value, or null to clear.</param>
    public void SetValue(double? value)
    {
        if (Nullable.Equals(_props.Value, value))
        {
            return;
        }

        _props = _props with { Value = value };
        RaiseChanged();
    }

    /// <summary>
    /// Publish a new display context (web <c>useSettings()</c> changing the unit preference / locale /
    /// precision / currency symbol), keeping the value, unit and labels. A null falls back to the defaults.
    /// </summary>
    /// <param name="settings">The new display settings.</param>
    public void SetSettings(UnitInputSettings settings)
    {
        _props = _props with { Settings = settings ?? new UnitInputSettings() };
        RaiseChanged();
    }

    /// <summary>Change the unit family (web <c>unit</c>), keeping every other input.</summary>
    /// <param name="unit">The new unit family.</param>
    public void SetUnit(UnitInputKind unit)
    {
        if (_props.Unit == unit)
        {
            return;
        }

        _props = _props with { Unit = unit };
        RaiseChanged();
    }

    /// <summary>Toggle the passthrough disabled flag (web <c>disabled</c>), keeping every other input.</summary>
    /// <param name="disabled">Whether the field is disabled.</param>
    public void SetDisabled(bool disabled)
    {
        if (_props.Disabled == disabled)
        {
            return;
        }

        _props = _props with { Disabled = disabled };
        RaiseChanged();
    }

    /// <summary>Toggle the passthrough error flag (web <c>error</c>), keeping every other input.</summary>
    /// <param name="hasError">Whether the field is in the error state.</param>
    public void SetHasError(bool hasError)
    {
        if (_props.HasError == hasError)
        {
            return;
        }

        _props = _props with { HasError = hasError };
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
