using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Base64 surface's UI-thread-free logic — the pure <c>btoa</c>/<c>atob</c>
/// codec adapter, the state-holder view-model's per-state transitions (empty / success / invalid), the
/// registration metadata, the PII-safe diagnostics, the localized labels + Narrator names, and the
/// exact set of i18n keys. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/Base64Tool.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class Base64ToolTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // "Hello World" is the canonical example baked into the web placeholders.
    private const string PlainSample = "Hello World";
    private const string Base64Sample = "SGVsbG8gV29ybGQ=";

    // ---- Codec adapter (port of btoa / atob) ---------------------------------------

    [Fact]
    public void Transform_empty_input_is_empty_success()
    {
        Base64CodecResult result = Base64Codec.Transform(Base64ToolMode.Encode, string.Empty);

        Assert.True(result.Ok);
        Assert.Equal(string.Empty, result.Value);
    }

    [Fact]
    public void Transform_null_input_is_empty_success()
    {
        Base64CodecResult result = Base64Codec.Transform(Base64ToolMode.Decode, null);

        Assert.True(result.Ok);
        Assert.Equal(string.Empty, result.Value);
    }

    [Fact]
    public void Encode_matches_btoa_for_ascii()
    {
        Base64CodecResult result = Base64Codec.Transform(Base64ToolMode.Encode, PlainSample);

        Assert.True(result.Ok);
        Assert.Equal(Base64Sample, result.Value);
    }

    [Fact]
    public void Decode_matches_atob_for_valid_base64()
    {
        Base64CodecResult result = Base64Codec.Transform(Base64ToolMode.Decode, Base64Sample);

        Assert.True(result.Ok);
        Assert.Equal(PlainSample, result.Value);
    }

    [Fact]
    public void Encode_then_decode_round_trips()
    {
        Base64CodecResult encoded = Base64Codec.Transform(Base64ToolMode.Encode, PlainSample);
        Base64CodecResult decoded = Base64Codec.Transform(Base64ToolMode.Decode, encoded.Value);

        Assert.True(decoded.Ok);
        Assert.Equal(PlainSample, decoded.Value);
    }

    [Fact]
    public void Encode_preserves_latin1_bytes_like_btoa()
    {
        // "caf\u00E9" — every code unit is <= 0xFF, so btoa encodes the Latin-1 bytes [99,97,102,233].
        Base64CodecResult result = Base64Codec.Transform(Base64ToolMode.Encode, "caf\u00E9");

        Assert.True(result.Ok);
        Assert.Equal("Y2Fm6Q==", result.Value);
    }

    [Fact]
    public void Encode_rejects_code_unit_above_255_like_btoa()
    {
        // "A\u20AC" — the Euro sign is code unit 8364 (> 0xFF), which btoa throws on.
        Base64CodecResult result = Base64Codec.Transform(Base64ToolMode.Encode, "A\u20AC");

        Assert.False(result.Ok);
        Assert.Equal(string.Empty, result.Value);
    }

    [Theory]
    [InlineData("%%%not-base64%%%")]
    [InlineData("@@@")]
    [InlineData("abc")] // length not a multiple of 4
    public void Decode_rejects_malformed_base64_like_atob(string malformed)
    {
        Base64CodecResult result = Base64Codec.Transform(Base64ToolMode.Decode, malformed);

        Assert.False(result.Ok);
        Assert.Equal(string.Empty, result.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_empty_with_no_output()
    {
        var vm = new Base64ToolViewModel(Localizer);

        Assert.Equal(Base64ToolState.Empty, vm.State);
        Assert.False(vm.HasOutput);
        Assert.Equal(string.Empty, vm.Output);
        Assert.True(vm.IsEncode);
        Assert.False(vm.IsDecode);
    }

    [Fact]
    public void ViewModel_encodes_on_input()
    {
        var vm = new Base64ToolViewModel(Localizer) { Input = PlainSample };

        Assert.Equal(Base64ToolState.Success, vm.State);
        Assert.True(vm.HasOutput);
        Assert.Equal(Base64Sample, vm.Output);
    }

    [Fact]
    public void ViewModel_decodes_when_mode_switches()
    {
        var vm = new Base64ToolViewModel(Localizer) { Input = Base64Sample };
        Assert.Equal(Base64ToolState.Success, vm.State); // encodes the (ASCII) base64 string first

        vm.Mode = Base64ToolMode.Decode;

        Assert.True(vm.IsDecode);
        Assert.Equal(Base64ToolState.Success, vm.State);
        Assert.Equal(PlainSample, vm.Output);
    }

    [Fact]
    public void ViewModel_invalid_decode_shows_localized_message_in_output_panel()
    {
        var vm = new Base64ToolViewModel(Localizer)
        {
            Mode = Base64ToolMode.Decode,
            Input = "%%%not-base64%%%",
        };

        Assert.Equal(Base64ToolState.Invalid, vm.State);
        Assert.True(vm.HasOutput); // web shows the panel because `output` (the message) is truthy
        Assert.Equal("Invalid Input", vm.Output);
        Assert.Equal(vm.InvalidMessage, vm.Output);
    }

    [Fact]
    public void ViewModel_clearing_input_returns_to_empty()
    {
        var vm = new Base64ToolViewModel(Localizer) { Input = PlainSample };
        Assert.True(vm.HasOutput);

        vm.Input = string.Empty;

        Assert.Equal(Base64ToolState.Empty, vm.State);
        Assert.False(vm.HasOutput);
        Assert.Equal(string.Empty, vm.Output);
    }

    [Fact]
    public void ViewModel_mode_toggle_updates_flags_and_hint()
    {
        var vm = new Base64ToolViewModel(Localizer);
        Assert.Equal("Hello World", vm.InputHint);

        vm.Mode = Base64ToolMode.Decode;

        Assert.True(vm.IsDecode);
        Assert.False(vm.IsEncode);
        Assert.Equal("SGVsbG8gV29ybGQ=", vm.InputHint);
    }

    [Fact]
    public void ViewModel_raises_property_changed_for_state_and_output()
    {
        var vm = new Base64ToolViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Input = PlainSample;

        Assert.Contains(nameof(Base64ToolViewModel.Input), changed);
        Assert.Contains(nameof(Base64ToolViewModel.State), changed);
        Assert.Contains(nameof(Base64ToolViewModel.Output), changed);
        Assert.Contains(nameof(Base64ToolViewModel.HasOutput), changed);
    }

    [Fact]
    public void ViewModel_mode_change_raises_mode_and_hint()
    {
        var vm = new Base64ToolViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Mode = Base64ToolMode.Decode;

        Assert.Contains(nameof(Base64ToolViewModel.Mode), changed);
        Assert.Contains(nameof(Base64ToolViewModel.IsEncode), changed);
        Assert.Contains(nameof(Base64ToolViewModel.IsDecode), changed);
        Assert.Contains(nameof(Base64ToolViewModel.InputHint), changed);
    }

    [Fact]
    public void ViewModel_setting_same_value_does_not_raise()
    {
        var vm = new Base64ToolViewModel(Localizer) { Input = PlainSample };
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Input = PlainSample; // unchanged
        vm.Mode = Base64ToolMode.Encode; // unchanged

        Assert.Empty(changed);
    }

    // ---- Accessibility names (Narrator) --------------------------------------------

    [Fact]
    public void ViewModel_exposes_non_empty_accessible_names()
    {
        var vm = new Base64ToolViewModel(Localizer);

        Assert.False(string.IsNullOrWhiteSpace(vm.EncodeAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.DecodeAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.InputAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.CopyAccessibleName));

        Assert.Equal("Encode", vm.EncodeAccessibleName);
        Assert.Equal("Decode", vm.DecodeAccessibleName);
        Assert.Equal("Input Label", vm.InputAccessibleName);
        Assert.Equal("Copy", vm.CopyAccessibleName);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_tool()
    {
        Assert.Equal("base64", Base64ToolRegistration.Id);
        Assert.Equal("devtools", Base64ToolRegistration.Category);
        Assert.Equal("Base64Tool", Base64ToolRegistration.Slug);
        Assert.Equal("Base64", Base64ToolRegistration.Name(Localizer));
        Assert.Equal("Base64Desc", Base64ToolRegistration.Description(Localizer));
        Assert.False(string.IsNullOrEmpty(Base64ToolRegistration.IconGlyph));
        Assert.False(string.IsNullOrEmpty(Base64ToolRegistration.AccentBrushKey));
        Assert.False(string.IsNullOrEmpty(Base64ToolRegistration.AccentColorKey));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new Base64ToolDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Base64Tool", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_emits_input_or_output()
    {
        // The sink must never receive the user's payload (it can carry secrets).
        var lines = new List<string>();
        var diagnostics = new Base64ToolDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(lines, line => line.Contains(PlainSample, StringComparison.Ordinal));
        Assert.DoesNotContain(lines, line => line.Contains(Base64Sample, StringComparison.Ordinal));
    }

    // ---- i18n key parity (web t() call sites) --------------------------------------

    [Fact]
    public void ViewModel_routes_every_web_t_key_through_the_localizer()
    {
        var recorder = new RecordingLocalizer();
        var vm = new Base64ToolViewModel(recorder);

        // Touch every localized surface the view renders.
        _ = vm.Title;
        _ = vm.Description;
        _ = vm.EncodeLabel;
        _ = vm.DecodeLabel;
        _ = vm.InputLabel;
        _ = vm.OutputLabel;
        _ = vm.InvalidMessage;
        _ = vm.CopyLabel;
        _ = vm.CopiedLabel;
        vm.Mode = Base64ToolMode.Encode;
        _ = vm.InputHint;
        vm.Mode = Base64ToolMode.Decode;
        _ = vm.InputHint;

        string[] expected =
        [
            "devtools.utils.base64",
            "devtools.utils.base64Desc",
            "Encode",
            "Decode",
            "Input Label",
            "Output Label",
            "Invalid Input",
            "common.copyButton.copy",
            "common.copyButton.copied",
            "devtools.base64.encodeHint",
            "devtools.base64.decodeHint",
        ];

        foreach (string key in expected)
        {
            Assert.Contains(key, recorder.Keys);
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
