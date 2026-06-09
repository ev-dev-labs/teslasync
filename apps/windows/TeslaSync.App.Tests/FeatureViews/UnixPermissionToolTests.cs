using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the UnixPermissionTool feature-view's UI-thread-free logic — the octal → triad
/// permission map, the pure breakdown projection (the web <c>useMemo</c> data adapter), the state-holder
/// view-model's empty ↔ resolved transitions plus its localized labels / Narrator summary, the mode
/// presets, and the registry/diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class UnixPermissionToolTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- PermissionMap (web PERMS constant) -----------------------------------------

    [Theory]
    [InlineData('7', "rwx")]
    [InlineData('6', "rw-")]
    [InlineData('5', "r-x")]
    [InlineData('4', "r--")]
    [InlineData('3', "-wx")]
    [InlineData('2', "-w-")]
    [InlineData('1', "--x")]
    [InlineData('0', "---")]
    public void PermissionMap_matches_the_web_PERMS_constant(char digit, string triad)
    {
        Assert.Equal(triad, PermissionMap.Triad(digit));
    }

    [Theory]
    [InlineData('8')]
    [InlineData('9')]
    [InlineData('x')]
    public void PermissionMap_returns_dashes_for_a_non_octal_digit(char digit)
    {
        Assert.Equal("---", PermissionMap.Triad(digit));
        Assert.Equal(PermissionMap.Unknown, PermissionMap.Triad(digit));
    }

    [Fact]
    public void PermissionMap_has_exactly_the_eight_octal_digits()
    {
        Assert.Equal(8, PermissionMap.Triads.Count);
        for (char d = '0'; d <= '7'; d++)
        {
            Assert.True(PermissionMap.Triads.ContainsKey(d));
        }
    }

    // ---- Projection: the empty branch (web symbolic === null) -----------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("7")]        // too short
    [InlineData("75")]       // too short
    [InlineData("7555")]     // too long
    [InlineData("abc")]      // non-octal
    [InlineData("789")]      // digits outside 0-7
    [InlineData("75 ")]      // trailing space breaks the /^[0-7]{3}$/ shape
    [InlineData("7o5")]      // embedded non-digit
    public void Project_returns_null_for_anything_but_three_octal_digits(string? octal)
    {
        Assert.Null(UnixPermissionProjection.Project(octal));
    }

    // ---- Projection: the resolved branch (web PERMS concat + slices) ----------------

    [Fact]
    public void Project_builds_the_symbolic_string_and_three_triads()
    {
        PermissionBreakdown? breakdown = UnixPermissionProjection.Project("755");

        Assert.NotNull(breakdown);
        Assert.Equal("rwxr-xr-x", breakdown!.Symbolic);
        Assert.Equal("rwx", breakdown.Owner);   // web symbolic.slice(0, 3)
        Assert.Equal("r-x", breakdown.Group);   // web symbolic.slice(3, 6)
        Assert.Equal("r-x", breakdown.Other);   // web symbolic.slice(6)
    }

    [Theory]
    [InlineData("644", "rw-r--r--")]
    [InlineData("700", "rwx------")]
    [InlineData("600", "rw-------")]
    [InlineData("777", "rwxrwxrwx")]
    [InlineData("444", "r--r--r--")]
    [InlineData("000", "---------")]
    public void Project_matches_every_preset(string octal, string symbolic)
    {
        PermissionBreakdown? breakdown = UnixPermissionProjection.Project(octal);

        Assert.NotNull(breakdown);
        Assert.Equal(symbolic, breakdown!.Symbolic);
        Assert.Equal(9, breakdown.Symbolic.Length);
    }

    // ---- Presets (web presetOptions) ------------------------------------------------

    [Fact]
    public void Presets_match_the_web_preset_options()
    {
        Assert.Equal("755", UnixPermissionPresets.Default);
        Assert.Collection(
            UnixPermissionPresets.All,
            p => AssertPreset(p, "755", "755 (rwxr-xr-x)"),
            p => AssertPreset(p, "644", "644 (rw-r--r--)"),
            p => AssertPreset(p, "700", "700 (rwx------)"),
            p => AssertPreset(p, "600", "600 (rw-------)"),
            p => AssertPreset(p, "777", "777 (rwxrwxrwx)"),
            p => AssertPreset(p, "444", "444 (r--r--r--)"));
    }

    [Fact]
    public void Every_preset_value_resolves_to_the_label_triads()
    {
        foreach (PermissionPreset preset in UnixPermissionPresets.All)
        {
            PermissionBreakdown? breakdown = UnixPermissionProjection.Project(preset.Value);
            Assert.NotNull(breakdown);
            Assert.Contains(breakdown!.Symbolic, preset.Label, System.StringComparison.Ordinal);
        }
    }

    // ---- View-model: initial (resolved) state — web useState('755') -----------------

    [Fact]
    public void Initial_state_is_resolved_from_the_default_octal()
    {
        var vm = new UnixPermissionToolViewModel(Localizer);

        Assert.Equal("755", vm.Octal);
        Assert.Equal(UnixPermissionState.Resolved, vm.State);
        Assert.True(vm.HasBreakdown);
        Assert.False(vm.IsEmpty);
        Assert.False(vm.IsInvalidInput);
        Assert.Equal("rwxr-xr-x", vm.Symbolic);
        Assert.NotNull(vm.Breakdown);
        Assert.NotNull(vm.ResultAnnouncement);
        Assert.Equal("755", vm.SelectedPreset?.Value);
    }

    // ---- View-model: empty state (web symbolic === null) ----------------------------

    [Fact]
    public void Clearing_the_octal_returns_to_empty()
    {
        var vm = new UnixPermissionToolViewModel(Localizer) { Octal = string.Empty };

        Assert.Equal(UnixPermissionState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.False(vm.HasBreakdown);
        Assert.False(vm.IsInvalidInput); // blank, not malformed
        Assert.Equal(string.Empty, vm.Symbolic);
        Assert.Null(vm.Breakdown);
        Assert.Null(vm.ResultAnnouncement);
        Assert.Null(vm.SelectedPreset);
    }

    [Fact]
    public void Malformed_octal_is_empty_but_flagged_invalid()
    {
        var vm = new UnixPermissionToolViewModel(Localizer) { Octal = "999" };

        Assert.Equal(UnixPermissionState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.True(vm.IsInvalidInput); // a11y validity affordance — non-empty text that is not a valid octal
        Assert.Null(vm.SelectedPreset);
    }

    [Fact]
    public void Whitespace_octal_is_empty_and_not_invalid()
    {
        var vm = new UnixPermissionToolViewModel(Localizer) { Octal = "   " };

        Assert.True(vm.IsEmpty);
        Assert.False(vm.IsInvalidInput); // blank, not malformed
    }

    // ---- View-model: editing + presets ----------------------------------------------

    [Fact]
    public void Setting_a_preset_value_selects_that_preset()
    {
        var vm = new UnixPermissionToolViewModel(Localizer) { Octal = "644" };

        Assert.Equal(UnixPermissionState.Resolved, vm.State);
        Assert.Equal("rw-r--r--", vm.Symbolic);
        Assert.Equal("644", vm.SelectedPreset?.Value);
    }

    [Fact]
    public void A_non_preset_octal_selects_no_preset()
    {
        // 640 is a valid octal that is not one of the six presets.
        var vm = new UnixPermissionToolViewModel(Localizer) { Octal = "640" };

        Assert.Equal(UnixPermissionState.Resolved, vm.State);
        Assert.Equal("rw-r-----", vm.Symbolic);
        Assert.Null(vm.SelectedPreset); // web Select shows no selection for a non-preset value
    }

    [Fact]
    public void Editing_raises_property_changed()
    {
        var vm = new UnixPermissionToolViewModel(Localizer);
        var changed = new List<string>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName ?? string.Empty);

        vm.Octal = "644";

        Assert.Contains(nameof(vm.Octal), changed);
        Assert.Contains(nameof(vm.State), changed);
        Assert.Contains(nameof(vm.Breakdown), changed);
        Assert.Contains(nameof(vm.HasBreakdown), changed);
        Assert.Contains(nameof(vm.Symbolic), changed);
        Assert.Contains(nameof(vm.SelectedPreset), changed);
    }

    [Fact]
    public void Setting_same_octal_is_a_no_op()
    {
        var vm = new UnixPermissionToolViewModel(Localizer) { Octal = "700" };
        var changed = 0;
        vm.PropertyChanged += (_, _) => changed++;

        vm.Octal = "700";

        Assert.Equal(0, changed);
    }

    // ---- View-model: localized labels + a11y (web t('Unix Perm') / t('Owner') / ...) -

    [Fact]
    public void Labels_resolve_to_web_literals()
    {
        var vm = new UnixPermissionToolViewModel(Localizer);

        Assert.Equal("Unix Perm", vm.Title);
        Assert.Equal("Unix Perm Desc", vm.Description);
        Assert.Equal("Octal Perm", vm.OctalLabel);
        Assert.Equal("Presets", vm.PresetsLabel);
        Assert.Equal("Owner", vm.OwnerLabel);
        Assert.Equal("Group", vm.GroupLabel);
        Assert.Equal("Other", vm.OtherLabel);
        Assert.Equal("Copy", vm.CopyLabel);
        Assert.Equal("Copied", vm.CopiedLabel);
        Assert.Equal("755", vm.OctalHint);
    }

    [Fact]
    public void Empty_state_has_friendly_strings()
    {
        var vm = new UnixPermissionToolViewModel(Localizer);

        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyTitle));
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void Accessible_names_are_non_empty()
    {
        var vm = new UnixPermissionToolViewModel(Localizer);

        Assert.False(string.IsNullOrWhiteSpace(vm.OctalAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.PresetsAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.CopyAccessibleName));

        Assert.Equal("Octal Perm", vm.OctalAccessibleName);
        Assert.Equal("Presets", vm.PresetsAccessibleName);
        Assert.Equal("Copy", vm.CopyAccessibleName);
    }

    [Fact]
    public void Result_announcement_summarizes_the_symbolic_mode()
    {
        var vm = new UnixPermissionToolViewModel(Localizer) { Octal = "755" };

        Assert.NotNull(vm.ResultAnnouncement);
        Assert.Contains("755", vm.ResultAnnouncement!, System.StringComparison.Ordinal);
        Assert.Contains("rwxr-xr-x", vm.ResultAnnouncement!, System.StringComparison.Ordinal);
    }

    // ---- i18n key parity (web t() call sites) ---------------------------------------

    [Fact]
    public void ViewModel_routes_every_web_t_key_through_the_localizer()
    {
        var recorder = new RecordingLocalizer();
        var vm = new UnixPermissionToolViewModel(recorder);

        _ = vm.Title;
        _ = vm.Description;
        _ = vm.OctalLabel;
        _ = vm.PresetsLabel;
        _ = vm.OwnerLabel;
        _ = vm.GroupLabel;
        _ = vm.OtherLabel;
        _ = vm.CopyLabel;
        _ = vm.CopiedLabel;

        string[] expected =
        [
            "translation.Unix Perm",
            "translation.Unix Perm Desc",
            "translation.Octal Perm",
            "translation.Presets",
            "translation.Owner",
            "translation.Group",
            "translation.Other",
            "common.copyButton.copy",
            "common.copyButton.copied",
        ];

        foreach (string key in expected)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Registration metadata (web registry parity) --------------------------------

    [Fact]
    public void Registration_matches_the_web_tool()
    {
        Assert.Equal("unix-perm", UnixPermissionToolRegistration.Id);
        Assert.Equal("devtools", UnixPermissionToolRegistration.Category);
        Assert.Equal("UnixPermissionTool", UnixPermissionToolRegistration.Slug);
        Assert.Equal("Unix Perm", UnixPermissionToolRegistration.Name(Localizer));
        Assert.Equal("Unix Perm Desc", UnixPermissionToolRegistration.Description(Localizer));
        Assert.False(string.IsNullOrEmpty(UnixPermissionToolRegistration.IconGlyph));
        Assert.False(string.IsNullOrEmpty(UnixPermissionToolRegistration.AccentBrushKey));
        Assert.False(string.IsNullOrEmpty(UnixPermissionToolRegistration.AccentColorKey));
    }

    // ---- Diagnostics (P1/S11 view.opened, PII-safe) ---------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new UnixPermissionToolDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UnixPermissionTool", Assert.Single(sink));
    }

    [Fact]
    public void Diagnostics_never_emits_the_typed_octal_or_permissions()
    {
        var sink = new List<string>();
        var diagnostics = new UnixPermissionToolDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(sink, line => line.Contains("755", System.StringComparison.Ordinal));
        Assert.DoesNotContain(sink, line => line.Contains("rwx", System.StringComparison.Ordinal));
    }

    private static void AssertPreset(PermissionPreset preset, string value, string label)
    {
        Assert.Equal(value, preset.Value);
        Assert.Equal(label, preset.Label);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(System.StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
