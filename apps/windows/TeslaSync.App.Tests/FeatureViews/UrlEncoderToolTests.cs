using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the URL-encoder surface's UI-thread-free logic — the pure
/// <c>encodeURIComponent</c>/<c>decodeURIComponent</c> codec adapter, the state-holder view-model's
/// per-state transitions (empty / success / invalid), the registration metadata, the PII-safe diagnostics,
/// the localized labels + Narrator names, and the exact set of i18n keys. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/UrlEncoder.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class UrlEncoderToolTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The canonical example baked into the web encode/decode hints.
    private const string PlainSample = "hello world&foo=bar";
    private const string EncodedSample = "hello%20world%26foo%3Dbar";

    // ---- Codec adapter (port of encodeURIComponent / decodeURIComponent) -----------

    [Fact]
    public void Transform_empty_input_is_empty_success()
    {
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Encode, string.Empty);

        Assert.True(result.Ok);
        Assert.Equal(string.Empty, result.Value);
    }

    [Fact]
    public void Transform_null_input_is_empty_success()
    {
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Decode, null);

        Assert.True(result.Ok);
        Assert.Equal(string.Empty, result.Value);
    }

    [Fact]
    public void Encode_matches_encodeURIComponent_for_reserved_characters()
    {
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Encode, PlainSample);

        Assert.True(result.Ok);
        Assert.Equal(EncodedSample, result.Value);
    }

    [Fact]
    public void Decode_matches_decodeURIComponent_for_valid_escapes()
    {
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Decode, EncodedSample);

        Assert.True(result.Ok);
        Assert.Equal(PlainSample, result.Value);
    }

    [Fact]
    public void Encode_then_decode_round_trips()
    {
        UrlCodecResult encoded = UrlCodec.Transform(UrlEncoderMode.Encode, PlainSample);
        UrlCodecResult decoded = UrlCodec.Transform(UrlEncoderMode.Decode, encoded.Value);

        Assert.True(decoded.Ok);
        Assert.Equal(PlainSample, decoded.Value);
    }

    [Fact]
    public void Encode_leaves_unreserved_characters_untouched_like_encodeURIComponent()
    {
        // encodeURIComponent never escapes A-Za-z0-9 or any of -_.!~*'().
        const string unreserved = "-_.!~*'()AZaz09";
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Encode, unreserved);

        Assert.True(result.Ok);
        Assert.Equal(unreserved, result.Value);
    }

    [Fact]
    public void Encode_escapes_plus_sign_like_encodeURIComponent()
    {
        // encodeURIComponent escapes '+' (it is not in the unreserved set) — unlike form encoding.
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Encode, "a+b");

        Assert.True(result.Ok);
        Assert.Equal("a%2Bb", result.Value);
    }

    [Fact]
    public void Decode_preserves_plus_sign_like_decodeURIComponent()
    {
        // decodeURIComponent does NOT turn '+' into a space (that is form decoding).
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Decode, "a+b");

        Assert.True(result.Ok);
        Assert.Equal("a+b", result.Value);
    }

    [Fact]
    public void Encode_emits_utf8_percent_bytes_for_multibyte_characters()
    {
        // "café" — é is U+00E9, whose UTF-8 bytes are 0xC3 0xA9.
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Encode, "caf\u00E9");

        Assert.True(result.Ok);
        Assert.Equal("caf%C3%A9", result.Value);
    }

    [Fact]
    public void Decode_reassembles_utf8_percent_bytes()
    {
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Decode, "caf%C3%A9");

        Assert.True(result.Ok);
        Assert.Equal("caf\u00E9", result.Value);
    }

    [Fact]
    public void Encode_and_decode_round_trip_astral_code_point()
    {
        // "😀" U+1F600 is a surrogate pair whose UTF-8 is F0 9F 98 80.
        const string grinning = "\uD83D\uDE00";

        UrlCodecResult encoded = UrlCodec.Transform(UrlEncoderMode.Encode, grinning);
        Assert.True(encoded.Ok);
        Assert.Equal("%F0%9F%98%80", encoded.Value);

        UrlCodecResult decoded = UrlCodec.Transform(UrlEncoderMode.Decode, encoded.Value);
        Assert.True(decoded.Ok);
        Assert.Equal(grinning, decoded.Value);
    }

    [Fact]
    public void Encode_rejects_lone_surrogate_like_encodeURIComponent()
    {
        // A lone high surrogate is a URIError in the browser.
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Encode, "A\uD800B");

        Assert.False(result.Ok);
        Assert.Equal(string.Empty, result.Value);
    }

    [Theory]
    [InlineData("%")]            // truncated escape
    [InlineData("%2")]           // truncated escape
    [InlineData("%ZZ")]          // non-hex nibbles
    [InlineData("%E0%A4")]       // incomplete multi-byte sequence
    [InlineData("%80")]          // lone continuation byte
    [InlineData("%C0%80")]       // overlong encoding of NUL
    [InlineData("%ED%A0%80")]    // UTF-8 of a surrogate code point
    public void Decode_rejects_malformed_input_like_decodeURIComponent(string malformed)
    {
        UrlCodecResult result = UrlCodec.Transform(UrlEncoderMode.Decode, malformed);

        Assert.False(result.Ok);
        Assert.Equal(string.Empty, result.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_empty_with_no_output()
    {
        var vm = new UrlEncoderViewModel(Localizer);

        Assert.Equal(UrlEncoderState.Empty, vm.State);
        Assert.False(vm.HasOutput);
        Assert.Equal(string.Empty, vm.Output);
        Assert.True(vm.IsEncode);
        Assert.False(vm.IsDecode);
    }

    [Fact]
    public void ViewModel_encodes_on_input()
    {
        var vm = new UrlEncoderViewModel(Localizer) { Input = PlainSample };

        Assert.Equal(UrlEncoderState.Success, vm.State);
        Assert.True(vm.HasOutput);
        Assert.Equal(EncodedSample, vm.Output);
    }

    [Fact]
    public void ViewModel_decodes_when_mode_switches()
    {
        var vm = new UrlEncoderViewModel(Localizer)
        {
            Mode = UrlEncoderMode.Decode,
            Input = EncodedSample,
        };

        Assert.True(vm.IsDecode);
        Assert.Equal(UrlEncoderState.Success, vm.State);
        Assert.Equal(PlainSample, vm.Output);
    }

    [Fact]
    public void ViewModel_invalid_decode_shows_localized_message_in_output_panel()
    {
        var vm = new UrlEncoderViewModel(Localizer)
        {
            Mode = UrlEncoderMode.Decode,
            Input = "%",
        };

        Assert.Equal(UrlEncoderState.Invalid, vm.State);
        Assert.True(vm.HasOutput); // web shows the panel because `output` (the message) is truthy
        Assert.Equal("Invalid Input", vm.Output);
        Assert.Equal(vm.InvalidMessage, vm.Output);
    }

    [Fact]
    public void ViewModel_clearing_input_returns_to_empty()
    {
        var vm = new UrlEncoderViewModel(Localizer) { Input = PlainSample };
        Assert.True(vm.HasOutput);

        vm.Input = string.Empty;

        Assert.Equal(UrlEncoderState.Empty, vm.State);
        Assert.False(vm.HasOutput);
        Assert.Equal(string.Empty, vm.Output);
    }

    [Fact]
    public void ViewModel_mode_toggle_updates_flags_and_hint()
    {
        var vm = new UrlEncoderViewModel(Localizer);
        Assert.Equal("hello world&foo=bar", vm.InputHint);

        vm.Mode = UrlEncoderMode.Decode;

        Assert.True(vm.IsDecode);
        Assert.False(vm.IsEncode);
        Assert.Equal("hello%20world%26foo%3Dbar", vm.InputHint);
    }

    [Fact]
    public void ViewModel_raises_property_changed_for_state_and_output()
    {
        var vm = new UrlEncoderViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Input = PlainSample;

        Assert.Contains(nameof(UrlEncoderViewModel.Input), changed);
        Assert.Contains(nameof(UrlEncoderViewModel.State), changed);
        Assert.Contains(nameof(UrlEncoderViewModel.Output), changed);
        Assert.Contains(nameof(UrlEncoderViewModel.HasOutput), changed);
    }

    [Fact]
    public void ViewModel_mode_change_raises_mode_and_hint()
    {
        var vm = new UrlEncoderViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Mode = UrlEncoderMode.Decode;

        Assert.Contains(nameof(UrlEncoderViewModel.Mode), changed);
        Assert.Contains(nameof(UrlEncoderViewModel.IsEncode), changed);
        Assert.Contains(nameof(UrlEncoderViewModel.IsDecode), changed);
        Assert.Contains(nameof(UrlEncoderViewModel.InputHint), changed);
    }

    [Fact]
    public void ViewModel_setting_same_value_does_not_raise()
    {
        var vm = new UrlEncoderViewModel(Localizer) { Input = PlainSample };
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Input = PlainSample; // unchanged
        vm.Mode = UrlEncoderMode.Encode; // unchanged

        Assert.Empty(changed);
    }

    // ---- Accessibility names (Narrator) --------------------------------------------

    [Fact]
    public void ViewModel_exposes_non_empty_accessible_names()
    {
        var vm = new UrlEncoderViewModel(Localizer);

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
        Assert.Equal("url", UrlEncoderRegistration.Id);
        Assert.Equal("devtools", UrlEncoderRegistration.Category);
        Assert.Equal("UrlEncoder", UrlEncoderRegistration.Slug);
        Assert.Equal("Url Encoder", UrlEncoderRegistration.Name(Localizer));
        Assert.Equal("Url Encoder Desc", UrlEncoderRegistration.Description(Localizer));
        Assert.Equal("\uE71B", UrlEncoderRegistration.IconGlyph);
        Assert.False(string.IsNullOrEmpty(UrlEncoderRegistration.AccentBrushKey));
        Assert.False(string.IsNullOrEmpty(UrlEncoderRegistration.AccentColorKey));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new UrlEncoderDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UrlEncoder", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_emits_input_or_output()
    {
        // The sink must never receive the user's payload (it can carry secrets in a signed URL).
        var lines = new List<string>();
        var diagnostics = new UrlEncoderDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(lines, line => line.Contains(PlainSample, StringComparison.Ordinal));
        Assert.DoesNotContain(lines, line => line.Contains(EncodedSample, StringComparison.Ordinal));
    }

    // ---- i18n key parity (web t() call sites) --------------------------------------

    [Fact]
    public void ViewModel_routes_every_web_t_key_through_the_localizer()
    {
        var recorder = new RecordingLocalizer();
        var vm = new UrlEncoderViewModel(recorder);

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
        vm.Mode = UrlEncoderMode.Encode;
        _ = vm.InputHint;
        vm.Mode = UrlEncoderMode.Decode;
        _ = vm.InputHint;

        string[] expected =
        [
            "Url Encoder",
            "Url Encoder Desc",
            "Encode",
            "Decode",
            "Input Label",
            "Output Label",
            "Invalid Input",
            "common.copyButton.copy",
            "common.copyButton.copied",
            "devtools.urlEncoder.encodeHint",
            "devtools.urlEncoder.decodeHint",
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
