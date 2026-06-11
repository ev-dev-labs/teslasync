using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AddAnnotationPopover"/> view — the native port of
/// the web <c>AddAnnotationPopover</c> component (web/src/components/charts/AddAnnotationPopover.tsx). It owns
/// the four editable fields (label / category / description / edited date — the web <c>useState</c> values),
/// the static category-pill options (web <c>CATEGORY_OPTIONS</c>) and drives the add / cancel callbacks behind
/// the client-side label gate (web <c>disabled={!label.trim()}</c> + the <c>if (!label.trim()) return</c> /
/// <c>if (!occurredAt) return</c> guards in <c>handleSubmit</c>). The web component has no read query — it is a
/// pure callback form — so the surface never shows a loading / empty / error / stale / offline state; its
/// states are the editable-date branch (web <c>editableDate</c>), the label-gated submit affordance and the
/// category selection. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AddAnnotationPopoverViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly AddAnnotationDiagnostics _diagnostics;

    private string _label = string.Empty;
    private AnnotationCategory _category = AnnotationCategory.Milestone;
    private string _description = string.Empty;
    private string _editedDate;

    /// <summary>
    /// Creates the holder over the annotated instant, the editable-date mode, the localizer and an optional
    /// diagnostics sink.
    /// </summary>
    /// <param name="timestamp">The annotated instant (web <c>timestamp</c>) — used verbatim when the date is
    /// fixed and seeds the date field (normalised to <c>YYYY-MM-DD</c>) when the date is editable.</param>
    /// <param name="editableDate">When true the instant is chosen via the date field (web <c>editableDate</c>);
    /// otherwise the supplied <paramref name="timestamp"/> is shown read-only and used as-is.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public AddAnnotationPopoverViewModel(
        string timestamp,
        bool editableDate,
        ILocalizer localizer,
        AddAnnotationDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        Timestamp = timestamp ?? string.Empty;
        EditableDate = editableDate;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new AddAnnotationDiagnostics();

        // Seed the date field from the annotated instant (web useState initialiser + the open useEffect).
        _editedDate = AddAnnotationProjection.ToDateInputValue(Timestamp);
        CategoryOptions = AddAnnotationProjection.CategoryOptions(localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the user adds an annotation (web <c>onAdd(...)</c>).</summary>
    public event EventHandler<AnnotationDraft>? AnnotationSubmitted;

    /// <summary>Raised when the form should close without adding (web <c>onCancel()</c>).</summary>
    public event EventHandler? CloseRequested;

    // ── Static content (web CATEGORY_OPTIONS) ────────────────────────────────────────────────────────────

    /// <summary>The category pill options (value + localized label + glyph + accent) in web render order.</summary>
    public IReadOnlyList<AnnotationCategoryOption> CategoryOptions { get; }

    /// <summary>The annotated instant supplied by the host (web <c>timestamp</c>).</summary>
    public string Timestamp { get; }

    /// <summary>True when the instant is chosen via the date field (web <c>editableDate</c>).</summary>
    public bool EditableDate { get; }

    // ── Header / field copy ──────────────────────────────────────────────────────────────────────────────

    /// <summary>Modal title (web <c>Add Annotation</c>).</summary>
    public string Title => AddAnnotationRegistration.AddTitle(_localizer);

    /// <summary>Date field label (web <c>Date</c>).</summary>
    public string DateLabel => AddAnnotationRegistration.DateLabel(_localizer);

    /// <summary>Label field label (web <c>Label</c>).</summary>
    public string LabelLabel => AddAnnotationRegistration.LabelLabel(_localizer);

    /// <summary>Label field input hint (web <c>e.g., Battery replaced</c>).</summary>
    public string LabelPrompt => AddAnnotationRegistration.LabelPrompt(_localizer);

    /// <summary>Category group label (web <c>Category</c>).</summary>
    public string CategoryLabel => AddAnnotationRegistration.CategoryLabel(_localizer);

    /// <summary>Description field label (web <c>Description</c>).</summary>
    public string DescriptionLabel => AddAnnotationRegistration.DescriptionLabel(_localizer);

    /// <summary>Description field input hint (web <c>Optional description...</c>).</summary>
    public string DescriptionPrompt => AddAnnotationRegistration.DescriptionPrompt(_localizer);

    /// <summary>Submit button label (web <c>Add Annotation</c>).</summary>
    public string AddLabel => AddAnnotationRegistration.AddLabel(_localizer);

    /// <summary>Cancel button label (web <c>Cancel</c>).</summary>
    public string CancelLabel => AddAnnotationRegistration.CancelLabel(_localizer);

    // ── Editable fields (web useState) ───────────────────────────────────────────────────────────────────

    /// <summary>The annotation label (required, trimmed, max 50). Editing it re-evaluates <see cref="CanSubmit"/>.</summary>
    public string Label
    {
        get => _label;
        set
        {
            if (Set(ref _label, value ?? string.Empty))
            {
                Raise(nameof(CanSubmit));
            }
        }
    }

    /// <summary>The chosen category (web <c>category</c>; default milestone).</summary>
    public AnnotationCategory Category
    {
        get => _category;
        set => Set(ref _category, value);
    }

    /// <summary>The optional description (trimmed, max 200; web <c>description</c>).</summary>
    public string Description
    {
        get => _description;
        set => Set(ref _description, value ?? string.Empty);
    }

    /// <summary>The edited date as <c>YYYY-MM-DD</c> when <see cref="EditableDate"/> is true (web <c>editedDate</c>).</summary>
    public string EditedDate
    {
        get => _editedDate;
        set => Set(ref _editedDate, value ?? string.Empty);
    }

    // ── Interaction state ────────────────────────────────────────────────────────────────────────────────

    /// <summary>True once the trimmed label is non-empty (web <c>disabled={!label.trim()}</c>): submit enabled.</summary>
    public bool CanSubmit => AddAnnotationProjection.IsLabelValid(_label);

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event.</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Validate and emit the annotation (web <c>handleSubmit</c>). An empty label or an unresolved instant is a
    /// no-op (the web early returns); otherwise it raises <see cref="AnnotationSubmitted"/> with the trimmed
    /// payload, records the diagnostics counter and resets the label / category / description (web parity — the
    /// date is left intact). Returns true only when an annotation was emitted (the view then lets the modal
    /// close).
    /// </summary>
    public bool Submit()
    {
        if (!AddAnnotationProjection.IsLabelValid(_label))
        {
            return false;
        }

        string occurredAt = AddAnnotationProjection.ResolveOccurredAt(EditableDate, _editedDate, Timestamp);
        if (string.IsNullOrEmpty(occurredAt))
        {
            return false;
        }

        var draft = AddAnnotationProjection.BuildDraft(_label, _category, _description, occurredAt);
        AnnotationSubmitted?.Invoke(this, draft);
        _diagnostics.RecordAnnotationAdded();
        ResetFields();
        return true;
    }

    /// <summary>Dismiss the form without adding (web <c>handleClose</c> → <c>onCancel</c>): resets the fields.</summary>
    public void RequestClose()
    {
        ResetFields();
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    private void ResetFields()
    {
        Label = string.Empty;
        Category = AnnotationCategory.Milestone;
        Description = string.Empty;
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
