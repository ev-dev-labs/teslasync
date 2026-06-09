using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the JwtDecoder feature-view's UI-thread-free logic — the pure decode adapter (the
/// web <c>useMemo</c>: blank → idle, fewer than two segments → invalid, base64 + JSON-parse the header and
/// payload, atob-parity rejection of base64url-only characters), the per-state projection (idle / invalid /
/// decoded) with its localized chrome and segment panels, the i18n routing, the accessibility names, the
/// state-holder view-model's transitions, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/JwtDecoder.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class JwtDecoderTests
{
    // The canonical RFC 7519 example token: header {"alg":"HS256","typ":"JWT"},
    // payload {"sub":"1234567890","name":"John Doe","iat":1516239022}.
    private const string CanonicalJwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
        ".eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ" +
        ".SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static string Seg(string json) => Convert.ToBase64String(Encoding.UTF8.GetBytes(json));

    private static JwtDecoderDisplay Project(string? jwt, ILocalizer? localizer = null) =>
        JwtDecoderProjection.Project(JwtDecoderCodec.Decode(jwt), localizer ?? Localizer);

    // ---- Decode adapter: idle branch (web !jwt.trim()) -----------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void Decode_blank_is_idle(string? jwt)
    {
        var result = JwtDecoderCodec.Decode(jwt);

        Assert.Equal(JwtDecoderState.Idle, result.State);
        Assert.Null(result.Header);
        Assert.Null(result.Payload);
    }

    // ---- Decode adapter: invalid branch --------------------------------------------

    [Theory]
    [InlineData("only-one-segment")]
    [InlineData("abc")]
    public void Decode_single_segment_is_invalid(string jwt) =>
        Assert.Equal(JwtDecoderState.Invalid, JwtDecoderCodec.Decode(jwt).State);

    [Fact]
    public void Decode_non_base64_segment_is_invalid() =>
        Assert.Equal(JwtDecoderState.Invalid, JwtDecoderCodec.Decode("@@@@.@@@@").State);

    [Fact]
    public void Decode_valid_base64_but_not_json_is_invalid()
    {
        // "hello" base64-decodes cleanly but is not JSON — the web JSON.parse throws.
        string token = Seg("hello") + "." + Seg("world");
        Assert.Equal(JwtDecoderState.Invalid, JwtDecoderCodec.Decode(token).State);
    }

    [Theory]
    [InlineData("ab-d.YWJj")] // '-' is base64url-only — atob rejects it
    [InlineData("ab_d.YWJj")] // '_' is base64url-only — atob rejects it
    public void Decode_base64url_only_character_is_invalid_atob_parity(string jwt) =>
        Assert.Equal(JwtDecoderState.Invalid, JwtDecoderCodec.Decode(jwt).State);

    // ---- Decode adapter: decoded branch --------------------------------------------

    [Fact]
    public void Decode_canonical_token_decodes_header_and_payload()
    {
        var result = JwtDecoderCodec.Decode(CanonicalJwt);

        Assert.Equal(JwtDecoderState.Decoded, result.State);
        Assert.NotNull(result.Header);
        Assert.NotNull(result.Payload);
        Assert.Equal("HS256", result.Header!.Value.GetProperty("alg").GetString());
        Assert.Equal("JWT", result.Header!.Value.GetProperty("typ").GetString());
        Assert.Equal("John Doe", result.Payload!.Value.GetProperty("name").GetString());
        Assert.Equal(1516239022, result.Payload!.Value.GetProperty("iat").GetInt64());
    }

    [Fact]
    public void Decode_ignores_trailing_signature_segment()
    {
        string token = Seg("{\"alg\":\"none\"}") + "." + Seg("{\"sub\":\"42\"}") + ".signature-here";
        var result = JwtDecoderCodec.Decode(token);

        Assert.Equal(JwtDecoderState.Decoded, result.State);
        Assert.Equal("none", result.Header!.Value.GetProperty("alg").GetString());
        Assert.Equal("42", result.Payload!.Value.GetProperty("sub").GetString());
    }

    [Fact]
    public void Decode_tolerates_missing_padding()
    {
        // {"a":1} → "eyJhIjoxfQ==" with padding; strip it to prove atob-style tolerance.
        string padded = Seg("{\"a\":1}");
        string unpadded = padded.TrimEnd('=');
        string token = unpadded + "." + unpadded;
        var result = JwtDecoderCodec.Decode(token);

        Assert.Equal(JwtDecoderState.Decoded, result.State);
        Assert.Equal(1, result.Header!.Value.GetProperty("a").GetInt32());
    }

    [Fact]
    public void Decode_normalizes_json_null_segment_to_absent()
    {
        // A parsed JSON null is "absent" so the panel is shown only when web `data != null` would show it.
        string token = Seg("null") + "." + Seg("{\"a\":1}");
        var result = JwtDecoderCodec.Decode(token);

        Assert.Equal(JwtDecoderState.Decoded, result.State);
        Assert.Null(result.Header);
        Assert.NotNull(result.Payload);
    }

    // ---- Projection: idle -----------------------------------------------------------

    [Fact]
    public void Project_idle_renders_chrome_and_no_output()
    {
        var display = Project(string.Empty);

        Assert.Equal(JwtDecoderState.Idle, display.State);
        Assert.False(display.HasError);
        Assert.False(display.HasHeader);
        Assert.False(display.HasPayload);
        Assert.Null(display.ErrorMessage);
        Assert.Null(display.StatusAnnouncement);
        Assert.Equal("Jwt Decoder", display.Title);
        Assert.Equal("Jwt Decoder Desc", display.Description);
        Assert.Equal("Jwt Input", display.InputLabel);
        Assert.Equal("purple", display.Accent);
        Assert.False(string.IsNullOrEmpty(display.Glyph));
        Assert.False(string.IsNullOrEmpty(display.InputExample));
    }

    // ---- Projection: invalid --------------------------------------------------------

    [Fact]
    public void Project_invalid_shows_localized_error_and_announces_it()
    {
        var display = Project("abc");

        Assert.Equal(JwtDecoderState.Invalid, display.State);
        Assert.True(display.HasError);
        Assert.Equal("Invalid Jwt", display.ErrorMessage);
        Assert.Equal(display.ErrorMessage, display.StatusAnnouncement);
        Assert.False(display.HasHeader);
        Assert.False(display.HasPayload);
    }

    // ---- Projection: decoded --------------------------------------------------------

    [Fact]
    public void Project_decoded_exposes_both_segment_panels()
    {
        var display = Project(CanonicalJwt);

        Assert.Equal(JwtDecoderState.Decoded, display.State);
        Assert.False(display.HasError);
        Assert.True(display.HasHeader);
        Assert.True(display.HasPayload);
        Assert.Equal("Jwt Header", display.HeaderPanel.Title);
        Assert.Equal("Jwt Payload", display.PayloadPanel.Title);
        Assert.NotNull(display.HeaderPanel.Data);
        Assert.NotNull(display.PayloadPanel.Data);
    }

    [Fact]
    public void Project_decoded_panel_data_serializes_to_segment_json()
    {
        var display = Project(CanonicalJwt);

        string header = ResultPanelProjection.Serialize(display.HeaderPanel.Data);
        string payload = ResultPanelProjection.Serialize(display.PayloadPanel.Data);

        Assert.Contains("\"alg\": \"HS256\"", header, StringComparison.Ordinal);
        Assert.Contains("\"sub\": \"1234567890\"", payload, StringComparison.Ordinal);
        Assert.Contains("\"name\": \"John Doe\"", payload, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_decoded_with_null_header_hides_only_header_panel()
    {
        string token = Seg("null") + "." + Seg("{\"a\":1}");
        var display = Project(token);

        Assert.Equal(JwtDecoderState.Decoded, display.State);
        Assert.False(display.HasHeader);
        Assert.True(display.HasPayload);
    }

    // ---- i18n routing (every owned string flows through the facade) -----------------

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = Project(CanonicalJwt, new PrefixLocalizer());

        Assert.Equal("L:Jwt Decoder", display.Title);
        Assert.Equal("L:Jwt Decoder Desc", display.Description);
        Assert.Equal("L:Jwt Input", display.InputLabel);
        Assert.Equal("L:Jwt Header", display.HeaderPanel.Title);
        Assert.Equal("L:Jwt Payload", display.PayloadPanel.Title);
    }

    [Fact]
    public void Project_invalid_error_routes_through_localizer()
    {
        var display = Project("abc", new PrefixLocalizer());
        Assert.Equal("L:Invalid Jwt", display.ErrorMessage);
    }

    // ---- Accessibility (region name + segment panel labels) -------------------------

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    public void Project_region_name_is_the_localized_title(string jwt)
    {
        var display = Project(jwt);

        Assert.False(string.IsNullOrWhiteSpace(display.RegionName));
        Assert.Equal(display.Title, display.RegionName);
    }

    [Fact]
    public void Project_segment_panel_titles_are_non_empty()
    {
        var display = Project(CanonicalJwt);

        Assert.False(string.IsNullOrWhiteSpace(display.HeaderPanel.Title));
        Assert.False(string.IsNullOrWhiteSpace(display.PayloadPanel.Title));
    }

    // ---- Projection guards ----------------------------------------------------------

    [Fact]
    public void Project_rejects_null_result() =>
        Assert.Throws<ArgumentNullException>(() => JwtDecoderProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => JwtDecoderProjection.Project(JwtDecodeResult.Idle, null!));

    // ---- View-model: seeding + transitions -----------------------------------------

    [Fact]
    public void ViewModel_seeds_idle_from_empty()
    {
        var vm = new JwtDecoderViewModel(Localizer);

        Assert.Equal(JwtDecoderState.Idle, vm.State);
        Assert.False(vm.HasError);
        Assert.False(vm.HasHeader);
        Assert.False(vm.HasPayload);
    }

    [Fact]
    public void ViewModel_seeds_decoded_from_initial_token()
    {
        var vm = new JwtDecoderViewModel(Localizer, CanonicalJwt);

        Assert.Equal(JwtDecoderState.Decoded, vm.State);
        Assert.True(vm.HasHeader);
        Assert.True(vm.HasPayload);
        Assert.Equal(CanonicalJwt, vm.Jwt);
    }

    [Fact]
    public void ViewModel_update_transitions_to_decoded_and_raises()
    {
        var vm = new JwtDecoderViewModel(Localizer);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.UpdateText(CanonicalJwt);

        Assert.Equal(JwtDecoderState.Decoded, vm.State);
        Assert.True(vm.HasHeader);
        Assert.Contains(nameof(JwtDecoderViewModel.Display), raised);
        Assert.Contains(nameof(JwtDecoderViewModel.State), raised);
        Assert.Contains(nameof(JwtDecoderViewModel.HasHeader), raised);
    }

    [Fact]
    public void ViewModel_update_transitions_to_invalid()
    {
        var vm = new JwtDecoderViewModel(Localizer);
        vm.UpdateText("abc");

        Assert.Equal(JwtDecoderState.Invalid, vm.State);
        Assert.True(vm.HasError);
    }

    [Fact]
    public void ViewModel_update_with_unchanged_text_is_noop()
    {
        var vm = new JwtDecoderViewModel(Localizer, CanonicalJwt);
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.UpdateText(CanonicalJwt);

        Assert.False(raised);
    }

    [Fact]
    public void ViewModel_update_back_to_empty_returns_to_idle()
    {
        var vm = new JwtDecoderViewModel(Localizer, CanonicalJwt);
        vm.UpdateText(string.Empty);

        Assert.Equal(JwtDecoderState.Idle, vm.State);
        Assert.False(vm.HasHeader);
        Assert.False(vm.HasPayload);
    }

    [Fact]
    public void ViewModel_reload_reprojects_current_token()
    {
        var vm = new JwtDecoderViewModel(Localizer, CanonicalJwt);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Reload();

        Assert.Equal(JwtDecoderState.Decoded, vm.State);
        Assert.Contains(nameof(JwtDecoderViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new JwtDecoderViewModel(null!));

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new JwtDecoderDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=JwtDecoder", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new JwtDecoderDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_and_tool_id_are_stable()
    {
        Assert.Equal("JwtDecoder", JwtDecoderRegistration.Slug);
        Assert.Equal("jwt", JwtDecoderRegistration.ToolId);
    }

    // ---- Helpers / test doubles ----------------------------------------------------

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
