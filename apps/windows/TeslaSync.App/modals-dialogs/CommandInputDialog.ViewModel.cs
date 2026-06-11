using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// Observable state for one rendered command-input field — the native analogue of one entry in the web
/// component's <c>values</c> / <c>errors</c> / <c>touched</c> maps
/// (web/src/features/system/components/CommandInputDialog.tsx). It carries the immutable field shape (name,
/// resolved label, input hint, secret / numeric affordance and validation bounds) plus the mutable
/// <see cref="Value"/>, <see cref="Error"/> and <see cref="Touched"/> the view binds. The displayed error
/// mirrors the web <c>error={touched[name] ? errors[name] : undefined}</c> gate — it surfaces only once the
/// field has been touched. The view-model owns the validation; this holder never computes a rule itself.
/// </summary>
public sealed class CommandInputFieldState : INotifyPropertyChanged
{
    private string _value;
    private string? _error;
    private bool _touched;

    /// <summary>Creates the field state from its resolved shape and seeded value.</summary>
    public CommandInputFieldState(
        string name,
        string? label,
        string hint,
        bool isSecret,
        CommandInputValidation validation,
        double? min,
        double? max,
        string initialValue)
    {
        Name = name ?? throw new ArgumentNullException(nameof(name));
        Label = label;
        Hint = hint ?? string.Empty;
        IsSecret = isSecret;
        Validation = validation;
        Min = min;
        Max = max;
        _value = initialValue ?? string.Empty;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The field's parameter name (web <c>field.name</c> / <c>ic.paramName</c>).</summary>
    public string Name { get; }

    /// <summary>The resolved field label (web <c>field.labelKey</c> / the single-field sub-label); null hides it.</summary>
    public string? Label { get; }

    /// <summary>True when a non-empty <see cref="Label"/> should render above the field.</summary>
    public bool HasLabel => !string.IsNullOrEmpty(Label);

    /// <summary>The input hint shown when the field is empty (the web field hint / <c>ic.defaultValue</c>).</summary>
    public string Hint { get; }

    /// <summary>True when the value is masked on entry (web <c>resolveInputType === 'password'</c>, the PIN rule).</summary>
    public bool IsSecret { get; }

    /// <summary>The validation rule applied to this field (drives both the rule and the numeric input mode).</summary>
    public CommandInputValidation Validation { get; }

    /// <summary>The lower bound for number/decimal validation (web <c>field.min</c> / <c>ic.min</c>).</summary>
    public double? Min { get; }

    /// <summary>The upper bound for number/decimal validation (web <c>field.max</c> / <c>ic.max</c>).</summary>
    public double? Max { get; }

    /// <summary>The current entered value (web <c>values[name]</c>); mutated through the view-model.</summary>
    public string Value
    {
        get => _value;
        internal set => Set(ref _value, value ?? string.Empty);
    }

    /// <summary>The latest validation error (web <c>errors[name]</c>); null when the value is acceptable.</summary>
    public string? Error
    {
        get => _error;
        internal set
        {
            if (!string.Equals(_error, value, StringComparison.Ordinal))
            {
                _error = value;
                Raise(nameof(Error));
                Raise(nameof(DisplayError));
                Raise(nameof(HasError));
            }
        }
    }

    /// <summary>True once the field has been blurred or a submit was attempted (web <c>touched[name]</c>).</summary>
    public bool Touched
    {
        get => _touched;
        internal set
        {
            if (_touched != value)
            {
                _touched = value;
                Raise(nameof(Touched));
                Raise(nameof(DisplayError));
                Raise(nameof(HasError));
            }
        }
    }

    /// <summary>The error to display — the web <c>touched ? error : undefined</c> gate; null hides it.</summary>
    public string? DisplayError => _touched ? _error : null;

    /// <summary>True when a validation error should be shown against the field.</summary>
    public bool HasError => DisplayError is not null;

    private bool Set(ref string field, string value, [CallerMemberName] string? name = null)
    {
        if (string.Equals(field, value, StringComparison.Ordinal))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CommandInputDialog"/> view — the native port of
/// the web <c>CommandInputDialog</c> component (web/src/features/system/components/CommandInputDialog.tsx). It
/// owns the per-field <see cref="CommandInputFieldState"/> list (the web <c>values</c> / <c>errors</c> /
/// <c>touched</c> maps unified into one row model), the host-driven <see cref="Loading"/> flag (the web
/// <c>loading</c> prop) and drives the submit / cancel callbacks behind the live validation gate (web
/// <c>isValid()</c> + the per-field <c>validateField</c> rule). The parent owns the actual command dispatch
/// (web <c>VehicleCommandCenter</c>), so this surface is a pure callback form with no read query — it never
/// shows an empty / error / stale / offline read state; its states are the editable field(s), the per-field
/// validation error (revealed once a field is touched), the live submit gate and the in-flight
/// <see cref="Loading"/> state that disables Send (web <c>disabled={!isValid()}</c> + the Button's
/// <c>disabled || loading</c>). Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class CommandInputDialogViewModel : INotifyPropertyChanged
{
    private readonly CommandInputForm _form;
    private readonly string? _vehicleDisplayName;
    private readonly ILocalizer _localizer;
    private readonly CommandInputDiagnostics _diagnostics;
    private readonly List<CommandInputFieldState> _fields;

    private bool _loading;

    /// <summary>Creates the holder over the bound form, the active vehicle's name, the localizer and diagnostics.</summary>
    /// <param name="form">The command-input form to render (web <c>def</c> + <c>def.inputConfig</c>).</param>
    /// <param name="vehicleDisplayName">The active vehicle's display name, used to seed a defaulted single field
    /// (web <c>vehicle?.display_name</c> passed to <c>getDefaultValue</c>); null when unknown.</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public CommandInputDialogViewModel(
        CommandInputForm form,
        string? vehicleDisplayName,
        ILocalizer localizer,
        CommandInputDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(form);
        ArgumentNullException.ThrowIfNull(localizer);

        _form = form;
        _vehicleDisplayName = vehicleDisplayName;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new CommandInputDiagnostics();
        _fields = BuildFields();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the user submits a valid form (web <c>onSubmit(values)</c>).</summary>
    public event EventHandler<CommandInputSubmission>? SubmitRequested;

    /// <summary>Raised when the dialog should close without submitting (web <c>onClose()</c> / Escape).</summary>
    public event EventHandler? CloseRequested;

    // ── Header / button copy (the Narrator-label source) ─────────────────────────────────────────────────

    /// <summary>The dialog title (web <c>t(def.labelKey, def.labelFallback)</c>).</summary>
    public string Title => _localizer.GetString(_form.TitleKey, _form.TitleFallback);

    /// <summary>The prompt shown under the title (web <c>t(ic.promptKey, ic.promptFallback)</c>).</summary>
    public string Prompt => _localizer.GetString(_form.PromptKey, _form.PromptFallback);

    /// <summary>The Segoe Fluent header glyph (web <c>def.icon</c>); empty hides the header icon.</summary>
    public string IconGlyph => _form.IconGlyph;

    /// <summary>True when a header icon should render.</summary>
    public bool HasIcon => !string.IsNullOrEmpty(_form.IconGlyph);

    /// <summary>Cancel button label (web <c>Cancel</c>).</summary>
    public string CancelLabel => CommandInputRegistration.CancelLabel(_localizer);

    /// <summary>Submit button label (web <c>Send</c>).</summary>
    public string SubmitLabel => CommandInputRegistration.SubmitLabel(_localizer);

    // ── Fields ───────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The rendered fields in web order (one per <c>ic.fields</c> entry, or a single paramName field).</summary>
    public IReadOnlyList<CommandInputFieldState> Fields => _fields;

    // ── Interaction state ────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// True while the parent's command dispatch is in flight (web <c>loading</c> prop). It shows the Send
    /// button's busy affordance and, with the validity gate, disables Send (web Button <c>disabled || loading</c>).
    /// </summary>
    public bool Loading
    {
        get => _loading;
        set
        {
            if (_loading != value)
            {
                _loading = value;
                Raise(nameof(Loading));
                Raise(nameof(CanSubmit));
            }
        }
    }

    /// <summary>
    /// True when Send is enabled — every field is valid and no dispatch is in flight (web
    /// <c>disabled={!isValid()}</c> combined with the Button's <c>disabled || loading</c>).
    /// </summary>
    public bool CanSubmit => !_loading && CommandInputProjection.IsValid(_form, SnapshotValues(), _localizer);

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Re-seed the fields and clear every error / touched flag (web open <c>useEffect</c> — stale entries from a
    /// previous command would be confusing), then record the <c>view.opened</c> diagnostics event. Call when
    /// the dialog opens.
    /// </summary>
    public void NotifyOpened()
    {
        var seed = CommandInputProjection.BuildInitialValues(_form, _vehicleDisplayName);
        foreach (var field in _fields)
        {
            field.Touched = false;
            field.Error = null;
            field.Value = seed.TryGetValue(field.Name, out var value) ? value : string.Empty;
        }

        Raise(nameof(CanSubmit));
        _diagnostics.RecordViewOpened();
    }

    /// <summary>
    /// Apply a typed value to a field — the native analogue of web <c>handleChange</c>. The value is stored and
    /// the live submit gate re-evaluated; the field's error is only refreshed once it has been touched (web
    /// <c>if (touched[name]) setErrors(...)</c>).
    /// </summary>
    public void SetValue(CommandInputFieldState field, string value)
    {
        ArgumentNullException.ThrowIfNull(field);

        field.Value = value ?? string.Empty;
        if (field.Touched)
        {
            field.Error = ValidateField(field);
        }

        Raise(nameof(CanSubmit));
    }

    /// <summary>
    /// Mark a field touched and validate it — the native analogue of web <c>handleBlur</c>. After this the
    /// field's error (if any) is revealed.
    /// </summary>
    public void Blur(CommandInputFieldState field)
    {
        ArgumentNullException.ThrowIfNull(field);

        field.Touched = true;
        field.Error = ValidateField(field);
    }

    /// <summary>
    /// Validate every field and, when all pass, emit the submission — the native analogue of web
    /// <c>handleSubmit</c>. Each field is marked touched and re-validated (so all errors surface at once); if any
    /// is invalid it is a no-op returning false (the view keeps the dialog open). Otherwise it raises
    /// <see cref="SubmitRequested"/> with the entered values, records the diagnostics counter and returns true.
    /// </summary>
    public bool Submit()
    {
        bool valid = true;
        foreach (var field in _fields)
        {
            field.Touched = true;
            string? error = ValidateField(field);
            field.Error = error;
            if (error is not null)
            {
                valid = false;
            }
        }

        Raise(nameof(CanSubmit));
        if (!valid)
        {
            return false;
        }

        SubmitRequested?.Invoke(this, new CommandInputSubmission(SnapshotValues()));
        _diagnostics.RecordSubmitted();
        return true;
    }

    /// <summary>Dismiss the dialog without submitting (web <c>onClose()</c> / Escape).</summary>
    public void RequestClose() => CloseRequested?.Invoke(this, EventArgs.Empty);

    private List<CommandInputFieldState> BuildFields()
    {
        var seed = CommandInputProjection.BuildInitialValues(_form, _vehicleDisplayName);

        if (_form.Fields is { } fields)
        {
            var states = new List<CommandInputFieldState>(fields.Count);
            foreach (var field in fields)
            {
                states.Add(new CommandInputFieldState(
                    field.Name,
                    _localizer.GetString(field.LabelKey, field.LabelFallback),
                    field.Hint ?? string.Empty,
                    field.Validation == CommandInputValidation.Pin,
                    field.Validation,
                    field.Min,
                    field.Max,
                    seed.TryGetValue(field.Name, out var fieldSeed) ? fieldSeed : string.Empty));
            }

            return states;
        }

        string? subtitle = _form.SubtitleFallback is not null
            ? _localizer.GetString(_form.SubtitleKey ?? string.Empty, _form.SubtitleFallback)
            : null;

        return
        [
            new CommandInputFieldState(
                _form.ParamName,
                subtitle,
                _form.DefaultValue ?? string.Empty,
                _form.Validation == CommandInputValidation.Pin,
                _form.Validation,
                _form.Min,
                _form.Max,
                seed.TryGetValue(_form.ParamName, out var paramSeed) ? paramSeed : string.Empty),
        ];
    }

    private string? ValidateField(CommandInputFieldState field) =>
        CommandInputProjection.Validate(field.Value, field.Validation, field.Min, field.Max, _localizer);

    private Dictionary<string, string> SnapshotValues()
    {
        var values = new Dictionary<string, string>(_fields.Count, StringComparer.Ordinal);
        foreach (var field in _fields)
        {
            values[field.Name] = field.Value;
        }

        return values;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
