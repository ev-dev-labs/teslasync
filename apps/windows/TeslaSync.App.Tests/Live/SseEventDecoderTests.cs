using TeslaSync.App.Core.Live;
using Xunit;

namespace TeslaSync.App.Tests.Live;

/// <summary>
/// Verifies the SSE frame decoder maps each named event to its typed <see cref="LiveEvent"/>,
/// resolves typed signal envelopes (long-form and integer <c>kind</c>), and degrades malformed or
/// unknown frames to <see cref="LiveEvent.Unknown"/> while reporting the parse failure.
/// </summary>
public sealed class SseEventDecoderTests
{
    [Fact]
    public void Decodes_connected_with_client_id()
    {
        var frame = new SseFrame("connected", "{\"client_id\":\"c1\"}", null, null);

        var connected = Assert.IsType<LiveEvent.Connected>(SseEventDecoder.Decode(frame));
        Assert.Equal("c1", connected.ClientId);
    }

    [Fact]
    public void Decodes_heartbeat_time()
    {
        var frame = new SseFrame("heartbeat", "{\"time\":\"2026-01-01T00:00:00Z\"}", "9", null);

        var heartbeat = Assert.IsType<LiveEvent.Heartbeat>(SseEventDecoder.Decode(frame));
        Assert.Equal("2026-01-01T00:00:00Z", heartbeat.Time);
        Assert.Equal("9", heartbeat.Id);
    }

    [Fact]
    public void Decodes_signal_change_with_long_form_kind()
    {
        var json = "{\"vehicle_id\":7,\"field\":\"VehicleSpeed\",\"kind\":\"ValueKindFloat\",\"value\":21.5,\"ts\":\"t\"}";
        var frame = new SseFrame("signal_change", json, null, null);

        var signal = Assert.IsType<LiveEvent.Signal>(SseEventDecoder.Decode(frame));
        Assert.Equal(7, signal.Envelope.VehicleId);
        Assert.Equal("VehicleSpeed", signal.Envelope.Field);
        Assert.Equal(SignalKind.Float, signal.Envelope.Kind);
        var number = Assert.IsType<SignalValue.Number>(signal.Envelope.Value);
        Assert.Equal(21.5, number.Value);
    }

    [Fact]
    public void Decodes_signal_change_with_integer_kind_and_bool_value()
    {
        var json = "{\"vehicle_id\":3,\"field\":\"Locked\",\"kind\":2,\"value\":true,\"ts\":\"t\"}";
        var frame = new SseFrame("signal_change", json, null, null);

        var signal = Assert.IsType<LiveEvent.Signal>(SseEventDecoder.Decode(frame));
        Assert.Equal(SignalKind.Bool, signal.Envelope.Kind);
        Assert.True(Assert.IsType<SignalValue.Flag>(signal.Envelope.Value).Value);
    }

    [Fact]
    public void Degrades_signal_change_with_missing_field_to_unknown()
    {
        var json = "{\"vehicle_id\":3,\"kind\":\"ValueKindFloat\",\"value\":1,\"ts\":\"t\"}";
        var frame = new SseFrame("signal_change", json, null, null);

        var live = SseEventDecoder.Decode(frame, out bool parseFailed);

        Assert.IsType<LiveEvent.Unknown>(live);
        Assert.True(parseFailed);
    }

    [Fact]
    public void Degrades_malformed_object_event_to_unknown_and_reports_failure()
    {
        var frame = new SseFrame("vehicle_update", "not-json", null, null);

        var live = SseEventDecoder.Decode(frame, out bool parseFailed);

        var unknown = Assert.IsType<LiveEvent.Unknown>(live);
        Assert.Equal("vehicle_update", unknown.Event);
        Assert.Equal("not-json", unknown.Data);
        Assert.True(parseFailed);
    }

    [Fact]
    public void Decodes_well_formed_vehicle_update_object()
    {
        var frame = new SseFrame("vehicle_update", "{\"vehicle_id\":5,\"speed\":10}", null, null);

        var live = SseEventDecoder.Decode(frame, out bool parseFailed);

        var update = Assert.IsType<LiveEvent.VehicleUpdate>(live);
        Assert.Equal(5, update.Data.GetProperty("vehicle_id").GetInt64());
        Assert.False(parseFailed);
    }

    [Fact]
    public void Unnamed_or_unrecognised_event_becomes_unknown_without_parse_failure()
    {
        var frame = new SseFrame(null, "anything", null, null);

        var live = SseEventDecoder.Decode(frame, out bool parseFailed);

        Assert.IsType<LiveEvent.Unknown>(live);
        Assert.False(parseFailed);
    }
}
