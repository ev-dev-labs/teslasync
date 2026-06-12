using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.MaskedValueSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the MaskedValue surface's UI-thread-free logic — the registration slug + auto-hide
/// lifetime + i18n keys / fallbacks (<see cref="MaskedValueRegistration"/>), the masking projection
/// (<see cref="MaskedValueProjection"/>, the surface's data adapter — every web <c>maskFor</c> variant), the
/// per-state masked / revealed / empty logic and the label / accessible-name projections
/// (<see cref="MaskedValueViewModel"/>), the opt-in reveal audit and its silent-failure contract, the reveal
/// audit seam (<see cref="IRevealAuditSink"/> with its delegate-backed and inert implementations) and the
/// PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/ui/MaskedValue.tsx,
/// web/src/lib/maskValue.ts). The WinUI view (MaskedValue.cs, which composes the code run, the TsButton toggle,
/// the embedded CopyButton and the one-shot auto-hide timer) is exercised by the app build.
/// </summary>
public sealed class MaskedValueTests
{
    private const string Bullet = "\u2022";
    private const string EmDash = "\u2014";

    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingAuditSink : IRevealAuditSink
    {
        public List<string> Variants { get; } = new();

        public Task PostRevealAsync(string variant)
        {
            Variants.Add(variant);
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingAuditSink : IRevealAuditSink
    {
        public Task PostRevealAsync(string variant) => throw new InvalidOperationException("audit endpoint down");
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

    private static MaskedValueViewModel NewViewModel(
        IRevealAuditSink? audit = null,
        ILocalizer? localizer = null,
        MaskedValueDiagnostics? diagnostics = null,
        string? value = "sk-live-1234567890",
        MaskedValueVariant variant = MaskedValueVariant.Token,
        bool copyable = false,
        bool auditOnReveal = false,
        string ariaLabel = "API key, click to reveal")
    {
        return new MaskedValueViewModel(
            audit ?? NoOpRevealAuditSink.Instance,
            localizer ?? PassthroughLocalizer.Instance,
            diagnostics)
        {
            Value = value,
            Variant = variant,
            Copyable = copyable,
            AuditOnReveal = auditOnReveal,
            AriaLabel = ariaLabel,
        };
    }

    // ── registration (diagnostics slug + auto-hide lifetime + i18n keys/fallbacks, web verbatim) ──────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("MaskedValue", MaskedValueRegistration.Slug);

    [Fact]
    public void Registration_auto_hide_matches_the_web_thirty_second_default()
    {
        Assert.Equal(30_000, MaskedValueRegistration.DefaultAutoHideMs);
        Assert.Equal(TimeSpan.FromMilliseconds(30_000), MaskedValueRegistration.DefaultAutoHide);
    }

    [Theory]
    [InlineData(MaskedValueRegistration.HideKey, "translation.mask.hide")]
    [InlineData(MaskedValueRegistration.RevealKey, "translation.mask.reveal")]
    [InlineData(MaskedValueRegistration.CopyKey, "translation.mask.copy")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(MaskedValueRegistration.HideFallback, "Hide value")]
    [InlineData(MaskedValueRegistration.RevealFallback, "Reveal value")]
    [InlineData(MaskedValueRegistration.CopyFallback, "Copy value")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(MaskedValueRegistration.AuditKind, "masked_reveal")]
    [InlineData(MaskedValueRegistration.AuditPath, "/audit/reveal")]
    public void Reveal_audit_payload_matches_the_web_helper(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── adapter: masking projection (web maskFor + per-variant strategies) ───────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Mask_projects_empty_input_to_the_empty_string(string? value) =>
        Assert.Equal(string.Empty, MaskedValueProjection.Mask(value, MaskedValueVariant.Generic));

    [Fact]
    public void Mask_token_shows_a_fixed_bullet_run_plus_the_last_four()
    {
        string masked = MaskedValueProjection.Mask("abcdefgh", MaskedValueVariant.Token);

        Assert.Equal(new string('\u2022', 12) + "efgh", masked);
    }

    [Fact]
    public void Mask_token_respects_a_show_last_override()
    {
        string masked = MaskedValueProjection.Mask("abcdefgh", MaskedValueVariant.Token, showLast: 2);

        Assert.EndsWith("gh", masked);
        Assert.StartsWith(Bullet, masked);
    }

    [Fact]
    public void Mask_token_does_not_leak_the_original_length()
    {
        // web: a 16-char token and a 64-char token must look the same when masked (fixed bullet run).
        string shortToken = MaskedValueProjection.Mask(new string('a', 16), MaskedValueVariant.Token);
        string longToken = MaskedValueProjection.Mask(new string('a', 64), MaskedValueVariant.Token);

        Assert.Equal(shortToken.Length, longToken.Length);
        Assert.Equal(16, shortToken.Length);
    }

    [Fact]
    public void Mask_vin_keeps_the_wmi_prefix_and_last_four()
    {
        string masked = MaskedValueProjection.Mask("5YJ3E1EA7KF000000", MaskedValueVariant.Vin);

        Assert.StartsWith("5YJ", masked);
        Assert.EndsWith("0000", masked);
        Assert.Equal(17, masked.Length);
        Assert.Contains(Bullet, masked);
    }

    [Fact]
    public void Mask_vin_fully_masks_a_short_input()
    {
        string masked = MaskedValueProjection.Mask("ABC", MaskedValueVariant.Vin);

        Assert.Equal(new string('\u2022', 3), masked);
    }

    [Fact]
    public void Mask_coords_renders_whole_degree_bullets_per_component()
    {
        string masked = MaskedValueProjection.Mask("37.7749,-122.4194", MaskedValueVariant.Coords);

        Assert.Equal("\u2022\u2022.\u2022\u2022\u2022, \u2022\u2022.\u2022\u2022\u2022", masked);
    }

    [Fact]
    public void Mask_coords_handles_a_single_number()
    {
        string masked = MaskedValueProjection.Mask("37.7749", MaskedValueVariant.Coords);

        Assert.Equal("\u2022\u2022.\u2022\u2022\u2022", masked);
    }

    [Fact]
    public void Mask_coords_falls_back_to_generic_for_non_numeric_input()
    {
        string masked = MaskedValueProjection.Mask("home,work", MaskedValueVariant.Coords);

        // non-numeric → generic mask of the trimmed input with no visible suffix: every char is a bullet.
        Assert.Equal(new string('\u2022', "home,work".Length), masked);
    }

    [Fact]
    public void Mask_email_masks_the_local_part_and_keeps_the_domain()
    {
        string masked = MaskedValueProjection.Mask("john.doe@example.com", MaskedValueVariant.Email);

        Assert.StartsWith("j", masked);
        Assert.EndsWith("@example.com", masked);
        Assert.Contains(Bullet, masked);
    }

    [Fact]
    public void Mask_email_without_an_at_sign_falls_back_to_generic()
    {
        string masked = MaskedValueProjection.Mask("plainstring", MaskedValueVariant.Email);

        Assert.EndsWith("g", masked);
        Assert.StartsWith(Bullet, masked);
    }

    [Fact]
    public void Mask_generic_bullets_to_length_with_no_visible_suffix_by_default()
    {
        string masked = MaskedValueProjection.Mask("secret", MaskedValueVariant.Generic);

        Assert.Equal(new string('\u2022', 6), masked);
    }

    [Fact]
    public void Mask_generic_respects_a_show_last_override()
    {
        string masked = MaskedValueProjection.Mask("secret", MaskedValueVariant.Generic, showLast: 2);

        Assert.Equal(new string('\u2022', 4) + "et", masked);
    }

    [Theory]
    [InlineData(MaskedValueVariant.Token, 4)]
    [InlineData(MaskedValueVariant.Vin, 4)]
    [InlineData(MaskedValueVariant.Coords, 0)]
    [InlineData(MaskedValueVariant.Email, 1)]
    [InlineData(MaskedValueVariant.Generic, 0)]
    public void Default_show_last_matches_the_web_table(MaskedValueVariant variant, int expected) =>
        Assert.Equal(expected, MaskedValueProjection.DefaultShowLast(variant));

    [Theory]
    [InlineData(MaskedValueVariant.Token, "token")]
    [InlineData(MaskedValueVariant.Vin, "vin")]
    [InlineData(MaskedValueVariant.Coords, "coords")]
    [InlineData(MaskedValueVariant.Email, "email")]
    [InlineData(MaskedValueVariant.Generic, "generic")]
    public void Variant_wire_name_matches_the_web_union(MaskedValueVariant variant, string expected) =>
        Assert.Equal(expected, MaskedValueProjection.WireName(variant));

    // ── state: masked (initial render, web revealed === false) ───────────────────────────────────────────

    [Fact]
    public void Masked_is_the_initial_state_and_shows_the_reveal_affordance()
    {
        MaskedValueViewModel vm = NewViewModel(value: "abcdefgh", variant: MaskedValueVariant.Token);

        Assert.False(vm.IsRevealed);
        Assert.False(vm.ShowEyeOffIcon);
        Assert.True(vm.ShowToggle);
        Assert.Equal("Reveal value", vm.ToggleLabel);
        Assert.Equal(MaskedValueProjection.Mask("abcdefgh", MaskedValueVariant.Token), vm.CodeText);
        Assert.Equal(vm.CodeText, vm.DisplayText);
    }

    // ── state: revealed (web reveal — setRevealed(true)) ─────────────────────────────────────────────────

    [Fact]
    public void Reveal_shows_the_cleartext_and_the_hide_affordance()
    {
        MaskedValueViewModel vm = NewViewModel(value: "abcdefgh", variant: MaskedValueVariant.Token);

        vm.Reveal();

        Assert.True(vm.IsRevealed);
        Assert.True(vm.ShowEyeOffIcon);
        Assert.Equal("Hide value", vm.ToggleLabel);
        Assert.Equal("abcdefgh", vm.CodeText);
        Assert.Equal("abcdefgh", vm.DisplayText);
    }

    [Fact]
    public void Toggle_flips_between_masked_and_revealed()
    {
        MaskedValueViewModel vm = NewViewModel(value: "abcdefgh");

        vm.Toggle();
        Assert.True(vm.IsRevealed);

        vm.Toggle();
        Assert.False(vm.IsRevealed);
    }

    [Fact]
    public void Hide_re_masks_a_revealed_value()
    {
        MaskedValueViewModel vm = NewViewModel(value: "abcdefgh");
        vm.Reveal();
        Assert.True(vm.IsRevealed);

        vm.Hide();

        Assert.False(vm.IsRevealed);
        Assert.Equal(vm.MaskedText, vm.CodeText);
    }

    [Fact]
    public void Reveal_raises_change_for_the_revealed_projections()
    {
        MaskedValueViewModel vm = NewViewModel(value: "abcdefgh");
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Reveal();

        Assert.Contains(nameof(MaskedValueViewModel.IsRevealed), changed);
        Assert.Contains(nameof(MaskedValueViewModel.ShowEyeOffIcon), changed);
        Assert.Contains(nameof(MaskedValueViewModel.ToggleLabel), changed);
        Assert.Contains(nameof(MaskedValueViewModel.CodeText), changed);
        Assert.Contains(nameof(MaskedValueViewModel.DisplayText), changed);
    }

    // ── state: empty (web raw.length === 0 — em-dash, no toggle, no copy) ────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Empty_value_renders_the_em_dash_with_no_toggle_or_copy(string? value)
    {
        MaskedValueViewModel vm = NewViewModel(value: value, copyable: true);

        Assert.True(vm.IsEmpty);
        Assert.Equal(EmDash, vm.DisplayText);
        Assert.False(vm.ShowToggle);
        Assert.False(vm.ShowCopy);
    }

    [Fact]
    public void Reveal_is_a_no_op_on_an_empty_value()
    {
        MaskedValueViewModel vm = NewViewModel(value: string.Empty);

        vm.Reveal();

        Assert.False(vm.IsRevealed);
        Assert.Equal(EmDash, vm.DisplayText);
    }

    // ── state: copyable (web copyable — the always-cleartext copy affordance) ────────────────────────────

    [Fact]
    public void Copyable_shows_the_copy_affordance_for_a_non_empty_value()
    {
        MaskedValueViewModel vm = NewViewModel(value: "abcdefgh", copyable: true);

        Assert.True(vm.ShowCopy);
        Assert.Equal("Copy value", vm.CopyLabel);
    }

    [Fact]
    public void Copy_affordance_is_hidden_when_not_copyable()
    {
        MaskedValueViewModel vm = NewViewModel(value: "abcdefgh", copyable: false);

        Assert.False(vm.ShowCopy);
    }

    // ── reveal audit: opt-in gating + silent failure (web postRevealAudit) ───────────────────────────────

    [Fact]
    public void Reveal_with_audit_opt_in_posts_the_variant_wire_name()
    {
        var audit = new RecordingAuditSink();
        MaskedValueViewModel vm = NewViewModel(
            audit: audit, value: "abcdefgh", variant: MaskedValueVariant.Token, auditOnReveal: true);

        vm.Reveal();

        Assert.Equal("token", Assert.Single(audit.Variants));
    }

    [Fact]
    public void Reveal_without_audit_opt_in_posts_nothing()
    {
        var audit = new RecordingAuditSink();
        MaskedValueViewModel vm = NewViewModel(audit: audit, value: "abcdefgh", auditOnReveal: false);

        vm.Reveal();

        Assert.Empty(audit.Variants);
    }

    [Fact]
    public void Reveal_on_an_empty_value_posts_no_audit_even_when_opted_in()
    {
        var audit = new RecordingAuditSink();
        MaskedValueViewModel vm = NewViewModel(audit: audit, value: string.Empty, auditOnReveal: true);

        vm.Reveal();

        Assert.Empty(audit.Variants);
    }

    [Fact]
    public void Reveal_posts_the_coords_wire_name_for_a_coords_variant()
    {
        var audit = new RecordingAuditSink();
        MaskedValueViewModel vm = NewViewModel(
            audit: audit, value: "37.7749,-122.4194", variant: MaskedValueVariant.Coords, auditOnReveal: true);

        vm.Reveal();

        Assert.Equal("coords", Assert.Single(audit.Variants));
    }

    [Fact]
    public void Reveal_swallows_a_failing_audit_post()
    {
        // web postRevealAudit: a synchronous throw or rejected promise never interferes with the reveal UX.
        MaskedValueViewModel vm = NewViewModel(
            audit: new ThrowingAuditSink(), value: "abcdefgh", auditOnReveal: true);

        vm.Reveal();

        Assert.True(vm.IsRevealed);
    }

    // ── accessibility + i18n: every label flows through the localizer ────────────────────────────────────

    [Fact]
    public void Every_label_resolves_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();
        MaskedValueViewModel vm = NewViewModel(localizer: localizer, value: "abcdefgh");

        _ = vm.HideLabel;
        _ = vm.RevealLabel;
        _ = vm.CopyLabel;

        Assert.Contains(MaskedValueRegistration.HideKey, localizer.RequestedKeys);
        Assert.Contains(MaskedValueRegistration.RevealKey, localizer.RequestedKeys);
        Assert.Contains(MaskedValueRegistration.CopyKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Toggle_label_resolves_the_reveal_key_then_the_hide_key()
    {
        var localizer = new RecordingLocalizer();
        MaskedValueViewModel vm = NewViewModel(localizer: localizer, value: "abcdefgh");

        Assert.Equal("Reveal value", vm.ToggleLabel);
        vm.Reveal();
        Assert.Equal("Hide value", vm.ToggleLabel);

        Assert.Contains(MaskedValueRegistration.RevealKey, localizer.RequestedKeys);
        Assert.Contains(MaskedValueRegistration.HideKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Aria_label_is_carried_for_the_accessible_name()
    {
        MaskedValueViewModel vm = NewViewModel(value: "abcdefgh", ariaLabel: "API key, click to reveal");

        Assert.Equal("API key, click to reveal", vm.AriaLabel);
    }

    // ── constructor guards (audit + localizer required; diagnostics optional) ────────────────────────────

    [Fact]
    public void Constructor_rejects_null_required_seams_but_allows_null_diagnostics()
    {
        IRevealAuditSink audit = NoOpRevealAuditSink.Instance;
        ILocalizer localizer = PassthroughLocalizer.Instance;

        Assert.Throws<ArgumentNullException>(() => new MaskedValueViewModel(null!, localizer));
        Assert.Throws<ArgumentNullException>(() => new MaskedValueViewModel(audit, null!));

        var vm = new MaskedValueViewModel(audit, localizer);
        Assert.NotNull(vm);
    }

    // ── seams: delegate-backed + inert reveal-audit sinks ────────────────────────────────────────────────

    [Fact]
    public async Task Delegate_reveal_audit_sink_forwards_to_the_delegate()
    {
        string? captured = null;
        var sink = new DelegateRevealAuditSink(variant =>
        {
            captured = variant;
            return Task.CompletedTask;
        });

        await sink.PostRevealAsync("token");

        Assert.Equal("token", captured);
    }

    [Fact]
    public async Task Delegate_reveal_audit_sink_degrades_a_null_delegate_to_a_completed_task()
    {
        var sink = new DelegateRevealAuditSink(null);

        await sink.PostRevealAsync("token");
    }

    [Fact]
    public async Task NoOp_reveal_audit_sink_completes_without_throwing() =>
        await NoOpRevealAuditSink.Instance.PostRevealAsync("token");

    // ── diagnostics (view.opened, PII-safe — never the masked value) ─────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MaskedValueDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MaskedValue", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new MaskedValueDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
