using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TOTPEnrollmentSection</c> surface's Microsoft.UI-free logic — the state machine
/// the web component drives (loading / open-mode / not-enrolled / active), the enroll → verify → backup-codes flow,
/// the typed-confirmation disable, backup-code regeneration, the classified verify errors and the full localized
/// label set. Mirrors the web component (web/src/features/settings/components/TOTPEnrollmentSection.tsx); the WinUI
/// view (the glass panel + the three Fluent dialogs) is exercised by the app build.
/// </summary>
public sealed class TotpEnrollmentSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Every web settings.totp.* key the section resolves through the i18n facade (web key names, verbatim).
    private static readonly string[] SectionStringKeys =
    [
        "settings.totp.title",
        "settings.totp.subtitle",
        "settings.totp.openMode.message",
        "settings.totp.status.active",
        "settings.totp.status.notEnrolled",
        "settings.totp.loading",
        "settings.totp.lastUsed.label",
        "settings.totp.lastUsed.never",
        "settings.totp.backupCodesRemaining.label",
        "settings.totp.actions.regenerate",
        "settings.totp.actions.disable",
        "settings.totp.actions.enroll",
        "settings.totp.actions.enrollHint",
        "settings.totp.modal.enrollTitle",
        "settings.totp.modal.scanInstructions",
        "settings.totp.modal.qrAlt",
        "settings.totp.modal.manualLabel",
        "settings.totp.modal.codeLabel",
        "settings.totp.modal.cancel",
        "settings.totp.modal.verify",
        "settings.totp.backupCodes.title",
        "settings.totp.backupCodes.warning",
        "settings.totp.backupCodes.download",
        "settings.totp.backupCodes.done",
        "settings.totp.disable.title",
        "settings.totp.disable.message",
        "settings.totp.disable.confirm",
        "settings.totp.disable.cancel",
        "settings.totp.disable.typedLabel",
        "settings.totp.errors.codeLength",
        "settings.totp.errors.invalidCode",
        "settings.totp.errors.rateLimited",
        "settings.totp.errors.enrollmentExpired",
        "settings.totp.errors.verifyGeneric",
        "settings.totp.backupCodes.fileHeader",
    ];

    // ---- State machine -------------------------------------------------------------

    [Fact]
    public async Task Open_mode_controller_resolves_the_open_state()
    {
        var vm = new TotpEnrollmentSectionViewModel(OpenModeTotpController.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(TotpSectionState.OpenMode, vm.State);
        Assert.False(vm.IsActivated);
        Assert.Equal("Not enrolled", vm.StatusPillText);
    }

    [Fact]
    public async Task Forward_auth_not_activated_resolves_the_not_enrolled_state()
    {
        var controller = new FakeTotpController
        {
            Status = new TotpStatus { Mode = TotpMode.ForwardAuth, Activated = false },
        };
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);

        await vm.LoadAsync();

        Assert.Equal(TotpSectionState.NotEnrolled, vm.State);
        Assert.Equal("Not enrolled", vm.StatusPillText);
        Assert.Equal(0, vm.BackupCodesRemaining);
    }

    [Fact]
    public async Task Forward_auth_activated_resolves_the_active_state_with_last_used_and_backup_count()
    {
        var lastUsed = new DateTimeOffset(2026, 6, 1, 12, 0, 0, TimeSpan.Zero);
        var controller = new FakeTotpController
        {
            Status = new TotpStatus
            {
                Mode = TotpMode.ForwardAuth,
                Activated = true,
                LastUsedAt = lastUsed,
                BackupCodesRemaining = 7,
            },
        };
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer, _ => "formatted-time");

        await vm.LoadAsync();

        Assert.Equal(TotpSectionState.Active, vm.State);
        Assert.True(vm.IsActivated);
        Assert.Equal("Active", vm.StatusPillText);
        Assert.Equal(7, vm.BackupCodesRemaining);
        Assert.Equal("formatted-time", vm.LastUsedText);
    }

    [Fact]
    public async Task Active_without_last_used_shows_never()
    {
        var controller = new FakeTotpController
        {
            Status = new TotpStatus { Mode = TotpMode.ForwardAuth, Activated = true, LastUsedAt = null },
        };
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);

        await vm.LoadAsync();

        Assert.Equal("Never", vm.LastUsedText);
    }

    [Fact]
    public async Task A_failed_status_read_degrades_to_the_open_mode_notice()
    {
        var controller = new FakeTotpController { ThrowOnStatus = true };
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);

        await vm.LoadAsync();

        Assert.Equal(TotpSectionState.OpenMode, vm.State);
    }

    // ---- Enroll → verify → backup-codes --------------------------------------------

    [Fact]
    public async Task Start_enroll_opens_the_enroll_modal_with_the_returned_material()
    {
        var enrollment = new TotpEnrollment
        {
            Secret = "JBSWY3DPEHPK3PXP",
            QrDataUri = "data:image/png;base64,QQ==",
            BackupCodes = new[] { "aaaa-bbbb", "cccc-dddd" },
        };
        var controller = new FakeTotpController
        {
            Status = new TotpStatus { Mode = TotpMode.ForwardAuth, Activated = false },
            Enrollment = enrollment,
        };
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);
        await vm.LoadAsync();

        await vm.StartEnrollAsync();

        Assert.Equal(TotpDialogStep.Enroll, vm.DialogStep);
        Assert.Same(enrollment, vm.Enrollment);
    }

    [Fact]
    public void Set_verify_code_keeps_only_digits_and_at_most_six()
    {
        var vm = new TotpEnrollmentSectionViewModel(OpenModeTotpController.Instance, Localizer);

        vm.SetVerifyCode("1a2b3c4d5e6f7g");

        Assert.Equal("123456", vm.VerifyCode);
    }

    [Fact]
    public async Task Verify_with_fewer_than_six_digits_sets_the_length_error()
    {
        var vm = new TotpEnrollmentSectionViewModel(NewForwardAuthEnrolling(), Localizer);
        await vm.LoadAsync();
        await vm.StartEnrollAsync();
        vm.SetVerifyCode("123");

        await vm.VerifyAsync();

        Assert.Equal("Enter all 6 digits.", vm.VerifyError);
        Assert.Equal(TotpDialogStep.Enroll, vm.DialogStep);
    }

    [Theory]
    [InlineData(TotpErrorKind.InvalidCode, "Code did not match. Try the next one.")]
    [InlineData(TotpErrorKind.RateLimited, "Too many incorrect attempts. Try again in 15 minutes.")]
    [InlineData(TotpErrorKind.EnrollmentExpired, "Enrollment expired. Close and start over.")]
    [InlineData(TotpErrorKind.Generic, "Verification failed.")]
    public async Task Verify_maps_each_failure_kind_to_its_inline_message(TotpErrorKind kind, string expected)
    {
        var controller = NewForwardAuthEnrolling();
        controller.VerifyError = kind;
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);
        await vm.LoadAsync();
        await vm.StartEnrollAsync();
        vm.SetVerifyCode("123456");

        await vm.VerifyAsync();

        Assert.Equal(expected, vm.VerifyError);
        Assert.Equal(TotpDialogStep.Enroll, vm.DialogStep);
    }

    [Fact]
    public async Task A_successful_verify_reveals_the_backup_codes_and_opens_the_backup_modal()
    {
        var controller = NewForwardAuthEnrolling();
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);
        await vm.LoadAsync();
        await vm.StartEnrollAsync();
        vm.SetVerifyCode("123456");

        await vm.VerifyAsync();

        Assert.Null(vm.VerifyError);
        Assert.Equal(TotpDialogStep.BackupCodes, vm.DialogStep);
        Assert.Equal(controller.Enrollment.BackupCodes, vm.RevealedCodes);
    }

    // ---- Disable -------------------------------------------------------------------

    [Fact]
    public async Task Disable_flow_revokes_and_re_reads_the_status()
    {
        var controller = new FakeTotpController
        {
            Status = new TotpStatus { Mode = TotpMode.ForwardAuth, Activated = true, BackupCodesRemaining = 5 },
        };
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);
        await vm.LoadAsync();

        vm.StartDisable();
        Assert.True(vm.ShowDisableConfirm);

        await vm.ConfirmDisableAsync();

        Assert.True(controller.Revoked);
        Assert.False(vm.ShowDisableConfirm);
        Assert.Equal(TotpSectionState.NotEnrolled, vm.State);
    }

    [Fact]
    public void Cancel_disable_closes_the_confirmation()
    {
        var vm = new TotpEnrollmentSectionViewModel(OpenModeTotpController.Instance, Localizer);

        vm.StartDisable();
        vm.CancelDisable();

        Assert.False(vm.ShowDisableConfirm);
    }

    // ---- Regenerate ----------------------------------------------------------------

    [Fact]
    public async Task Regenerate_reveals_the_new_codes_and_opens_the_backup_modal()
    {
        var controller = new FakeTotpController
        {
            Status = new TotpStatus { Mode = TotpMode.ForwardAuth, Activated = true, BackupCodesRemaining = 2 },
            Enrollment = new TotpEnrollment { BackupCodes = new[] { "1111", "2222", "3333" } },
        };
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);
        await vm.LoadAsync();

        await vm.RegenerateAsync();

        Assert.True(controller.Regenerated);
        Assert.Equal(TotpDialogStep.BackupCodes, vm.DialogStep);
        Assert.Equal(new[] { "1111", "2222", "3333" }, vm.RevealedCodes);
    }

    [Fact]
    public async Task Close_dialog_clears_the_enrollment_and_verify_state()
    {
        var controller = NewForwardAuthEnrolling();
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);
        await vm.LoadAsync();
        await vm.StartEnrollAsync();
        vm.SetVerifyCode("123456");

        vm.CloseDialog();

        Assert.Equal(TotpDialogStep.Closed, vm.DialogStep);
        Assert.Null(vm.Enrollment);
        Assert.Null(vm.RevealedCodes);
        Assert.Equal(string.Empty, vm.VerifyCode);
        Assert.Null(vm.VerifyError);
    }

    // ---- Backup-codes download -----------------------------------------------------

    [Fact]
    public async Task Backup_codes_file_content_has_the_header_blank_line_and_codes()
    {
        var controller = new FakeTotpController
        {
            Status = new TotpStatus { Mode = TotpMode.ForwardAuth, Activated = true },
            Enrollment = new TotpEnrollment { BackupCodes = new[] { "aaaa", "bbbb" } },
        };
        var vm = new TotpEnrollmentSectionViewModel(controller, Localizer);
        await vm.LoadAsync();
        await vm.RegenerateAsync();

        var body = vm.BackupCodesFileContent();

        Assert.Equal("# TeslaSync TOTP backup codes — keep secret.\n\naaaa\nbbbb\n", body);
    }

    [Fact]
    public void Backup_codes_file_content_is_empty_when_there_are_no_codes()
    {
        var vm = new TotpEnrollmentSectionViewModel(OpenModeTotpController.Instance, Localizer);

        Assert.Equal(string.Empty, vm.BackupCodesFileContent());
    }

    // ---- Inert controller ----------------------------------------------------------

    [Fact]
    public async Task Open_mode_controller_reports_the_open_status()
    {
        var status = await OpenModeTotpController.Instance.GetStatusAsync();

        Assert.Equal(TotpMode.Open, status.Mode);
        Assert.False(status.Activated);
    }

    [Fact]
    public async Task Open_mode_controller_rejects_mutations()
    {
        await Assert.ThrowsAsync<NotSupportedException>(() => OpenModeTotpController.Instance.EnrollAsync());
        await Assert.ThrowsAsync<NotSupportedException>(() => OpenModeTotpController.Instance.VerifyAsync("123456"));
        await Assert.ThrowsAsync<NotSupportedException>(() => OpenModeTotpController.Instance.RevokeAsync());
        await Assert.ThrowsAsync<NotSupportedException>(
            () => OpenModeTotpController.Instance.RegenerateBackupCodesAsync());
    }

    // ---- Strings + diagnostics + guards --------------------------------------------

    [Fact]
    public void Projection_resolves_every_section_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = TotpEnrollmentProjection.Strings(recorder);
        _ = TotpEnrollmentProjection.CodeLengthError(recorder);
        foreach (var kind in Enum.GetValues<TotpErrorKind>())
        {
            _ = TotpEnrollmentProjection.VerifyError(recorder, kind);
        }

        _ = TotpEnrollmentProjection.BackupCodesFileContent(recorder, new[] { "x" });

        foreach (var key in SectionStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Strings_resolve_with_the_web_english_defaults()
    {
        var strings = TotpEnrollmentProjection.Strings(Localizer);

        Assert.Equal("Two-factor authentication", strings.Title);
        Assert.Equal("Active", strings.StatusActive);
        Assert.Equal("Not enrolled", strings.StatusNotEnrolled);
        Assert.Equal("Enable TOTP", strings.ActionEnroll);
        Assert.Equal("Type DISABLE to confirm", strings.DisableTypedLabel);
    }

    [Fact]
    public void Disable_confirmation_phrase_matches_the_web_typed_confirmation()
    {
        Assert.Equal("DISABLE", TotpEnrollmentProjection.DisableConfirmationPhrase);
    }

    [Fact]
    public void View_model_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(
            () => new TotpEnrollmentSectionViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(
            () => new TotpEnrollmentSectionViewModel(OpenModeTotpController.Instance, null!));
    }

    [Fact]
    public void Diagnostics_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new TotpEnrollmentDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=TOTPEnrollmentSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static FakeTotpController NewForwardAuthEnrolling() => new()
    {
        Status = new TotpStatus { Mode = TotpMode.ForwardAuth, Activated = false },
        Enrollment = new TotpEnrollment
        {
            Secret = "JBSWY3DPEHPK3PXP",
            QrDataUri = "data:image/png;base64,QQ==",
            BackupCodes = new[] { "aaaa-bbbb", "cccc-dddd" },
        },
    };

    private sealed class FakeTotpController : ITotpEnrollmentController
    {
        public TotpStatus Status { get; set; } = TotpStatus.OpenMode;

        public TotpEnrollment Enrollment { get; set; } = new();

        public TotpErrorKind? VerifyError { get; set; }

        public bool ThrowOnStatus { get; set; }

        public bool Revoked { get; private set; }

        public bool Regenerated { get; private set; }

        public Task<TotpStatus> GetStatusAsync(CancellationToken cancellationToken = default)
        {
            if (ThrowOnStatus)
            {
                throw new InvalidOperationException("status read failed");
            }

            return Task.FromResult(Status);
        }

        public Task<TotpEnrollment> EnrollAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Enrollment);

        public Task VerifyAsync(string code, CancellationToken cancellationToken = default) =>
            VerifyError is { } kind ? throw new TotpException(kind) : Task.CompletedTask;

        public Task RevokeAsync(CancellationToken cancellationToken = default)
        {
            Revoked = true;
            Status = new TotpStatus { Mode = TotpMode.ForwardAuth, Activated = false };
            return Task.CompletedTask;
        }

        public Task<TotpEnrollment> RegenerateBackupCodesAsync(CancellationToken cancellationToken = default)
        {
            Regenerated = true;
            return Task.FromResult(Enrollment);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
