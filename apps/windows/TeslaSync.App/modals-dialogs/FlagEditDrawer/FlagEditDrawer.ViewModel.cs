using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FlagEditDrawer"/> view — the native port of the web
/// <c>FlagEditDrawer</c> component (web/src/features/admin/components/feature-flags/FlagEditDrawer.tsx). The web
/// component is a controlled, write-only form drawer: the parent page owns the <c>open</c> / <c>initial</c> /
/// <c>saving</c> props and the actual set-flag mutation, while the drawer itself just renders the form and calls
/// <c>onSave</c> / <c>onClose</c>. There is no read query, so the surface has no loading / empty / error / stale /
/// offline state — its states are the create-vs-edit composition (title, key editability + the immutable note),
/// the per-field validation (the free-form JSON value parse with its "value required" / "invalid JSON" helper
/// text, plus the required key and the audit-required reason), the save gate, and the in-flight (saving) state
/// that disables the buttons and shows the save spinner. This holder owns the editable fields (the web
/// <c>useState</c> values), re-seeds them whenever the drawer is (re-)opened for a flag (the web reset effect
/// keyed on <c>[open, initial]</c>), runs the validation behind the save gate, and routes save / close back to
/// the host through events. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class FlagEditDrawerViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly FlagEditDrawerDiagnostics _diagnostics;
    private readonly string _valuePrompt = FlagEditDrawerRegistration.ValuePrompt;

    private FeatureFlagEntry? _initial;
    private FlagValueParse _parse;

    private bool _isOpen;
    private bool _editing;
    private string _keyInput = string.Empty;
    private string _valueInput = string.Empty;
    private string _reason = string.Empty;
    private bool _saving;

    /// <summary>Creates the holder over the i18n facade and (optional) PII-safe diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public FlagEditDrawerViewModel(ILocalizer localizer, FlagEditDrawerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _diagnostics = diagnostics ?? new FlagEditDrawerDiagnostics();
        _parse = FlagEditDrawerProjection.ParseValue(string.Empty, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with the assembled payload when the operator saves (web <c>onSave</c>).</summary>
    public event EventHandler<FlagEditSaveRequest>? SaveRequested;

    /// <summary>Raised when the drawer should close (web <c>onClose</c>): a cancel, dismiss, or backdrop click.</summary>
    public event EventHandler? CloseRequested;

    /// <summary>The diagnostics surface slug this view registers under.</summary>
    public static string Slug => FlagEditDrawerRegistration.Slug;

    // ── Chrome state ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>True while the drawer is shown (web <c>open</c>).</summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set => Set(ref _isOpen, value);
    }

    /// <summary>True when editing an existing flag, false when creating one (web <c>editing = initial !== null</c>).</summary>
    public bool Editing
    {
        get => _editing;
        private set
        {
            if (Set(ref _editing, value))
            {
                Raise(nameof(Title));
                Raise(nameof(KeyEditable));
                Raise(nameof(ShowKeyImmutableNote));
            }
        }
    }

    /// <summary>Whether the key field is editable — only in "create" mode (web <c>disabled={editing}</c>).</summary>
    public bool KeyEditable => !_editing;

    /// <summary>Whether the immutable-key note is shown — only in "edit" mode (web <c>{editing &amp;&amp; …}</c>).</summary>
    public bool ShowKeyImmutableNote => _editing;

    // ── Editable fields (web useState) ───────────────────────────────────────────────────────────────────

    /// <summary>The flag key (web <c>keyInput</c>). Editing it re-validates the key and the save gate.</summary>
    public string KeyInput
    {
        get => _keyInput;
        set
        {
            if (Set(ref _keyInput, value ?? string.Empty))
            {
                Raise(nameof(KeyValid));
                Raise(nameof(CanSave));
            }
        }
    }

    /// <summary>The free-form JSON value text (web <c>valueInput</c>). Editing it re-parses and re-gates save.</summary>
    public string ValueInput
    {
        get => _valueInput;
        set
        {
            if (Set(ref _valueInput, value ?? string.Empty))
            {
                _parse = FlagEditDrawerProjection.ParseValue(_valueInput, _localizer);
                Raise(nameof(ValueValid));
                Raise(nameof(ValueError));
                Raise(nameof(HasValueError));
                Raise(nameof(CanSave));
            }
        }
    }

    /// <summary>The audit reason (web <c>reason</c>). Editing it re-validates the reason and the save gate.</summary>
    public string Reason
    {
        get => _reason;
        set
        {
            if (Set(ref _reason, value ?? string.Empty))
            {
                Raise(nameof(ReasonValid));
                Raise(nameof(CanSave));
            }
        }
    }

    /// <summary>True while the parent's set-flag mutation is in flight (web <c>saving</c>): buttons disabled.</summary>
    public bool Saving
    {
        get => _saving;
        set
        {
            if (Set(ref _saving, value))
            {
                Raise(nameof(CancelEnabled));
                Raise(nameof(CanSave));
            }
        }
    }

    // ── Validation state (web parsed / keyValid / reasonValid / canSave) ─────────────────────────────────

    /// <summary>True once the value text parses to a JSON value (web <c>parsed.ok</c>).</summary>
    public bool ValueValid => _parse.Ok;

    /// <summary>The localized parse-error helper text when the value is invalid, else <c>null</c> (web <c>parsed.error</c>).</summary>
    public string? ValueError => _parse.Ok ? null : _parse.Error;

    /// <summary>True while a value parse-error should render against the value field.</summary>
    public bool HasValueError => !_parse.Ok;

    /// <summary>True once the trimmed key is non-empty (web <c>keyValid</c>).</summary>
    public bool KeyValid => FlagEditDrawerProjection.IsKeyValid(_keyInput);

    /// <summary>True once the trimmed reason is non-empty (web <c>reasonValid</c>).</summary>
    public bool ReasonValid => FlagEditDrawerProjection.IsReasonValid(_reason);

    /// <summary>
    /// True when the save button is enabled — a parseable value, a non-empty key + reason, and no save in flight
    /// (web <c>canSave = parsed.ok &amp;&amp; keyValid &amp;&amp; reasonValid &amp;&amp; !saving</c>).
    /// </summary>
    public bool CanSave => FlagEditDrawerProjection.CanSave(_parse.Ok, _keyInput, _reason, _saving);

    /// <summary>Whether the cancel button is enabled — disabled while saving (web <c>disabled={saving}</c>).</summary>
    public bool CancelEnabled => !_saving;

    // ── Localized labels (web t() call sites; the Narrator-label source) ─────────────────────────────────

    /// <summary>Drawer title (web <c>editTitle</c> / <c>createTitle</c>).</summary>
    public string Title => _editing
        ? FlagEditDrawerRegistration.EditTitle(_localizer, _initial?.Key ?? string.Empty)
        : FlagEditDrawerRegistration.CreateTitle(_localizer);

    /// <summary>Flag-key field label (web <c>keyLabel</c>).</summary>
    public string KeyLabel => FlagEditDrawerRegistration.KeyLabel(_localizer);

    /// <summary>Flag-key field input hint (shown when empty).</summary>
    public string KeyPrompt => FlagEditDrawerRegistration.KeyPrompt(_localizer);

    /// <summary>Immutable-key note shown in edit mode (web <c>keyImmutable</c>).</summary>
    public string KeyImmutableNote => FlagEditDrawerRegistration.KeyImmutableNote(_localizer);

    /// <summary>Value field label (web <c>valueLabel</c>).</summary>
    public string ValueLabel => FlagEditDrawerRegistration.ValueLabel(_localizer);

    /// <summary>Value field example JSON hint (web hardcoded snippet; not localized, mirroring the web).</summary>
    public string ValuePrompt => _valuePrompt;

    /// <summary>Reason field label (web <c>reasonLabel</c>).</summary>
    public string ReasonLabel => FlagEditDrawerRegistration.ReasonLabel(_localizer);

    /// <summary>Reason field input hint (shown when empty).</summary>
    public string ReasonPrompt => FlagEditDrawerRegistration.ReasonPrompt(_localizer);

    /// <summary>Save button label (web <c>save</c>).</summary>
    public string SaveLabel => FlagEditDrawerRegistration.SaveLabel(_localizer);

    /// <summary>Cancel button label (web <c>common.cancel</c>).</summary>
    public string CancelLabel => FlagEditDrawerRegistration.CancelLabel(_localizer);

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Open the drawer for a flag, (re-)seeding the form — the native analogue of the parent setting
    /// <c>open=true</c> plus the web reset effect keyed on <c>[open, initial]</c>. A null
    /// <paramref name="initial"/> is "create new" mode; otherwise the key is seeded + locked and the value is
    /// pretty-printed JSON. The reason always starts empty, the saving flag is cleared, and the
    /// <c>view.opened</c> diagnostic is recorded.
    /// </summary>
    public void Open(FeatureFlagEntry? initial)
    {
        _initial = initial;
        Editing = initial is not null;
        KeyInput = initial?.Key ?? string.Empty;
        ValueInput = FlagEditDrawerProjection.DefaultValueJson(initial);
        Reason = string.Empty;
        Saving = false;
        IsOpen = true;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>
    /// Save the flag — the native analogue of the web <c>handleSave</c>. A no-op unless the save gate is open;
    /// otherwise it raises <see cref="SaveRequested"/> with the trimmed key, the parsed value, and the trimmed
    /// reason. It does not close the drawer — the host closes it after the mutation succeeds (web parity).
    /// </summary>
    public void RequestSave()
    {
        if (!CanSave)
        {
            return;
        }

        SaveRequested?.Invoke(
            this,
            new FlagEditSaveRequest(_keyInput.Trim(), _parse.Value, _reason.Trim()));
    }

    /// <summary>Dismiss the drawer (web <c>onClose</c>): close it and raise <see cref="CloseRequested"/>.</summary>
    public void RequestClose()
    {
        IsOpen = false;
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
