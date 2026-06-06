using TeslaSync.App.Core.Push;
using Xunit;

namespace TeslaSync.App.Tests.Push;

/// <summary>Verifies the tolerant <see cref="PushPayloadParser"/>.</summary>
public sealed class PushPayloadParserTests
{
    [Fact]
    public void Parse_reads_kind_title_body_category_and_data()
    {
        var payload = PushPayloadParser.Parse(
            """{"kind":"charge_complete","title":"Done","body":"At 80%","category":"alert","data":{"route":"charging/7"}}""");

        Assert.Equal("charge_complete", payload.Kind);
        Assert.Equal("Done", payload.Title);
        Assert.Equal("At 80%", payload.Body);
        Assert.Equal("alert", payload.Category);
        Assert.Equal("charging/7", payload.Data["route"]);
    }

    [Fact]
    public void Parse_falls_back_to_type_and_message_aliases()
    {
        var payload = PushPayloadParser.Parse("""{"type":"alert_fired","message":"Speeding"}""");

        Assert.Equal("alert_fired", payload.Kind);
        Assert.Equal("Speeding", payload.Body);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json")]
    [InlineData("[1,2,3]")]
    [InlineData("\"a string\"")]
    public void Parse_returns_unknown_for_unparseable_or_non_object(string? raw)
    {
        var payload = PushPayloadParser.Parse(raw);

        Assert.Equal(PushPayload.UnknownKind, payload.Kind);
        Assert.Null(payload.Title);
        Assert.Empty(payload.Data);
    }

    [Fact]
    public void Parse_defaults_kind_when_only_text_present()
    {
        var payload = PushPayloadParser.Parse("""{"title":"Hi"}""");

        Assert.Equal(PushPayload.UnknownKind, payload.Kind);
        Assert.Equal("Hi", payload.Title);
    }
}
