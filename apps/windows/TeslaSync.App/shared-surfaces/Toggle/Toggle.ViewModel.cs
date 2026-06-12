using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.ToggleSurface;

/// <summary>
/// The change-notification payload for the <see cref="ToggleViewModel.CheckedChanged"/> event — the native
/// analogue of the boolean the web <c>onChange(checked)</c> callback receives
/// (<c>web/src/components/ui/Toggle.tsx</c>). Raised only on a user-driven toggle, never on a controlled
/// property assignment, exactly like the web change handler.
/// </summary>
public sealed class ToggleCheckedChangedEventArgs : EventArgs
{
    /// <summary>Creates the payload for the new checked value.</summary>
    /// <param name="isChecked">The checked value after the toggle (web <c>onChange(!checked)</c>).</param>
    public ToggleCheckedChangedEventArgs(bool isChecked) => IsChecked = isChecked;

    /// <summary>The checked value reported to the change handler (web <c>onChange</c> argument).</summary>
    public bool IsChecked { get; }
}

/// <summary>
/// The state holder the <c>Toggle</c> view binds to (P1/S8 state-holder layer) — the native port of the web
/// <c>Toggle</c> component's controlled state (<c>web/src/components/ui/Toggle.tsx</c>). It owns the immutable
/// <see cref="ToggleState"/> and projects the web props (<see cref="IsChecked"/>, <see cref="Size"/>,
/// <see cref="Label"/>) as observable members. Assigning a property is the controlled path (web re-render with
/// new props): it raises <see cref="INotifyPropertyChanged"/> so the view refreshes, but does NOT fire
/// <see cref="CheckedChanged"/>. <see cref="Toggle"/> is the user-interaction path (web click → the button's
/// <c>onChange(!checked)</c>): it applies the pure <see cref="ToggleState.Toggle"/> transition and fires
/// <see cref="CheckedChanged"/> with the new boolean. The view performs no I/O; it binds to this holder.
/// </summary>
public sealed class ToggleViewModel : INotifyPropertyChanged
{
    private ToggleState _state;

    /// <summary>Creates the holder over an initial render state (the web initial props).</summary>
    /// <param name="isChecked">The initial on/off value (web <c>checked</c>).</param>
    /// <param name="size">The visual size (web <c>size</c>, default <see cref="ToggleSize.Md"/>).</param>
    /// <param name="label">The optional inline label, already localized by the caller (web <c>label</c>).</param>
    public ToggleViewModel(
        bool isChecked = false,
        ToggleSize size = ToggleSize.Md,
        string? label = null) =>
        _state = new ToggleState(isChecked, size, label);

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a user toggle changes the checked value (the web <c>onChange</c> callback).</summary>
    public event EventHandler<ToggleCheckedChangedEventArgs>? CheckedChanged;

    /// <summary>The current immutable render state (exposed for hosting / diagnostics / tests).</summary>
    public ToggleState State => _state;

    /// <summary>Whether the switch is on (web <c>checked</c>); the controlled setter raises change notification only.</summary>
    public bool IsChecked
    {
        get => _state.IsChecked;
        set => ApplyState(_state with { IsChecked = value });
    }

    /// <summary>The visual size (web <c>size</c>).</summary>
    public ToggleSize Size
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

    /// <summary>The projected visual state (on when checked, otherwise off).</summary>
    public ToggleVisualState VisualState => _state.VisualState;

    /// <summary>
    /// Apply a user toggle (the web click → <c>onChange(!checked)</c> path): the value flips, change
    /// notification is raised and <see cref="CheckedChanged"/> fires with the new boolean. The web component
    /// has no disabled state, so a toggle always changes the value.
    /// </summary>
    /// <returns>The new checked value after the toggle.</returns>
    public bool Toggle()
    {
        ToggleResult result = _state.Toggle();
        ApplyState(result.State);
        CheckedChanged?.Invoke(this, new ToggleCheckedChangedEventArgs(result.IsChecked));
        return result.IsChecked;
    }

    private void ApplyState(ToggleState next)
    {
        ToggleState previous = _state;
        if (previous == next)
        {
            return;
        }

        _state = next;

        if (previous.IsChecked != next.IsChecked)
        {
            Raise(nameof(IsChecked));
        }

        if (previous.Size != next.Size)
        {
            Raise(nameof(Size));
        }

        if (previous.Label != next.Label)
        {
            Raise(nameof(Label));
        }

        if (previous.VisualState != next.VisualState)
        {
            Raise(nameof(VisualState));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
