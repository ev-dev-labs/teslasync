using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.DlqInspector;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the EntryDrawer surface's UI-thread-free logic — the JSON parse adapter (real
/// snake_case wire + camelCase tolerance + missing-field defaults), the strict base64 → UTF-8 decode
/// (valid / empty / invalid-base64 / non-UTF-8 binary), the head fallback + render-state resolver
/// (loading / content / empty), the eight projected field rows (labels / order / values / em-dash gating /
/// styles), the payload-viewer text (decoded body vs binary marker), the copy-button value, the
/// replay-disabled gate, the registration i18n keys + fallbacks (which double as the Narrator labels), the
/// PII-safe diagnostics, and the state-holder view-model's per-state flows + close / replay contract.
/// Mirrors the web spec (web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx). The WinUI view
/// itself (EntryDrawer.cs) is exercised by the app build.
/// </summary>
public sealed class EntryDrawerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static string B64(string text) => Convert.ToBase64String(Encoding.UTF8.GetBytes(text));

    private static DlqEntrySummary Summary(
        long id = 7,
        string arrivedAt = "2026-06-06T12:00:00Z",
        string parsedReason = "decode_error",
        bool replayable = true,
        long rawPayloadSize = 256,
        string? parsedVin = "5YJ3E1EA7KF000001",
        string? parsedSourceTopic = "telemetry/abc/v/Soc",
        int? parsedRedeliveries = 1234,
        string dlqTopic = "dlq/telemetry",
        long? parsedVehicleId = 9,
        string? parsedTimestamp = "2026-06-06T11:59:00Z",
        string? parseError = "proto: cannot parse",
        long innerPayloadSize = 64) =>
        new(
            id,
            arrivedAt,
            parsedReason,
            replayable,
            rawPayloadSize,
            parsedVin,
            parsedSourceTopic,
            parsedRedeliveries,
            dlqTopic,
            parsedVehicleId,
            parsedTimestamp,
            parseError,
            innerPayloadSize);

    private static DlqEntryFull Full(
        DlqEntrySummary? summary = null,
        string innerB64 = "",
        string rawB64 = "") =>
        new(summary ?? Summary(), rawB64, innerB64);

    // ── Parse adapter (web DLQEntrySummary / DLQEntryFull DTO) ─────────────────────────────────────────────

    [Fact]
    public void ParseFull_parses_real_snake_case_wire()
    {
        string json = $$"""
        {
          "id": 42,
          "arrived_at": "2026-06-06T12:00:00Z",
          "dlq_topic": "dlq/telemetry",
          "parsed_reason": "decode_error",
          "parsed_vehicle_id": 9,
          "parsed_vin": "5YJ3E1EA7KF000001",
          "parsed_source_topic": "telemetry/abc/v/Soc",
          "parsed_redeliveries": 3,
          "parsed_timestamp": "2026-06-06T11:59:00Z",
          "parse_error": "proto: cannot parse",
          "replayable": true,
          "raw_payload_size": 256,
          "inner_payload_size": 64,
          "raw_payload_b64": "{{B64("envelope")}}",
          "inner_payload_b64": "{{B64("inner")}}"
        }
        """;
        using var doc = JsonDocument.Parse(json);

        DlqEntryFull full = DlqEntryParsing.ParseFull(doc.RootElement);

        Assert.Equal(42, full.Summary.Id);
        Assert.Equal("2026-06-06T12:00:00Z", full.Summary.ArrivedAt);
        Assert.Equal("dlq/telemetry", full.Summary.DlqTopic);
        Assert.Equal("decode_error", full.Summary.ParsedReason);
        Assert.Equal(9, full.Summary.ParsedVehicleId);
        Assert.Equal("5YJ3E1EA7KF000001", full.Summary.ParsedVin);
        Assert.Equal("telemetry/abc/v/Soc", full.Summary.ParsedSourceTopic);
        Assert.Equal(3, full.Summary.ParsedRedeliveries);
        Assert.Equal("proto: cannot parse", full.Summary.ParseError);
        Assert.True(full.Summary.Replayable);
        Assert.Equal(256, full.Summary.RawPayloadSize);
        Assert.Equal(64, full.Summary.InnerPayloadSize);
        Assert.Equal(B64("envelope"), full.RawPayloadB64);
        Assert.Equal(B64("inner"), full.InnerPayloadB64);
    }

    [Fact]
    public void ParseFull_accepts_camel_case_aliases()
    {
        string json = $$"""
        {
          "id": "7",
          "arrivedAt": "2026-06-06T12:00:00Z",
          "dlqTopic": "dlq/x",
          "parsedReason": "boom",
          "parsedVin": "VINX",
          "parsedSourceTopic": "t/x",
          "parsedRedeliveries": 5,
          "parseError": "bad",
          "replayable": false,
          "rawPayloadSize": 10,
          "innerPayloadSize": 20,
          "rawPayloadB64": "{{B64("rawcamel")}}",
          "innerPayloadB64": "{{B64("innercamel")}}"
        }
        """;
        using var doc = JsonDocument.Parse(json);

        DlqEntryFull full = DlqEntryParsing.ParseFull(doc.RootElement);

        Assert.Equal(7, full.Summary.Id);
        Assert.Equal("dlq/x", full.Summary.DlqTopic);
        Assert.Equal("VINX", full.Summary.ParsedVin);
        Assert.Equal(5, full.Summary.ParsedRedeliveries);
        Assert.False(full.Summary.Replayable);
        Assert.Equal(10, full.Summary.RawPayloadSize);
        Assert.Equal(20, full.Summary.InnerPayloadSize);
        Assert.Equal(B64("rawcamel"), full.RawPayloadB64);
        Assert.Equal(B64("innercamel"), full.InnerPayloadB64);
    }

    [Fact]
    public void ParseSummary_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":2}""");

        DlqEntrySummary summary = DlqEntryParsing.ParseSummary(doc.RootElement);

        Assert.Equal(2, summary.Id);
        Assert.Equal(string.Empty, summary.ArrivedAt);
        Assert.Equal(string.Empty, summary.ParsedReason);
        Assert.Equal(string.Empty, summary.DlqTopic);
        Assert.False(summary.Replayable);
        Assert.Null(summary.ParsedVin);
        Assert.Null(summary.ParsedSourceTopic);
        Assert.Null(summary.ParsedRedeliveries);
        Assert.Null(summary.ParseError);
        Assert.Equal(0, summary.RawPayloadSize);
        Assert.Equal(0, summary.InnerPayloadSize);
    }

    [Fact]
    public void ParseFull_defaults_missing_payloads_to_empty()
    {
        using var doc = JsonDocument.Parse("""{"id":1,"replayable":true}""");

        DlqEntryFull full = DlqEntryParsing.ParseFull(doc.RootElement);

        Assert.Equal(string.Empty, full.RawPayloadB64);
        Assert.Equal(string.Empty, full.InnerPayloadB64);
    }

    // ── Base64 → UTF-8 decode (web decodeBase64Utf8) ──────────────────────────────────────────────────────

    [Fact]
    public void DecodeBase64Utf8_decodes_valid_utf8() =>
        Assert.Equal("hello world", EntryDrawerProjection.DecodeBase64Utf8(B64("hello world")));

    [Fact]
    public void DecodeBase64Utf8_empty_input_is_empty() =>
        Assert.Equal(string.Empty, EntryDrawerProjection.DecodeBase64Utf8(string.Empty));

    [Fact]
    public void DecodeBase64Utf8_invalid_base64_is_empty() =>
        Assert.Equal(string.Empty, EntryDrawerProjection.DecodeBase64Utf8("not valid base64!!"));

    [Fact]
    public void DecodeBase64Utf8_non_utf8_binary_is_empty()
    {
        string binary = Convert.ToBase64String(new byte[] { 0xFF, 0xFE, 0xFD, 0x00 });
        Assert.Equal(string.Empty, EntryDrawerProjection.DecodeBase64Utf8(binary));
    }

    // ── Head fallback + render-state resolver ─────────────────────────────────────────────────────────────

    [Fact]
    public void Head_prefers_full_summary_then_summary()
    {
        var summaryOnly = Summary(id: 1);
        var full = Full(Summary(id: 2));

        Assert.Equal(2, EntryDrawerProjection.Head(full, summaryOnly)!.Id);
        Assert.Equal(1, EntryDrawerProjection.Head(null, summaryOnly)!.Id);
        Assert.Null(EntryDrawerProjection.Head(null, null));
    }

    [Fact]
    public void State_is_loading_while_full_absent_even_with_summary()
    {
        var head = EntryDrawerProjection.Head(null, Summary());
        Assert.Equal(EntryDrawerState.Loading, EntryDrawerProjection.ResolveState(loading: true, full: null, head: head));
    }

    [Fact]
    public void State_is_content_when_full_present()
    {
        var full = Full(Summary());
        var head = EntryDrawerProjection.Head(full, null);
        Assert.Equal(EntryDrawerState.Content, EntryDrawerProjection.ResolveState(loading: true, full: full, head: head));
    }

    [Fact]
    public void State_is_content_when_summary_present_and_not_loading()
    {
        var head = EntryDrawerProjection.Head(null, Summary());
        Assert.Equal(EntryDrawerState.Content, EntryDrawerProjection.ResolveState(loading: false, full: null, head: head));
    }

    [Fact]
    public void State_is_empty_when_no_head_and_not_loading() =>
        Assert.Equal(EntryDrawerState.Empty, EntryDrawerProjection.ResolveState(loading: false, full: null, head: null));

    // ── Title ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_interpolates_id_when_head_present() =>
        Assert.Equal("DLQ entry #42", EntryDrawerProjection.Title(Summary(id: 42), Localizer));

    [Fact]
    public void Title_falls_back_without_head() =>
        Assert.Equal("DLQ entry", EntryDrawerProjection.Title(null, Localizer));

    // ── Field rows (web KVList) ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void BuildFields_emits_eight_rows_in_web_order()
    {
        var fields = EntryDrawerProjection.BuildFields(Summary(), Localizer, Now);

        Assert.Equal(
            ["ID", "Arrived", "DLQ topic", "Reason", "VIN", "Source topic", "Redeliveries", "Parse error"],
            fields.Select(f => f.Label).ToArray());
    }

    [Fact]
    public void BuildFields_formats_values()
    {
        var fields = EntryDrawerProjection.BuildFields(Summary(id: 7, parsedRedeliveries: 1234), Localizer, Now);

        Assert.Equal("7", fields[0].Value);
        Assert.Contains("2026", fields[1].Value, StringComparison.Ordinal); // absolute timestamp parsed
        Assert.Equal("dlq/telemetry", fields[2].Value);
        Assert.Equal("decode_error", fields[3].Value);
        Assert.Equal("5YJ3E1EA7KF000001", fields[4].Value);
        Assert.Equal("telemetry/abc/v/Soc", fields[5].Value);
        Assert.Equal("1,234", fields[6].Value); // web fmtInt grouping
        Assert.Equal("proto: cannot parse", fields[7].Value);
    }

    [Fact]
    public void BuildFields_applies_value_styles()
    {
        var fields = EntryDrawerProjection.BuildFields(Summary(), Localizer, Now);

        Assert.Equal(EntryFieldStyle.Mono, fields[0].Style); // id
        Assert.Equal(EntryFieldStyle.Plain, fields[1].Style); // arrived
        Assert.Equal(EntryFieldStyle.Mono, fields[2].Style); // dlq topic
        Assert.Equal(EntryFieldStyle.Mono, fields[3].Style); // reason
        Assert.Equal(EntryFieldStyle.Mono, fields[4].Style); // vin
        Assert.Equal(EntryFieldStyle.Mono, fields[5].Style); // source topic
        Assert.Equal(EntryFieldStyle.Plain, fields[6].Style); // redeliveries
        Assert.Equal(EntryFieldStyle.Muted, fields[7].Style); // parse error
    }

    [Fact]
    public void BuildFields_uses_em_dash_for_missing_values()
    {
        var fields = EntryDrawerProjection.BuildFields(
            Summary(
                arrivedAt: "",
                dlqTopic: "",
                parsedReason: "",
                parsedVin: null,
                parsedSourceTopic: null,
                parsedRedeliveries: null,
                parseError: null),
            Localizer,
            Now);

        Assert.Equal(EntryDrawerProjection.EmDash, fields[1].Value); // arrived (unparseable)
        Assert.Equal(EntryDrawerProjection.EmDash, fields[2].Value); // dlq topic ('' || dash)
        Assert.Equal(EntryDrawerProjection.EmDash, fields[3].Value); // reason ('' || dash)
        Assert.Equal(EntryDrawerProjection.EmDash, fields[4].Value); // vin (null ?? dash)
        Assert.Equal(EntryDrawerProjection.EmDash, fields[5].Value); // source topic (null ?? dash)
        Assert.Equal(EntryDrawerProjection.EmDash, fields[6].Value); // redeliveries (null)
        Assert.Equal(EntryDrawerProjection.EmDash, fields[7].Value); // parse error (null || dash)
    }

    // ── Payload viewer text (web <pre>) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void PayloadText_inner_shows_decoded_body() =>
        Assert.Equal(
            "{\"soc\":80}",
            EntryDrawerProjection.PayloadText(EntryDrawerTab.Inner, Summary(), "{\"soc\":80}", "raw", Localizer));

    [Fact]
    public void PayloadText_inner_falls_back_to_binary_marker_with_size()
    {
        string text = EntryDrawerProjection.PayloadText(
            EntryDrawerTab.Inner, Summary(innerPayloadSize: 64), innerText: "", rawText: "raw", Localizer);

        Assert.Equal("(non-UTF-8 binary, 64 bytes \u2014 use the copy button to download base64)", text);
    }

    [Fact]
    public void PayloadText_raw_falls_back_to_binary_envelope_marker_with_size()
    {
        string text = EntryDrawerProjection.PayloadText(
            EntryDrawerTab.Raw, Summary(rawPayloadSize: 256), innerText: "inner", rawText: "", Localizer);

        Assert.Equal("(non-UTF-8 envelope, 256 bytes \u2014 use the copy button to download base64)", text);
    }

    // ── Copy text (web CopyButton text) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void CopyText_prefers_decoded_then_base64_then_empty()
    {
        var full = Full(innerB64: "AAAA", rawB64: "BBBB");

        Assert.Equal("decoded", EntryDrawerProjection.CopyText(EntryDrawerTab.Inner, full, "decoded", "rawdec"));
        Assert.Equal("AAAA", EntryDrawerProjection.CopyText(EntryDrawerTab.Inner, full, "", "rawdec"));
        Assert.Equal("BBBB", EntryDrawerProjection.CopyText(EntryDrawerTab.Raw, full, "", ""));
        Assert.Equal(string.Empty, EntryDrawerProjection.CopyText(EntryDrawerTab.Inner, null, "", ""));
    }

    // ── Replay-disabled gate (web replayDisabled) ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true, true, false, false, false)] // all good -> enabled
    [InlineData(false, true, false, false, true)] // server disabled
    [InlineData(true, false, false, false, true)] // not replayable
    [InlineData(true, true, true, false, true)] // replay in flight
    [InlineData(true, true, false, true, true)] // still loading
    public void ReplayDisabled_matches_web(bool replayEnabled, bool replayable, bool inFlight, bool loading, bool expected)
    {
        var head = Summary(replayable: replayable);
        Assert.Equal(expected, EntryDrawerProjection.ReplayDisabled(replayEnabled, head, inFlight, loading));
    }

    [Fact]
    public void ReplayDisabled_is_true_when_head_absent() =>
        Assert.True(EntryDrawerProjection.ReplayDisabled(replayEnabled: true, head: null, replayInFlight: false, loading: false));

    // ── Registration / i18n (the Narrator-label source) ───────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_web_keys_and_fallbacks()
    {
        Assert.Equal("EntryDrawer", EntryDrawerRegistration.Slug);
        Assert.Equal("Inner payload", EntryDrawerRegistration.TabInner(Localizer));
        Assert.Equal("Raw envelope", EntryDrawerRegistration.TabRaw(Localizer));
        Assert.Equal("Replay", EntryDrawerRegistration.Replay(Localizer));
        Assert.Equal("Close", EntryDrawerRegistration.Close(Localizer));
        Assert.Equal("Copy", EntryDrawerRegistration.Copy(Localizer));
        Assert.Equal("Copied", EntryDrawerRegistration.Copied(Localizer));
        Assert.Equal("No data available", EntryDrawerRegistration.EmptyMessage(Localizer));
        Assert.False(string.IsNullOrWhiteSpace(EntryDrawerRegistration.RegionLabel(Localizer)));
    }

    // ── Diagnostics (PII-safe view.opened) ────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EntryDrawerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EntryDrawer", Assert.Single(lines));
    }

    // ── View-model state-holder flows ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_loading_state_renders_spinner_branch()
    {
        var vm = new EntryDrawerViewModel(Localizer, clock: () => Now);
        vm.SetEntry(Summary(), full: null, loading: true);

        Assert.Equal(EntryDrawerState.Loading, vm.State);
        Assert.True(vm.HasHead);
    }

    [Fact]
    public void ViewModel_content_state_projects_fields_and_payloads()
    {
        var vm = new EntryDrawerViewModel(Localizer, clock: () => Now);
        vm.SetEntry(Summary(), Full(Summary(), innerB64: B64("{\"soc\":80}"), rawB64: B64("envelope")), loading: false);

        Assert.Equal(EntryDrawerState.Content, vm.State);
        Assert.Equal("DLQ entry #7", vm.Title);
        Assert.Equal(8, vm.Fields.Count);
        Assert.Equal("{\"soc\":80}", vm.InnerPayloadText);
        Assert.Equal("envelope", vm.RawPayloadText);
        Assert.Equal("{\"soc\":80}", vm.InnerCopyText);
    }

    [Fact]
    public void ViewModel_empty_state_when_no_entry()
    {
        var vm = new EntryDrawerViewModel(Localizer, clock: () => Now);
        vm.SetEntry(summary: null, full: null, loading: false);

        Assert.Equal(EntryDrawerState.Empty, vm.State);
        Assert.False(vm.HasHead);
        Assert.Empty(vm.Fields);
    }

    [Fact]
    public void ViewModel_active_tab_drives_active_payload_and_copy()
    {
        var vm = new EntryDrawerViewModel(Localizer, clock: () => Now);
        vm.SetEntry(Summary(), Full(Summary(), innerB64: B64("inner-body"), rawB64: B64("raw-body")), loading: false);

        Assert.Equal(EntryDrawerTab.Inner, vm.ActiveTab);
        Assert.Equal("inner-body", vm.ActivePayloadText);

        vm.SetActiveTab(EntryDrawerTab.Raw);

        Assert.Equal("raw-body", vm.ActivePayloadText);
        Assert.Equal("raw-body", vm.ActiveCopyText);
    }

    [Fact]
    public void ViewModel_replay_request_fires_only_when_enabled()
    {
        var vm = new EntryDrawerViewModel(Localizer, clock: () => Now)
        {
            ReplayEnabled = true,
        };
        vm.SetEntry(Summary(replayable: true), Full(Summary(replayable: true)), loading: false);

        int replays = 0;
        vm.ReplayRequested += (_, _) => replays++;

        Assert.False(vm.ReplayDisabled);
        vm.RequestReplay();
        Assert.Equal(1, replays);

        vm.ReplayInFlight = true;
        Assert.True(vm.ReplayDisabled);
        vm.RequestReplay();
        Assert.Equal(1, replays); // no-op while disabled
    }

    [Fact]
    public void ViewModel_close_request_raises_event()
    {
        var vm = new EntryDrawerViewModel(Localizer, clock: () => Now);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;

        vm.RequestClose();

        Assert.Equal(1, closes);
    }

    [Fact]
    public void ViewModel_notify_opened_records_diagnostic()
    {
        var lines = new List<string>();
        var vm = new EntryDrawerViewModel(Localizer, new EntryDrawerDiagnostics(lines.Add), () => Now);

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=EntryDrawer", Assert.Single(lines));
    }

    [Fact]
    public void ViewModel_set_entry_raises_property_changed()
    {
        var vm = new EntryDrawerViewModel(Localizer, clock: () => Now);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.SetEntry(Summary(), Full(Summary()), loading: false);

        Assert.Contains(nameof(EntryDrawerViewModel.State), changed);
        Assert.Contains(nameof(EntryDrawerViewModel.Fields), changed);
        Assert.Contains(nameof(EntryDrawerViewModel.Title), changed);
    }

    [Fact]
    public void ViewModel_exposes_localized_chrome_labels()
    {
        var vm = new EntryDrawerViewModel(Localizer, clock: () => Now);

        Assert.Equal("Inner payload", vm.TabInnerLabel);
        Assert.Equal("Raw envelope", vm.TabRawLabel);
        Assert.Equal("Replay", vm.ReplayLabel);
        Assert.Equal("Close", vm.CloseLabel);
        Assert.Equal("Copy", vm.CopyLabel);
        Assert.Equal("Copied", vm.CopiedLabel);
        Assert.Equal("No data available", vm.EmptyMessage);
    }
}
