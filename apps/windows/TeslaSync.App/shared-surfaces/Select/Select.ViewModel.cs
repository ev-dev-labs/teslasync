using System.Collections.Generic;
using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.SelectSurface;

/// <summary>
/// The change-notification payload for the <see cref="SelectViewModel.SelectionChanged"/> event — the native
/// analogue of the value the web <c>onChange(e)</c> handler reads off <c>e.target.value</c>
/// (<c>web/src/components/ui/Select.tsx</c>). Raised only on a user-driven selection, never on a controlled
/// property assignment, exactly like the browser change event.
/// </summary>
public sealed class SelectSelectionChangedEventArgs : EventArgs
{
    /// <summary>Creates the payload for the newly selected value.</summary>
    /// <param name="value">The selected value after the change (web <c>e.target.value</c>); null when cleared.</param>
    public SelectSelectionChangedEventArgs(string? value) => Value = value;

    /// <summary>The value reported to the change handler (web <c>e.target.value</c>); null when cleared.</summary>
    public string? Value { get; }
}

/// <summary>
/// The state holder the <c>Select</c> view binds to (P1/S8 state-holder layer) — the native port of the web
/// <c>Select</c> component's controlled / uncontrolled value state (<c>web/src/components/ui/Select.tsx</c>). It owns
/// the immutable <see cref="SelectState"/> and projects the web props (<see cref="Options"/>, <see cref="Label"/>,
/// <see cref="Help"/>, <see cref="Error"/>, <see cref="Hint"/>, <see cref="Prompt"/>, <see cref="Size"/>,
/// <see cref="IsDisabled"/>, <see cref="IsRequired"/>, <see cref="SelectedValue"/>, <see cref="Id"/>) as observable
/// members. Assigning a property is the controlled path (a web re-render with new props): it raises
/// <see cref="INotifyPropertyChanged"/> so the view refreshes, but does NOT fire <see cref="SelectionChanged"/>.
/// <see cref="SelectValue"/> is the user-interaction path (the dropdown's <c>onChange</c>): it applies the
/// transition and fires <see cref="SelectionChanged"/> with the new value. The view performs no I/O; it binds to
/// this holder.
/// </summary>
public sealed class SelectViewModel : INotifyPropertyChanged
{
    private SelectState _state;

    /// <summary>Creates the holder over an initial render state (the web initial props).</summary>
    /// <param name="options">The selectable options (web <c>options</c>); null is treated as empty.</param>
    /// <param name="label">The optional field label (web <c>label</c>).</param>
    /// <param name="help">The optional field-level help affordance (web <c>help</c>).</param>
    /// <param name="error">The optional validation error (web <c>error</c>).</param>
    /// <param name="hint">The optional helper hint (web <c>hint</c>).</param>
    /// <param name="prompt">The optional empty-selection prompt (web Select.tsx L23).</param>
    /// <param name="size">The sizing scale (web <c>size</c>, default <see cref="SelectSize.Md"/>).</param>
    /// <param name="isDisabled">Whether the dropdown starts disabled (web <c>disabled</c>).</param>
    /// <param name="isRequired">Whether the field is required (web <c>required</c>).</param>
    /// <param name="selectedValue">The initial selected value (web <c>value</c>); null shows the empty-selection prompt.</param>
    /// <param name="id">The explicit field id (web <c>id</c>); null derives it from the label.</param>
    public SelectViewModel(
        IReadOnlyList<SelectOption>? options = null,
        string? label = null,
        SelectHelp? help = null,
        string? error = null,
        string? hint = null,
        string? prompt = null,
        SelectSize size = SelectSize.Md,
        bool isDisabled = false,
        bool isRequired = false,
        string? selectedValue = null,
        string? id = null) =>
        _state = new SelectState
        {
            Options = options ?? Array.Empty<SelectOption>(),
            Label = label,
            Help = help,
            Error = error,
            Hint = hint,
            Prompt = prompt,
            Size = size,
            IsDisabled = isDisabled,
            IsRequired = isRequired,
            SelectedValue = selectedValue,
            Id = id,
        };

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a user selection changes the value (the web <c>onChange</c> callback).</summary>
    public event EventHandler<SelectSelectionChangedEventArgs>? SelectionChanged;

    /// <summary>The current immutable render state (exposed for hosting / diagnostics / tests).</summary>
    public SelectState State => _state;

    /// <summary>The selectable options (web <c>options</c>); the controlled setter raises change notification only.</summary>
    public IReadOnlyList<SelectOption> Options
    {
        get => _state.Options;
        set => ApplyState(_state with { Options = value ?? Array.Empty<SelectOption>() });
    }

    /// <summary>The optional field label (web <c>label</c>).</summary>
    public string? Label
    {
        get => _state.Label;
        set => ApplyState(_state with { Label = value });
    }

    /// <summary>The optional field-level help affordance (web <c>help</c>).</summary>
    public SelectHelp? Help
    {
        get => _state.Help;
        set => ApplyState(_state with { Help = value });
    }

    /// <summary>The optional validation error (web <c>error</c>); takes precedence over the hint.</summary>
    public string? Error
    {
        get => _state.Error;
        set => ApplyState(_state with { Error = value });
    }

    /// <summary>The optional helper hint (web <c>hint</c>); hidden while an error is present.</summary>
    public string? Hint
    {
        get => _state.Hint;
        set => ApplyState(_state with { Hint = value });
    }

    /// <summary>The optional empty-selection prompt (web Select.tsx L23).</summary>
    public string? Prompt
    {
        get => _state.Prompt;
        set => ApplyState(_state with { Prompt = value });
    }

    /// <summary>The sizing scale (web <c>size</c>).</summary>
    public SelectSize Size
    {
        get => _state.Size;
        set => ApplyState(_state with { Size = value });
    }

    /// <summary>Whether the dropdown is non-interactive and dimmed (web <c>disabled</c>).</summary>
    public bool IsDisabled
    {
        get => _state.IsDisabled;
        set => ApplyState(_state with { IsDisabled = value });
    }

    /// <summary>Whether the field is required — renders the label's <c>*</c> marker (web <c>required</c>).</summary>
    public bool IsRequired
    {
        get => _state.IsRequired;
        set => ApplyState(_state with { IsRequired = value });
    }

    /// <summary>
    /// The currently selected value (web controlled <c>value</c>); the controlled setter raises change notification
    /// only — use <see cref="SelectValue"/> for the user-interaction path that fires <see cref="SelectionChanged"/>.
    /// </summary>
    public string? SelectedValue
    {
        get => _state.SelectedValue;
        set => ApplyState(_state with { SelectedValue = value });
    }

    /// <summary>The explicit field id (web <c>id</c>); null derives the id from the label.</summary>
    public string? Id
    {
        get => _state.Id;
        set => ApplyState(_state with { Id = value });
    }

    /// <summary>The resolved field id (web <c>selectId</c>).</summary>
    public string? SelectId => _state.SelectId;

    /// <summary>The currently selected option, or null when nothing matches the selected value.</summary>
    public SelectOption? SelectedOption => _state.SelectedOption;

    /// <summary>The index of the selected option, or -1 when nothing is selected.</summary>
    public int SelectedIndex => _state.SelectedIndex;

    /// <summary>
    /// Apply a user selection (the dropdown <c>onChange</c> path). A disabled select is a no-op (the browser fires
    /// no change for a disabled control); a value that is absent or maps to a disabled option is rejected (the
    /// browser refuses to select a disabled <c>&lt;option&gt;</c>); re-selecting the current value is a no-op (the
    /// browser fires <c>change</c> only when the value actually changes). On a real change the state is updated,
    /// change notification is raised and <see cref="SelectionChanged"/> fires with the new value.
    /// </summary>
    /// <param name="value">The value the user chose, or null to clear the selection.</param>
    /// <returns><see langword="true"/> when the selection changed; otherwise <see langword="false"/>.</returns>
    public bool SelectValue(string? value)
    {
        if (_state.IsDisabled || !_state.CanSelect(value) || string.Equals(_state.SelectedValue, value, StringComparison.Ordinal))
        {
            return false;
        }

        ApplyState(_state.WithSelectedValue(value));
        SelectionChanged?.Invoke(this, new SelectSelectionChangedEventArgs(value));
        return true;
    }

    private void ApplyState(SelectState next)
    {
        SelectState previous = _state;
        if (previous == next)
        {
            return;
        }

        _state = next;

        if (!ReferenceEquals(previous.Options, next.Options))
        {
            Raise(nameof(Options));
        }

        if (previous.Label != next.Label)
        {
            Raise(nameof(Label));
        }

        if (!Equals(previous.Help, next.Help))
        {
            Raise(nameof(Help));
        }

        if (previous.Error != next.Error)
        {
            Raise(nameof(Error));
        }

        if (previous.Hint != next.Hint)
        {
            Raise(nameof(Hint));
        }

        if (previous.Prompt != next.Prompt)
        {
            Raise(nameof(Prompt));
        }

        if (previous.Size != next.Size)
        {
            Raise(nameof(Size));
        }

        if (previous.IsDisabled != next.IsDisabled)
        {
            Raise(nameof(IsDisabled));
        }

        if (previous.IsRequired != next.IsRequired)
        {
            Raise(nameof(IsRequired));
        }

        if (previous.SelectedValue != next.SelectedValue)
        {
            Raise(nameof(SelectedValue));
        }

        if (previous.Id != next.Id)
        {
            Raise(nameof(Id));
        }

        if (previous.SelectId != next.SelectId)
        {
            Raise(nameof(SelectId));
        }

        // The selected option / index are a function of both the value and the option list, so refresh them when
        // either changes (web: the rendered selection follows whichever prop moved).
        if (previous.SelectedValue != next.SelectedValue || !ReferenceEquals(previous.Options, next.Options))
        {
            Raise(nameof(SelectedOption));
            Raise(nameof(SelectedIndex));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
