using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CommandSelectDialog"/> view — the native port of the
/// web <c>CommandSelectDialog</c> component (web/src/features/system/components/CommandSelectDialog.tsx). It exposes
/// the resolved title + icon, the resolved option list (web <c>sc.options.map(…)</c>), the empty-state copy and the
/// host-driven <see cref="Loading"/> flag (the web <c>loading</c> prop, which disables every option button), and it
/// drives the select / close callbacks behind the loading gate (web option <c>disabled={loading}</c>). The actual
/// command mutation is owned by the parent (web Vehicle Commands page), so this surface is a pure callback form with
/// no read query: its states are the resolved option list, the in-flight (loading) disabled state and the defensive
/// empty branch — it never shows error / stale / offline (there is nothing to fetch). Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class CommandSelectDialogViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly CommandSelectDiagnostics _diagnostics;
    private readonly HashSet<string> _optionValues;

    private bool _loading;

    /// <summary>Creates the holder over the command-select request, the localizer and a diagnostics sink.</summary>
    /// <param name="request">The command-select request (title, icon, options) — web <c>def</c> + <c>def.selectConfig</c>.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public CommandSelectDialogViewModel(
        CommandSelectRequest request,
        ILocalizer localizer,
        CommandSelectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(localizer);

        Request = request;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new CommandSelectDiagnostics();

        Title = CommandSelectRegistration.Title(localizer, request);
        IconGlyph = request.IconGlyph;
        Options = CommandSelectProjection.ResolveAll(localizer, request.Options);
        _optionValues = new HashSet<string>(StringComparer.Ordinal);
        foreach (var option in Options)
        {
            _optionValues.Add(option.Value);
        }
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the user chooses an option (web <c>onSelect(opt.value)</c>) with that option's value.</summary>
    public event EventHandler<string>? SelectRequested;

    /// <summary>Raised when the dialog should close without choosing (web <c>onClose()</c> — Cancel / Esc / dismiss).</summary>
    public event EventHandler? CloseRequested;

    // ── Context ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The originating request (exposed for hosting — e.g. the parent reads <see cref="CommandSelectRequest.ParamName"/>).</summary>
    public CommandSelectRequest Request { get; }

    // ── Header / list copy (the Narrator-label source) ─────────────────────────────────────────────────────

    /// <summary>The resolved dialog title (web <c>t(def.labelKey, def.labelFallback)</c>).</summary>
    public string Title { get; }

    /// <summary>The leading icon glyph (web <c>def.icon</c>).</summary>
    public string IconGlyph { get; }

    /// <summary>Cancel button label (web <c>Cancel</c>).</summary>
    public string CancelLabel => CommandSelectRegistration.CancelLabel(_localizer);

    /// <summary>Friendly empty-state message shown when there are no options (native-only branch).</summary>
    public string EmptyMessage => CommandSelectRegistration.EmptyMessage(_localizer);

    /// <summary>The resolved options, in order (web <c>sc.options.map(…)</c>).</summary>
    public IReadOnlyList<CommandSelectResolvedOption> Options { get; }

    /// <summary>True when there is at least one option to render (the normal branch).</summary>
    public bool HasOptions => Options.Count > 0;

    /// <summary>True when there is nothing to choose from — the empty branch shows a friendly message.</summary>
    public bool IsEmpty => Options.Count == 0;

    // ── Interaction state ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// True while the parent's command issue is in flight (web <c>loading</c> prop). The host sets it; it disables
    /// every option button (<see cref="CanSelect"/>). Cancel stays enabled (web Cancel carries no <c>disabled</c>).
    /// </summary>
    public bool Loading
    {
        get => _loading;
        set
        {
            if (Set(ref _loading, value))
            {
                Raise(nameof(CanSelect));
            }
        }
    }

    /// <summary>True when option buttons are enabled — not loading (web option <c>disabled={loading}</c>).</summary>
    public bool CanSelect => !_loading;

    // ── Commands ───────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Record the <c>view.opened</c> diagnostics event. Call when the dialog opens (web open).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Choose an option (web option <c>onClick={() =&gt; onSelect(opt.value)}</c>). While loading it is a no-op
    /// (web <c>disabled={loading}</c>); an unknown value (not one of the rendered options) is rejected defensively.
    /// Otherwise it raises <see cref="SelectRequested"/> with the value and records the diagnostics counter. Returns
    /// true only when a selection was emitted.
    /// </summary>
    public bool Select(string value)
    {
        if (!CanSelect || value is null || !_optionValues.Contains(value))
        {
            return false;
        }

        SelectRequested?.Invoke(this, value);
        _diagnostics.RecordOptionSelected();
        return true;
    }

    /// <summary>
    /// Dismiss the dialog without choosing (web <c>onClose</c>). Always allowed — the web Cancel button is never
    /// disabled by <c>loading</c>. Returns true (the close was raised).
    /// </summary>
    public bool RequestClose()
    {
        CloseRequested?.Invoke(this, EventArgs.Empty);
        return true;
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

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
