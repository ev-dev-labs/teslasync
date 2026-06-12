using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.CheckboxSurface;

/// <summary>
/// The change-notification payload for the <see cref="CheckboxViewModel.CheckedChanged"/> event — the native
/// analogue of the boolean the web <c>onChange(checked)</c> callback receives
/// (<c>web/src/components/ui/Checkbox.tsx</c>). Raised only on a user-driven toggle, never on a controlled
/// property assignment, exactly like the web change handler.
/// </summary>
public sealed class CheckboxCheckedChangedEventArgs : EventArgs
{
    /// <summary>Creates the payload for the new checked value.</summary>
    /// <param name="isChecked">The checked value after the toggle (web <c>e.target.checked</c>).</param>
    public CheckboxCheckedChangedEventArgs(bool isChecked) => IsChecked = isChecked;

    /// <summary>The checked value reported to the change handler (web <c>e.target.checked</c>).</summary>
    public bool IsChecked { get; }
}

/// <summary>
/// The state holder the <c>Checkbox</c> view binds to (P1/S8 state-holder layer) — the native port of the web
/// <c>Checkbox</c> component's controlled / uncontrolled state (<c>web/src/components/ui/Checkbox.tsx</c>). It
/// owns the immutable <see cref="CheckboxState"/> and projects the web props (<see cref="IsChecked"/>,
/// <see cref="IsIndeterminate"/>, <see cref="IsDisabled"/>, <see cref="Size"/>, <see cref="Label"/>) as
/// observable members. Assigning a property is the controlled path (web re-render with new props): it raises
/// <see cref="INotifyPropertyChanged"/> so the view refreshes, but does NOT fire
/// <see cref="CheckedChanged"/>. <see cref="Toggle"/> is the user-interaction path (web click → the input's
/// <c>onChange</c>): it applies the pure <see cref="CheckboxState.Toggle"/> transition and fires
/// <see cref="CheckedChanged"/> with the new boolean. The view performs no I/O; it binds to this holder.
/// </summary>
public sealed class CheckboxViewModel : INotifyPropertyChanged
{
    private CheckboxState _state;

    /// <summary>Creates the holder over an initial render state (the web initial props).</summary>
    /// <param name="isChecked">The initial checked value (web <c>checked</c> / <c>defaultChecked</c>).</param>
    /// <param name="isIndeterminate">The initial mixed state (web <c>indeterminate</c>).</param>
    /// <param name="isDisabled">Whether the checkbox starts disabled (web <c>disabled</c>).</param>
    /// <param name="size">The visual size (web <c>size</c>, default <see cref="CheckboxSize.Md"/>).</param>
    /// <param name="label">The optional inline label, already localized by the caller (web <c>label</c>).</param>
    public CheckboxViewModel(
        bool isChecked = false,
        bool isIndeterminate = false,
        bool isDisabled = false,
        CheckboxSize size = CheckboxSize.Md,
        string? label = null) =>
        _state = new CheckboxState(isChecked, isIndeterminate, isDisabled, size, label);

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a user toggle changes the checked value (the web <c>onChange</c> callback).</summary>
    public event EventHandler<CheckboxCheckedChangedEventArgs>? CheckedChanged;

    /// <summary>The current immutable render state (exposed for hosting / diagnostics / tests).</summary>
    public CheckboxState State => _state;

    /// <summary>Whether the box is checked (web <c>checked</c>); the controlled setter raises change notification only.</summary>
    public bool IsChecked
    {
        get => _state.IsChecked;
        set => ApplyState(_state with { IsChecked = value });
    }

    /// <summary>Whether the box shows the mixed dash (web <c>indeterminate</c>); overrides checked.</summary>
    public bool IsIndeterminate
    {
        get => _state.IsIndeterminate;
        set => ApplyState(_state with { IsIndeterminate = value });
    }

    /// <summary>Whether the box is non-interactive and dimmed (web <c>disabled</c>).</summary>
    public bool IsDisabled
    {
        get => _state.IsDisabled;
        set => ApplyState(_state with { IsDisabled = value });
    }

    /// <summary>The visual size (web <c>size</c>).</summary>
    public CheckboxSize Size
    {
        get => _state.Size;
        set => ApplyState(_state with { Size = value });
    }

    /// <summary>The optional inline label, already localized by the caller (web <c>label</c>).</summary>
    public string? Label
    {
        get => _state.Label;
        set => ApplyState(_state with { Label = value });
    }

    /// <summary>The projected visual state (indeterminate &gt; checked &gt; unchecked).</summary>
    public CheckboxToggleState ToggleState => _state.ToggleState;

    /// <summary>
    /// Apply a user toggle (the web click → <c>onChange</c> path). A disabled checkbox is a no-op (web
    /// <c>if (disabled) return;</c>). On a real change the state is updated, change notification is raised and
    /// <see cref="CheckedChanged"/> fires with the new boolean.
    /// </summary>
    /// <returns><see langword="true"/> when the toggle changed the checked value; otherwise <see langword="false"/>.</returns>
    public bool Toggle()
    {
        CheckboxToggleResult result = _state.Toggle();
        if (!result.Changed)
        {
            return false;
        }

        ApplyState(result.State);
        CheckedChanged?.Invoke(this, new CheckboxCheckedChangedEventArgs(result.IsChecked));
        return true;
    }

    private void ApplyState(CheckboxState next)
    {
        CheckboxState previous = _state;
        if (previous == next)
        {
            return;
        }

        _state = next;

        if (previous.IsChecked != next.IsChecked)
        {
            Raise(nameof(IsChecked));
        }

        if (previous.IsIndeterminate != next.IsIndeterminate)
        {
            Raise(nameof(IsIndeterminate));
        }

        if (previous.IsDisabled != next.IsDisabled)
        {
            Raise(nameof(IsDisabled));
        }

        if (previous.Size != next.Size)
        {
            Raise(nameof(Size));
        }

        if (previous.Label != next.Label)
        {
            Raise(nameof(Label));
        }

        if (previous.ToggleState != next.ToggleState)
        {
            Raise(nameof(ToggleState));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
