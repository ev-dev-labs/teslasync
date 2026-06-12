using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the CopyButton surface's UI-thread-free logic — the registration slug + i18n
/// keys / fallbacks + revert delay (<see cref="CopyButtonRegistration"/>), the copy-outcome → toast projection,
/// the <c>withToast</c> opt-in gating and nullable-overlay degradation, the per-state confirmation logic and the
/// label / accessible-name projections (<see cref="CopyButtonViewModel"/>), the clipboard seam
/// (<see cref="IClipboardCopier"/> with its delegate-backed and inert implementations), the shared toast queue
/// announcements (the real <see cref="ToastController"/>) and the PII-safe diagnostics. Mirrors the web spec
/// one-for-one (web/src/components/ui/CopyButton.tsx, web/src/components/feedback/Toast.tsx). The WinUI view
/// (CopyButton.cs, which composes a TsButton + revert timer + the platform clipboard writer) is exercised by the
/// app build.
/// </summary>
public sealed class CopyButtonTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingClipboard : IClipboardCopier
    {
        private readonly bool _result;

        public RecordingClipboard(bool result) => _result = result;

        public List<string> Writes { get; } = new();

        public Task<bool> CopyTextAsync(string text)
        {
            Writes.Add(text);
            return Task.FromResult(_result);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static CopyButtonViewModel NewViewModel(
        IClipboardCopier? clipboard = null,
        IToastController? toast = null,
        ILocalizer? localizer = null,
        CopyButtonDiagnostics? diagnostics = null,
        bool withToast = false,
        string text = "hello-world")
    {
        var vm = new CopyButtonViewModel(
            clipboard ?? new RecordingClipboard(true),
            toast,
            localizer ?? PassthroughLocalizer.Instance,
            diagnostics)
        {
            Text = text,
            WithToast = withToast,
        };
        return vm;
    }

    // ── registration (diagnostics slug + i18n keys/fallbacks + revert delay, web verbatim) ───────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("CopyButton", CopyButtonRegistration.Slug);

    [Fact]
    public void Registration_revert_delay_matches_the_web_two_second_timeout()
    {
        Assert.Equal(2000, CopyButtonRegistration.RevertDelayMs);
        Assert.Equal(TimeSpan.FromMilliseconds(2000), CopyButtonRegistration.RevertDelay);
    }

    [Theory]
    [InlineData(CopyButtonRegistration.CopyKey, "translation.common.copyButton.copy")]
    [InlineData(CopyButtonRegistration.CopiedKey, "translation.common.copyButton.copied")]
    [InlineData(CopyButtonRegistration.SuccessToastKey, "translation.common.copyButton.successToast")]
    [InlineData(CopyButtonRegistration.ErrorToastKey, "translation.common.copyButton.errorToast")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(CopyButtonRegistration.CopyFallback, "Copy")]
    [InlineData(CopyButtonRegistration.CopiedFallback, "Copied")]
    [InlineData(CopyButtonRegistration.SuccessToastFallback, "Copied to clipboard")]
    [InlineData(CopyButtonRegistration.ErrorToastFallback, "Failed to copy")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── adapter: copy outcome → toast intent (web handleCopy branch, unconditional mapping) ───────────────

    [Fact]
    public void Outcome_copied_projects_a_success_toast()
    {
        CopyButtonViewModel vm = NewViewModel();

        CopyButtonToastIntent intent = vm.ToastIntentFor(CopyButtonOutcome.Copied);

        Assert.Equal(CopyButtonToastSeverity.Success, intent.Severity);
        Assert.Equal("Copied to clipboard", intent.Message);
    }

    [Fact]
    public void Outcome_failed_projects_an_error_toast()
    {
        CopyButtonViewModel vm = NewViewModel();

        CopyButtonToastIntent intent = vm.ToastIntentFor(CopyButtonOutcome.Failed);

        Assert.Equal(CopyButtonToastSeverity.Error, intent.Severity);
        Assert.Equal("Failed to copy", intent.Message);
    }

    // ── state: idle (initial render, web copied === false) ───────────────────────────────────────────────

    [Fact]
    public void Idle_shows_the_copy_label_and_copy_icon()
    {
        CopyButtonViewModel vm = NewViewModel();

        Assert.False(vm.IsCopied);
        Assert.Equal("Copy", vm.VisibleLabel);
        Assert.False(vm.ShowCheckIcon);
    }

    // ── state: copied (web try path — setCopied(true) + onCopy?.()) ──────────────────────────────────────

    [Fact]
    public async Task Successful_copy_writes_the_text_to_the_clipboard()
    {
        var clipboard = new RecordingClipboard(result: true);
        CopyButtonViewModel vm = NewViewModel(clipboard, text: "sk-test-api-key-123");

        CopyButtonOutcome outcome = await vm.CopyAsync();

        Assert.Equal(CopyButtonOutcome.Copied, outcome);
        Assert.Equal("sk-test-api-key-123", Assert.Single(clipboard.Writes));
    }

    [Fact]
    public async Task Successful_copy_enters_the_confirmation_state()
    {
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));

        await vm.CopyAsync();

        Assert.True(vm.IsCopied);
        Assert.True(vm.ShowCheckIcon);
        Assert.Equal("Copied", vm.VisibleLabel);
    }

    [Fact]
    public async Task Successful_copy_invokes_the_onCopy_callback_once()
    {
        var calls = 0;
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));
        vm.OnCopy = () => calls++;

        await vm.CopyAsync();

        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task Successful_copy_raises_change_for_copied_label_and_icon()
    {
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.CopyAsync();

        Assert.Contains(nameof(CopyButtonViewModel.IsCopied), changed);
        Assert.Contains(nameof(CopyButtonViewModel.ShowCheckIcon), changed);
        Assert.Contains(nameof(CopyButtonViewModel.VisibleLabel), changed);
    }

    // ── toast gating: withToast opt-in (web `if (withToast) toast?.success/error(...)`) ──────────────────

    [Fact]
    public async Task Successful_copy_with_toast_announces_the_success_toast_on_the_shared_queue()
    {
        var toast = new ToastController();
        CopyButtonViewModel vm = NewViewModel(
            clipboard: new RecordingClipboard(true), toast: toast, withToast: true);

        await vm.CopyAsync();

        ToastItem item = Assert.Single(toast.Snapshot);
        Assert.Equal(CalloutVariant.Success, item.Variant);
        Assert.Equal("Copied to clipboard", item.Title);
    }

    [Fact]
    public async Task Failed_copy_with_toast_announces_the_error_toast_on_the_shared_queue()
    {
        var toast = new ToastController();
        CopyButtonViewModel vm = NewViewModel(
            clipboard: new RecordingClipboard(false), toast: toast, withToast: true);

        await vm.CopyAsync();

        ToastItem item = Assert.Single(toast.Snapshot);
        Assert.Equal(CalloutVariant.Danger, item.Variant);
        Assert.Equal("Failed to copy", item.Title);
    }

    [Fact]
    public async Task Copy_without_withToast_raises_no_toast()
    {
        var toast = new ToastController();
        CopyButtonViewModel vm = NewViewModel(
            clipboard: new RecordingClipboard(true), toast: toast, withToast: false);

        await vm.CopyAsync();

        Assert.Empty(toast.Snapshot);
    }

    [Fact]
    public async Task Copy_with_toast_opt_in_but_no_overlay_degrades_gracefully()
    {
        // web useOptionalToast() returns null outside a ToastProvider; toast?.success(...) is then a no-op.
        CopyButtonViewModel vm = NewViewModel(
            clipboard: new RecordingClipboard(true), toast: null, withToast: true);

        CopyButtonOutcome outcome = await vm.CopyAsync();

        Assert.Equal(CopyButtonOutcome.Copied, outcome);
        Assert.True(vm.IsCopied);
    }

    // ── state: revert (web setTimeout(() => setCopied(false), 2000)) ─────────────────────────────────────

    [Fact]
    public async Task Reset_copied_reverts_to_the_idle_label_and_icon()
    {
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));
        await vm.CopyAsync();
        Assert.True(vm.IsCopied);

        vm.ResetCopied();

        Assert.False(vm.IsCopied);
        Assert.False(vm.ShowCheckIcon);
        Assert.Equal("Copy", vm.VisibleLabel);
    }

    // ── state: failed (web catch path — optional error toast + console.error, stays idle) ────────────────

    [Fact]
    public async Task Failed_copy_stays_idle()
    {
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(result: false));

        CopyButtonOutcome outcome = await vm.CopyAsync();

        Assert.Equal(CopyButtonOutcome.Failed, outcome);
        Assert.False(vm.IsCopied);
        Assert.Equal("Copy", vm.VisibleLabel);
        Assert.False(vm.ShowCheckIcon);
    }

    [Fact]
    public async Task Failed_copy_does_not_invoke_the_onCopy_callback()
    {
        var calls = 0;
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(false));
        vm.OnCopy = () => calls++;

        await vm.CopyAsync();

        Assert.Equal(0, calls);
    }

    [Fact]
    public async Task Failed_copy_records_the_failed_write_diagnostic()
    {
        var lines = new List<string>();
        var diagnostics = new CopyButtonDiagnostics(lines.Add);
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(false), diagnostics: diagnostics);

        await vm.CopyAsync();

        Assert.Equal(1, diagnostics.CopyFailures);
        Assert.Equal("copy.failed slug=CopyButton", Assert.Single(lines));
    }

    [Fact]
    public async Task Successful_copy_records_no_failed_write_diagnostic()
    {
        var diagnostics = new CopyButtonDiagnostics();
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true), diagnostics: diagnostics);

        await vm.CopyAsync();

        Assert.Equal(0, diagnostics.CopyFailures);
    }

    // ── state: icon-only (web iconOnly — no visible text, accessible name retained) ──────────────────────

    [Fact]
    public void IconOnly_hides_the_visible_label_but_keeps_an_accessible_name()
    {
        CopyButtonViewModel vm = NewViewModel();
        vm.IconOnly = true;

        Assert.Null(vm.VisibleLabel);
        Assert.Equal("Copy", vm.ResolvedAriaLabel);
    }

    [Fact]
    public async Task IconOnly_accessible_name_toggles_to_copied_after_a_copy()
    {
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));
        vm.IconOnly = true;

        await vm.CopyAsync();

        Assert.Null(vm.VisibleLabel);
        Assert.Equal("Copied", vm.ResolvedAriaLabel);
    }

    // ── label override (web label — pins the visible text across both states; only the icon toggles) ─────

    [Fact]
    public async Task Label_override_pins_the_visible_text_across_idle_and_copied()
    {
        CopyButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));
        vm.LabelOverride = "Copy link";

        Assert.Equal("Copy link", vm.VisibleLabel);

        await vm.CopyAsync();

        // web: label ?? (copied ? copiedLabel : copyLabel) — the override wins in both states; only the icon flips.
        Assert.Equal("Copy link", vm.VisibleLabel);
        Assert.True(vm.ShowCheckIcon);
    }

    // ── accessibility: the resolved aria-label (web resolvedAriaLabel) ───────────────────────────────────

    [Fact]
    public void Visible_label_serves_as_the_name_when_not_icon_only_and_no_override()
    {
        // web: resolvedAriaLabel = ariaLabel ?? (iconOnly ? ... : undefined) — null lets the visible text be the name.
        CopyButtonViewModel vm = NewViewModel();

        Assert.Null(vm.ResolvedAriaLabel);
        Assert.Equal("Copy", vm.VisibleLabel);
    }

    [Fact]
    public void Aria_label_override_wins_over_the_auto_generated_name()
    {
        CopyButtonViewModel vm = NewViewModel();
        vm.AriaLabelOverride = "Copy API key";

        // Wins whether icon-only or not.
        Assert.Equal("Copy API key", vm.ResolvedAriaLabel);

        vm.IconOnly = true;
        Assert.Equal("Copy API key", vm.ResolvedAriaLabel);
    }

    // ── i18n: every string flows through the localizer (no hardcoded English in the view-model) ──────────

    [Fact]
    public void Every_label_resolves_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();
        CopyButtonViewModel vm = NewViewModel(localizer: localizer);

        _ = vm.CopyLabel;
        _ = vm.CopiedLabel;
        _ = vm.SuccessToastMessage;
        _ = vm.ErrorToastMessage;

        Assert.Contains(CopyButtonRegistration.CopyKey, localizer.RequestedKeys);
        Assert.Contains(CopyButtonRegistration.CopiedKey, localizer.RequestedKeys);
        Assert.Contains(CopyButtonRegistration.SuccessToastKey, localizer.RequestedKeys);
        Assert.Contains(CopyButtonRegistration.ErrorToastKey, localizer.RequestedKeys);
    }

    // ── constructor guards (clipboard + localizer required; toast nullable per useOptionalToast) ─────────

    [Fact]
    public void Constructor_rejects_null_required_seams_but_allows_a_null_toast()
    {
        IClipboardCopier clipboard = NoOpClipboardCopier.Instance;
        ILocalizer localizer = PassthroughLocalizer.Instance;

        Assert.Throws<ArgumentNullException>(() => new CopyButtonViewModel(null!, null, localizer));
        Assert.Throws<ArgumentNullException>(() => new CopyButtonViewModel(clipboard, null, null!));

        // A null toast is valid — it is the web useOptionalToast() degradation.
        var vm = new CopyButtonViewModel(clipboard, null, localizer);
        Assert.NotNull(vm);
    }

    // ── seams: delegate-backed + inert implementations ──────────────────────────────────────────────────

    [Fact]
    public async Task Delegate_clipboard_copier_forwards_to_the_delegate()
    {
        string? captured = null;
        var copier = new DelegateClipboardCopier(text =>
        {
            captured = text;
            return Task.FromResult(true);
        });

        bool ok = await copier.CopyTextAsync("vin-5YJ3E1EA7KF000000");

        Assert.True(ok);
        Assert.Equal("vin-5YJ3E1EA7KF000000", captured);
    }

    [Fact]
    public async Task Delegate_clipboard_copier_degrades_a_null_delegate_to_failure()
    {
        var copier = new DelegateClipboardCopier(null);

        Assert.False(await copier.CopyTextAsync("anything"));
    }

    [Fact]
    public async Task NoOp_clipboard_copier_reports_failure() =>
        Assert.False(await NoOpClipboardCopier.Instance.CopyTextAsync("anything"));

    // ── diagnostics (view.opened + copy.failed, PII-safe — never the copied text) ────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CopyButtonDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CopyButton", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_record_emits_copy_failed_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CopyButtonDiagnostics(lines.Add);

        diagnostics.RecordCopyFailed();

        Assert.Equal(1, diagnostics.CopyFailures);
        Assert.Equal("copy.failed slug=CopyButton", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new CopyButtonDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
