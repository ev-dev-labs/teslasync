using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the CopyLinkButton surface's UI-thread-free logic — the registration slug + i18n
/// keys / fallbacks + revert delay (<see cref="CopyLinkButtonRegistration"/>), the copy-outcome → toast
/// projection and per-state confirmation logic (<see cref="CopyLinkButtonViewModel"/>), the current-link + clipboard
/// seams (<see cref="ICurrentLinkProvider"/> / <see cref="IClipboardWriter"/> with their canonical, delegate-backed
/// and inert implementations), the shared toast queue announcements (the real <see cref="ToastController"/>) and the
/// PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/layout/CopyLinkButton.tsx,
/// web/src/components/feedback/Toast.tsx). The WinUI view (CopyLinkButton.cs, which composes a TsButton + revert
/// timer + the platform clipboard writer) is exercised by the app build.
/// </summary>
public sealed class CopyLinkButtonTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingLink : ICurrentLinkProvider
    {
        private readonly string _link;

        public RecordingLink(string link) => _link = link;

        public int Calls { get; private set; }

        public string GetCurrentLink()
        {
            Calls++;
            return _link;
        }
    }

    private sealed class RecordingClipboard : IClipboardWriter
    {
        private readonly bool _result;

        public RecordingClipboard(bool result) => _result = result;

        public List<string> Writes { get; } = new();

        public Task<bool> WriteTextAsync(string text)
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

    private static CopyLinkButtonViewModel NewViewModel(
        ICurrentLinkProvider? link = null,
        IClipboardWriter? clipboard = null,
        IToastController? toast = null,
        ILocalizer? localizer = null) =>
        new(
            link ?? new RecordingLink("teslasync://drives?range=7d"),
            clipboard ?? new RecordingClipboard(true),
            toast ?? new ToastController(),
            localizer ?? PassthroughLocalizer.Instance);

    // ── registration (diagnostics slug + i18n keys/fallbacks + revert delay, web verbatim) ───────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("CopyLinkButton", CopyLinkButtonRegistration.Slug);

    [Fact]
    public void Registration_revert_delay_matches_the_web_two_second_timeout()
    {
        Assert.Equal(2000, CopyLinkButtonRegistration.RevertDelayMs);
        Assert.Equal(TimeSpan.FromMilliseconds(2000), CopyLinkButtonRegistration.RevertDelay);
    }

    [Theory]
    [InlineData(CopyLinkButtonRegistration.ActionKey, "translation.common.copyLink.action")]
    [InlineData(CopyLinkButtonRegistration.CopiedKey, "translation.common.copyLink.copied")]
    [InlineData(CopyLinkButtonRegistration.LabelKey, "translation.common.copyLink.label")]
    [InlineData(CopyLinkButtonRegistration.SuccessKey, "translation.common.copyLink.success")]
    [InlineData(CopyLinkButtonRegistration.ErrorKey, "translation.common.copyLink.error")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(CopyLinkButtonRegistration.ActionFallback, "Copy link")]
    [InlineData(CopyLinkButtonRegistration.CopiedFallback, "Copied")]
    [InlineData(CopyLinkButtonRegistration.LabelFallback, "Copy link to this view")]
    [InlineData(CopyLinkButtonRegistration.SuccessFallback, "Link copied to clipboard")]
    [InlineData(CopyLinkButtonRegistration.ErrorFallback, "Could not copy link")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── adapter: copy outcome → toast intent (web handleClick branch) ────────────────────────────────────

    [Fact]
    public void Outcome_copied_projects_a_success_toast()
    {
        CopyLinkButtonViewModel vm = NewViewModel();

        CopyLinkToastIntent intent = vm.ToastIntentFor(CopyLinkOutcome.Copied);

        Assert.Equal(CopyLinkToastSeverity.Success, intent.Severity);
        Assert.Equal("Link copied to clipboard", intent.Message);
    }

    [Fact]
    public void Outcome_failed_projects_an_error_toast()
    {
        CopyLinkButtonViewModel vm = NewViewModel();

        CopyLinkToastIntent intent = vm.ToastIntentFor(CopyLinkOutcome.Failed);

        Assert.Equal(CopyLinkToastSeverity.Error, intent.Severity);
        Assert.Equal("Could not copy link", intent.Message);
    }

    // ── state: idle (initial render, web copied === false) ───────────────────────────────────────────────

    [Fact]
    public void Idle_shows_the_action_label_and_link_icon()
    {
        CopyLinkButtonViewModel vm = NewViewModel();

        Assert.False(vm.IsCopied);
        Assert.Equal("Copy link", vm.Label);
        Assert.False(vm.ShowCheckIcon);
    }

    // ── state: copied (web try path — setCopied(true) + success toast) ───────────────────────────────────

    [Fact]
    public async Task Successful_copy_writes_the_current_link_to_the_clipboard()
    {
        var link = new RecordingLink("teslasync://drives?range=7d&vehicle_id=2");
        var clipboard = new RecordingClipboard(result: true);
        CopyLinkButtonViewModel vm = NewViewModel(link, clipboard);

        CopyLinkOutcome outcome = await vm.CopyAsync();

        Assert.Equal(CopyLinkOutcome.Copied, outcome);
        Assert.Equal(1, link.Calls);
        Assert.Equal("teslasync://drives?range=7d&vehicle_id=2", Assert.Single(clipboard.Writes));
    }

    [Fact]
    public async Task Successful_copy_enters_the_confirmation_state()
    {
        CopyLinkButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));

        await vm.CopyAsync();

        Assert.True(vm.IsCopied);
        Assert.True(vm.ShowCheckIcon);
        Assert.Equal("Copied", vm.Label);
    }

    [Fact]
    public async Task Successful_copy_announces_the_success_toast_on_the_shared_queue()
    {
        var toast = new ToastController();
        CopyLinkButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true), toast: toast);

        await vm.CopyAsync();

        ToastItem item = Assert.Single(toast.Snapshot);
        Assert.Equal(CalloutVariant.Success, item.Variant);
        Assert.Equal("Link copied to clipboard", item.Title);
    }

    [Fact]
    public async Task Successful_copy_raises_change_for_copied_label_and_icon()
    {
        CopyLinkButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.CopyAsync();

        Assert.Contains(nameof(CopyLinkButtonViewModel.IsCopied), changed);
        Assert.Contains(nameof(CopyLinkButtonViewModel.Label), changed);
        Assert.Contains(nameof(CopyLinkButtonViewModel.ShowCheckIcon), changed);
    }

    // ── state: revert (web setTimeout(() => setCopied(false), 2000)) ─────────────────────────────────────

    [Fact]
    public async Task Reset_copied_reverts_to_the_idle_label_and_icon()
    {
        CopyLinkButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));
        await vm.CopyAsync();
        Assert.True(vm.IsCopied);

        vm.ResetCopied();

        Assert.False(vm.IsCopied);
        Assert.False(vm.ShowCheckIcon);
        Assert.Equal("Copy link", vm.Label);
    }

    // ── state: failed (web catch path — error toast, stays idle) ─────────────────────────────────────────

    [Fact]
    public async Task Failed_copy_stays_idle()
    {
        CopyLinkButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(result: false));

        CopyLinkOutcome outcome = await vm.CopyAsync();

        Assert.Equal(CopyLinkOutcome.Failed, outcome);
        Assert.False(vm.IsCopied);
        Assert.Equal("Copy link", vm.Label);
        Assert.False(vm.ShowCheckIcon);
    }

    [Fact]
    public async Task Failed_copy_announces_the_error_toast_on_the_shared_queue()
    {
        var toast = new ToastController();
        CopyLinkButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(false), toast: toast);

        await vm.CopyAsync();

        ToastItem item = Assert.Single(toast.Snapshot);
        Assert.Equal(CalloutVariant.Danger, item.Variant);
        Assert.Equal("Could not copy link", item.Title);
    }

    // ── accessibility: the constant aria-label (web aria-label, independent of copied state) ─────────────

    [Fact]
    public async Task Accessible_label_is_the_constant_web_aria_label()
    {
        CopyLinkButtonViewModel vm = NewViewModel(clipboard: new RecordingClipboard(true));

        Assert.Equal("Copy link to this view", vm.AccessibleLabel);

        await vm.CopyAsync();

        // The visible label flips to "Copied" but the accessible name does not change (web aria-label is constant).
        Assert.Equal("Copy link to this view", vm.AccessibleLabel);
    }

    // ── i18n: every string flows through the localizer (no hardcoded English in the view-model) ──────────

    [Fact]
    public void Every_label_resolves_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();
        CopyLinkButtonViewModel vm = NewViewModel(localizer: localizer);

        _ = vm.ActionLabel;
        _ = vm.CopiedLabel;
        _ = vm.AccessibleLabel;
        _ = vm.SuccessMessage;
        _ = vm.ErrorMessage;

        Assert.Contains(CopyLinkButtonRegistration.ActionKey, localizer.RequestedKeys);
        Assert.Contains(CopyLinkButtonRegistration.CopiedKey, localizer.RequestedKeys);
        Assert.Contains(CopyLinkButtonRegistration.LabelKey, localizer.RequestedKeys);
        Assert.Contains(CopyLinkButtonRegistration.SuccessKey, localizer.RequestedKeys);
        Assert.Contains(CopyLinkButtonRegistration.ErrorKey, localizer.RequestedKeys);
    }

    // ── constructor guards ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Constructor_rejects_null_seams()
    {
        ICurrentLinkProvider link = NoOpCurrentLinkProvider.Instance;
        IClipboardWriter clipboard = NoOpClipboardWriter.Instance;
        IToastController toast = new ToastController();
        ILocalizer localizer = PassthroughLocalizer.Instance;

        Assert.Throws<ArgumentNullException>(() => new CopyLinkButtonViewModel(null!, clipboard, toast, localizer));
        Assert.Throws<ArgumentNullException>(() => new CopyLinkButtonViewModel(link, null!, toast, localizer));
        Assert.Throws<ArgumentNullException>(() => new CopyLinkButtonViewModel(link, clipboard, null!, localizer));
        Assert.Throws<ArgumentNullException>(() => new CopyLinkButtonViewModel(link, clipboard, toast, null!));
    }

    // ── seams: delegate-backed + inert implementations ──────────────────────────────────────────────────

    [Fact]
    public void Delegate_link_provider_returns_the_delegate_value()
    {
        var provider = new DelegateCurrentLinkProvider(() => "teslasync://map?layer=traffic");

        Assert.Equal("teslasync://map?layer=traffic", provider.GetCurrentLink());
    }

    [Fact]
    public void Delegate_link_provider_degrades_a_null_delegate_to_empty()
    {
        var provider = new DelegateCurrentLinkProvider(null);

        Assert.Equal(string.Empty, provider.GetCurrentLink());
    }

    [Fact]
    public void NoOp_link_provider_returns_empty() =>
        Assert.Equal(string.Empty, NoOpCurrentLinkProvider.Instance.GetCurrentLink());

    [Fact]
    public async Task Delegate_clipboard_writer_forwards_to_the_delegate()
    {
        string? captured = null;
        var writer = new DelegateClipboardWriter(text =>
        {
            captured = text;
            return Task.FromResult(true);
        });

        bool ok = await writer.WriteTextAsync("teslasync://notifications?unread=1");

        Assert.True(ok);
        Assert.Equal("teslasync://notifications?unread=1", captured);
    }

    [Fact]
    public async Task Delegate_clipboard_writer_degrades_a_null_delegate_to_failure()
    {
        var writer = new DelegateClipboardWriter(null);

        Assert.False(await writer.WriteTextAsync("anything"));
    }

    [Fact]
    public async Task NoOp_clipboard_writer_reports_failure() =>
        Assert.False(await NoOpClipboardWriter.Instance.WriteTextAsync("anything"));

    // ── diagnostics (view.opened, PII-safe — never the link or clipboard payload) ────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CopyLinkButtonDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CopyLinkButton", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new CopyLinkButtonDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
