using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The acknowledgement draft the dialog emits — the native analogue of the web <c>onSubmit(note)</c> argument
/// (web/src/features/admin/components/AcknowledgeAlertDialog.tsx). <see cref="Note"/> is the trimmed note, which
/// may be the empty string when the user leaves the textarea blank: the backend treats an empty/whitespace note
/// as "ack with no note" so the audit timeline still records who + when (web handleSubmit comment).
/// </summary>
public sealed record AcknowledgeAlertDraft(string Note);

/// <summary>
/// Canonical bounds, the note length policy and i18n keys for the <c>AcknowledgeAlertDialog</c> surface — the
/// native mirror of <c>web/src/features/admin/components/AcknowledgeAlertDialog.tsx</c>. The web component ships
/// literal copy behind <c>react-i18next</c> keys; every literal is keyed here (with that literal as the English
/// fallback) so the native view and view-model stay free of inline strings and resolve through the i18n facade.
/// UI-free so every key, fallback and bound is asserted headlessly.
/// </summary>
public static class AcknowledgeAlertRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AcknowledgeAlertDialog";

    /// <summary>Maximum trimmed note length before the field is flagged too long (web <c>NOTE_MAX</c> = 1000).</summary>
    public const int NoteMaxLength = 1000;

    /// <summary>
    /// Hard cap on the editable text length (web <c>maxLength={NOTE_MAX + 50}</c> = 1050). The 50-char slack lets
    /// the user type a little past the limit so the too-long validation error can surface rather than silently
    /// truncating at the boundary.
    /// </summary>
    public const int NoteInputMaxLength = NoteMaxLength + 50;

    /// <summary>Dialog title (web <c>t('alerts.ack.dialogTitle', 'Acknowledge alert')</c>).</summary>
    public static string DialogTitle(ILocalizer localizer) =>
        Require(localizer).GetString("alerts.ack.dialogTitle", "Acknowledge alert");

    /// <summary>Note field label (web <c>t('alerts.ack.noteLabel', 'Note (optional)')</c>).</summary>
    public static string NoteLabel(ILocalizer localizer) =>
        Require(localizer).GetString("alerts.ack.noteLabel", "Note (optional)");

    /// <summary>Note field input hint — the web note field's hint text "Optional: what's being done?".</summary>
    public static string NotePrompt(ILocalizer localizer) =>
        Require(localizer).GetString("alerts.ack.notePlaceholder", "Optional: what's being done?"); // parity:allow web i18n key (input hint text), not a stub

    /// <summary>Cancel button label (web <c>t('alerts.ack.cancel', 'Cancel')</c>).</summary>
    public static string CancelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("alerts.ack.cancel", "Cancel");

    /// <summary>Acknowledge (submit) button label (web <c>t('alerts.ack.submit', 'Acknowledge')</c>).</summary>
    public static string SubmitLabel(ILocalizer localizer) =>
        Require(localizer).GetString("alerts.ack.submit", "Acknowledge");

    /// <summary>
    /// The note hint with the character cap interpolated — the native analogue of
    /// <c>t('alerts.ack.noteHint', 'Up to {{max}} characters. Shared in the audit timeline.', { max: NOTE_MAX })</c>.
    /// Mirrors the FeedbackModal interpolation convention: resolve the keyed template then substitute the
    /// i18next <c>{{max}}</c> token so a translated catalog string keeps the substitution point.
    /// </summary>
    public static string NoteHint(ILocalizer localizer, int max)
    {
        string template = Require(localizer)
            .GetString("alerts.ack.noteHint", "Up to {{max}} characters. Shared in the audit timeline.");
        return template.Replace("{{max}}", max.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);
    }

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>AcknowledgeAlertDialog</c> surface — the native analogue of the web component's
/// <c>note.trim()</c> + <c>trimmed.length > NOTE_MAX</c> logic and the <c>onSubmit(trimmed)</c> argument
/// assembly. UI-free so the note-length policy and submit-gate are unit-tested headlessly and the view-model
/// never recomputes them inline.
/// </summary>
public static class AcknowledgeAlertProjection
{
    /// <summary>The trimmed note (web <c>note.trim()</c>); never null.</summary>
    public static string NormalizeNote(string? note) => (note ?? string.Empty).Trim();

    /// <summary>
    /// True once the trimmed note exceeds <see cref="AcknowledgeAlertRegistration.NoteMaxLength"/>
    /// (web <c>trimmed.length > NOTE_MAX</c>): the submit gate closes and the field shows the too-long error.
    /// </summary>
    public static bool IsTooLong(string? note) =>
        NormalizeNote(note).Length > AcknowledgeAlertRegistration.NoteMaxLength;

    /// <summary>
    /// Assemble the <c>onSubmit</c> argument from the current note — the native analogue of
    /// <c>onSubmit(note.trim())</c>. The note is trimmed (and may be the empty string, which the backend accepts
    /// as an ack with no note).
    /// </summary>
    public static AcknowledgeAlertDraft BuildDraft(string? note) => new(NormalizeNote(note));
}

/// <summary>
/// PII-safe diagnostics for the <c>AcknowledgeAlertDialog</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the acknowledgement note or the acked alert's title — so a
/// diagnostics line can never leak the audit-note content. Thread-safe.
/// </summary>
public sealed class AcknowledgeAlertDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _acknowledged;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AcknowledgeAlertDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of acknowledgements emitted from this surface.</summary>
    public long Acknowledged => Interlocked.Read(ref _acknowledged);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AcknowledgeAlertDialog</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={AcknowledgeAlertRegistration.Slug}"));
    }

    /// <summary>Record that an acknowledgement was emitted (the note / alert title are never logged).</summary>
    public void RecordAcknowledged()
    {
        Interlocked.Increment(ref _acknowledged);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"alert.acknowledged slug={AcknowledgeAlertRegistration.Slug}"));
    }
}
