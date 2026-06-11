using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the AcknowledgeAlertDialog modal-dialog surface's UI-thread-free logic — the
/// note-normalisation + too-long projection and draft assembly, the registration bounds + i18n key / fallback
/// contract (which doubles as the Narrator-label source, including the <c>{{max}}</c> hint interpolation), the
/// state-holder view-model's per-branch flows (idle / note-length-gated submit / submitting-disabled / acknowledge
/// + reset-on-open / cancel, plus the optional subtitle), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/AcknowledgeAlertDialog.tsx). The WinUI view itself
/// (AcknowledgeAlertDialog.cs) is exercised by the app build.
/// </summary>
public sealed class AcknowledgeAlertDialogTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Projection: note normalisation (web note.trim()) ─────────────────────────────────────────────────

    [Theory]
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    [InlineData("  Investigating the fault  ", "Investigating the fault")]
    public void NormalizeNote_trims_to_the_web_trimmed_note(string? note, string expected) =>
        Assert.Equal(expected, AcknowledgeAlertProjection.NormalizeNote(note));

    // ── Projection: too-long gate (web trimmed.length > NOTE_MAX) ────────────────────────────────────────

    [Fact]
    public void IsTooLong_is_false_at_the_cap_and_true_one_over()
    {
        Assert.False(AcknowledgeAlertProjection.IsTooLong(new string('x', AcknowledgeAlertRegistration.NoteMaxLength)));
        Assert.True(AcknowledgeAlertProjection.IsTooLong(new string('x', AcknowledgeAlertRegistration.NoteMaxLength + 1)));
    }

    [Fact]
    public void IsTooLong_measures_the_trimmed_note_not_the_raw_text()
    {
        // 1000 content chars wrapped in whitespace trims back to exactly the cap → not too long (web parity).
        string padded = "   " + new string('x', AcknowledgeAlertRegistration.NoteMaxLength) + "   ";
        Assert.False(AcknowledgeAlertProjection.IsTooLong(padded));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Acknowledged after inspection")]
    public void IsTooLong_is_false_for_short_or_empty_notes(string? note) =>
        Assert.False(AcknowledgeAlertProjection.IsTooLong(note));

    // ── Projection: draft assembly (web onSubmit(note.trim())) ───────────────────────────────────────────

    [Fact]
    public void BuildDraft_trims_the_note() =>
        Assert.Equal("Swapped the relay", AcknowledgeAlertProjection.BuildDraft("  Swapped the relay  ").Note);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void BuildDraft_yields_an_empty_note_for_blank_input(string? note) =>
        Assert.Equal(string.Empty, AcknowledgeAlertProjection.BuildDraft(note).Note);

    // ── Registration: bounds + slug ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_carries_the_web_bounds_and_slug()
    {
        Assert.Equal(1000, AcknowledgeAlertRegistration.NoteMaxLength);
        Assert.Equal(1050, AcknowledgeAlertRegistration.NoteInputMaxLength);
        Assert.Equal("AcknowledgeAlertDialog", AcknowledgeAlertRegistration.Slug);
    }

    // ── Registration: i18n fallbacks match the web literals (the Narrator-label source) ──────────────────

    [Fact]
    public void English_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Acknowledge alert", AcknowledgeAlertRegistration.DialogTitle(Localizer));
        Assert.Equal("Note (optional)", AcknowledgeAlertRegistration.NoteLabel(Localizer));
        Assert.Equal("Optional: what's being done?", AcknowledgeAlertRegistration.NotePrompt(Localizer));
        Assert.Equal("Cancel", AcknowledgeAlertRegistration.CancelLabel(Localizer));
        Assert.Equal("Acknowledge", AcknowledgeAlertRegistration.SubmitLabel(Localizer));
    }

    [Fact]
    public void NoteHint_interpolates_the_character_cap()
    {
        Assert.Equal(
            "Up to 1000 characters. Shared in the audit timeline.",
            AcknowledgeAlertRegistration.NoteHint(Localizer, AcknowledgeAlertRegistration.NoteMaxLength));
    }

    [Fact]
    public void Every_label_routes_through_an_alerts_ack_key()
    {
        var recorder = new RecordingLocalizer();

        ReadAllLabels(recorder);

        Assert.NotEmpty(recorder.Keys);
        Assert.All(
            recorder.Keys,
            key => Assert.StartsWith("alerts.ack.", key, StringComparison.Ordinal));
    }

    // ── View-model: initial (idle) state ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_allows_acknowledging_with_no_note()
    {
        var vm = new AcknowledgeAlertDialogViewModel("Battery over-temperature", Localizer);

        Assert.Equal(string.Empty, vm.Note);
        Assert.False(vm.Submitting);
        Assert.False(vm.TooLong);
        Assert.False(vm.HasNoteError);
        Assert.Null(vm.NoteError);
        Assert.True(vm.CanSubmit); // web: Acknowledge enabled with an empty note (ack-with-no-note)
        Assert.True(vm.CanCancel);
        Assert.True(vm.HasAlertTitle);
        Assert.Equal("Battery over-temperature", vm.AlertTitle);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Missing_alert_title_hides_the_subtitle(string? title)
    {
        var vm = new AcknowledgeAlertDialogViewModel(title, Localizer);

        Assert.False(vm.HasAlertTitle);
        Assert.Equal(string.Empty, vm.AlertTitle);
    }

    [Fact]
    public void Alert_title_is_trimmed()
    {
        var vm = new AcknowledgeAlertDialogViewModel("  Charging fault  ", Localizer);

        Assert.Equal("Charging fault", vm.AlertTitle);
        Assert.True(vm.HasAlertTitle);
    }

    // ── View-model: too-long gate (web tooLong → disabled + error) ───────────────────────────────────────

    [Fact]
    public void Too_long_note_closes_the_submit_gate_and_surfaces_the_error()
    {
        var vm = new AcknowledgeAlertDialogViewModel(null, Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Note = new string('x', AcknowledgeAlertRegistration.NoteMaxLength + 1);

        Assert.True(vm.TooLong);
        Assert.True(vm.HasNoteError);
        Assert.Equal(
            AcknowledgeAlertRegistration.NoteHint(Localizer, AcknowledgeAlertRegistration.NoteMaxLength),
            vm.NoteError);
        Assert.False(vm.CanSubmit);
        Assert.Contains(nameof(AcknowledgeAlertDialogViewModel.CanSubmit), changed);
        Assert.Contains(nameof(AcknowledgeAlertDialogViewModel.TooLong), changed);
        Assert.Contains(nameof(AcknowledgeAlertDialogViewModel.HasNoteError), changed);
        Assert.Contains(nameof(AcknowledgeAlertDialogViewModel.NoteError), changed);
    }

    [Fact]
    public void Trimming_a_note_back_under_the_cap_reopens_the_gate()
    {
        var vm = new AcknowledgeAlertDialogViewModel(null, Localizer);
        vm.Note = new string('x', AcknowledgeAlertRegistration.NoteMaxLength + 5);
        Assert.False(vm.CanSubmit);

        vm.Note = "back under the limit";

        Assert.False(vm.TooLong);
        Assert.True(vm.CanSubmit);
        Assert.Null(vm.NoteError);
    }

    // ── View-model: submitting state (web submitting prop disables both buttons) ─────────────────────────

    [Fact]
    public void Submitting_disables_both_buttons()
    {
        var vm = new AcknowledgeAlertDialogViewModel(null, Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Submitting = true;

        Assert.False(vm.CanSubmit);
        Assert.False(vm.CanCancel);
        Assert.Contains(nameof(AcknowledgeAlertDialogViewModel.CanSubmit), changed);
        Assert.Contains(nameof(AcknowledgeAlertDialogViewModel.CanCancel), changed);
    }

    // ── View-model: acknowledge (web handleSubmit → onSubmit(trimmed)) ───────────────────────────────────

    [Fact]
    public void Submit_emits_the_trimmed_note_and_records()
    {
        var lines = new List<string>();
        var diag = new AcknowledgeAlertDiagnostics(lines.Add);
        var vm = new AcknowledgeAlertDialogViewModel("Tire pressure low", Localizer, diag);
        AcknowledgeAlertDraft? captured = null;
        int closes = 0;
        vm.AcknowledgeRequested += (_, d) => captured = d;
        vm.CloseRequested += (_, _) => closes++;
        vm.Note = "  Refilled to spec  ";

        bool acked = vm.Submit();

        Assert.True(acked);
        Assert.NotNull(captured);
        Assert.Equal("Refilled to spec", captured!.Note);
        Assert.Equal(1, diag.Acknowledged);
        Assert.Equal(0, closes); // an acknowledge is not a cancel
        Assert.Equal("  Refilled to spec  ", vm.Note); // web does not reset on submit, only on (re)open
    }

    [Fact]
    public void Submit_with_a_blank_note_emits_an_empty_note()
    {
        var vm = new AcknowledgeAlertDialogViewModel(null, Localizer);
        AcknowledgeAlertDraft? captured = null;
        vm.AcknowledgeRequested += (_, d) => captured = d;
        vm.Note = "   ";

        bool acked = vm.Submit();

        Assert.True(acked);
        Assert.NotNull(captured);
        Assert.Equal(string.Empty, captured!.Note); // backend accepts an ack with no note
    }

    [Fact]
    public void Submit_when_too_long_is_a_no_op()
    {
        var diag = new AcknowledgeAlertDiagnostics();
        var vm = new AcknowledgeAlertDialogViewModel(null, Localizer, diag);
        int acks = 0;
        vm.AcknowledgeRequested += (_, _) => acks++;
        vm.Note = new string('x', AcknowledgeAlertRegistration.NoteMaxLength + 1);

        bool acked = vm.Submit();

        Assert.False(acked);
        Assert.Equal(0, acks);
        Assert.Equal(0, diag.Acknowledged);
    }

    [Fact]
    public void Submit_while_submitting_is_a_no_op()
    {
        var vm = new AcknowledgeAlertDialogViewModel(null, Localizer);
        int acks = 0;
        vm.AcknowledgeRequested += (_, _) => acks++;
        vm.Note = "Valid note";
        vm.Submitting = true;

        bool acked = vm.Submit();

        Assert.False(acked);
        Assert.Equal(0, acks);
    }

    // ── View-model: cancel / close (web onClose, guarded by !submitting) ─────────────────────────────────

    [Fact]
    public void RequestClose_raises_close_when_idle()
    {
        var vm = new AcknowledgeAlertDialogViewModel(null, Localizer);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;

        bool closed = vm.RequestClose();

        Assert.True(closed);
        Assert.Equal(1, closes);
    }

    [Fact]
    public void RequestClose_while_submitting_is_a_no_op()
    {
        var vm = new AcknowledgeAlertDialogViewModel(null, Localizer);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;
        vm.Submitting = true;

        bool closed = vm.RequestClose();

        Assert.False(closed);
        Assert.Equal(0, closes);
    }

    // ── View-model: reset + diagnostics on open (web open useEffect) ─────────────────────────────────────

    [Fact]
    public void NotifyOpened_resets_the_note_and_submitting_and_records()
    {
        var lines = new List<string>();
        var diag = new AcknowledgeAlertDiagnostics(lines.Add);
        var vm = new AcknowledgeAlertDialogViewModel(null, Localizer, diag);
        vm.Note = "stale text from a previous alert";
        vm.Submitting = true;

        vm.NotifyOpened();

        Assert.Equal(string.Empty, vm.Note);
        Assert.False(vm.Submitting);
        Assert.True(vm.CanSubmit);
        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal("view.opened slug=AcknowledgeAlertDialog", Assert.Single(lines));
    }

    // ── Diagnostics (PII-safe, P1/S11) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void RecordAcknowledged_emits_slug_without_content()
    {
        var lines = new List<string>();
        var diag = new AcknowledgeAlertDiagnostics(lines.Add);

        diag.RecordAcknowledged();

        Assert.Equal(1, diag.Acknowledged);
        Assert.Equal("alert.acknowledged slug=AcknowledgeAlertDialog", Assert.Single(lines));
    }

    private static void ReadAllLabels(ILocalizer localizer)
    {
        var vm = new AcknowledgeAlertDialogViewModel("An alert", localizer);
        _ = vm.Title;
        _ = vm.NoteLabel;
        _ = vm.NotePrompt;
        _ = vm.CancelLabel;
        _ = vm.SubmitLabel;
        _ = vm.NoteHint;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
