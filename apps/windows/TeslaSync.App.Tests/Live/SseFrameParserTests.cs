using TeslaSync.App.Core.Live;
using Xunit;

namespace TeslaSync.App.Tests.Live;

/// <summary>
/// Verifies the incremental SSE wire parser: multi-line data joining, <c>id</c>/<c>retry</c>
/// fields, comment/heartbeat lines, CRLF handling, and frames split across feed boundaries.
/// </summary>
public sealed class SseFrameParserTests
{
    [Fact]
    public void Parses_a_single_named_frame_with_id()
    {
        var parser = new SseFrameParser();

        var frames = parser.Feed("event: heartbeat\nid: 42\ndata: {\"time\":\"t\"}\n\n");

        var frame = Assert.Single(frames);
        Assert.Equal("heartbeat", frame.Event);
        Assert.Equal("42", frame.LastEventId);
        Assert.Equal("{\"time\":\"t\"}", frame.Data);
    }

    [Fact]
    public void Joins_multiple_data_lines_with_newline()
    {
        var parser = new SseFrameParser();

        var frames = parser.Feed("data: line1\ndata: line2\n\n");

        var frame = Assert.Single(frames);
        Assert.Equal("line1\nline2", frame.Data);
    }

    [Fact]
    public void Parses_retry_field_as_milliseconds()
    {
        var parser = new SseFrameParser();

        var frames = parser.Feed("retry: 2500\ndata: x\n\n");

        Assert.Equal(2500L, Assert.Single(frames).Retry);
    }

    [Fact]
    public void Ignores_comment_lines_but_flags_them_as_keepalive()
    {
        var parser = new SseFrameParser();

        var frames = parser.Feed(": keep-alive ping\n");

        Assert.Empty(frames);
        Assert.True(parser.LastFeedHadComment);
    }

    [Fact]
    public void Reassembles_a_frame_split_across_chunks()
    {
        var parser = new SseFrameParser();

        Assert.Empty(parser.Feed("event: conn"));
        Assert.Empty(parser.Feed("ected\ndata: {\"client_id\":"));
        var frames = parser.Feed("\"c1\"}\n\n");

        var frame = Assert.Single(frames);
        Assert.Equal("connected", frame.Event);
        Assert.Equal("{\"client_id\":\"c1\"}", frame.Data);
    }

    [Fact]
    public void Strips_trailing_carriage_return_for_crlf_streams()
    {
        var parser = new SseFrameParser();

        var frames = parser.Feed("event: alert\r\ndata: {}\r\n\r\n");

        var frame = Assert.Single(frames);
        Assert.Equal("alert", frame.Event);
        Assert.Equal("{}", frame.Data);
    }

    [Fact]
    public void Resets_field_state_between_frames()
    {
        var parser = new SseFrameParser();

        parser.Feed("event: heartbeat\ndata: a\n\n");
        var frames = parser.Feed("data: b\n\n");

        var frame = Assert.Single(frames);
        Assert.Null(frame.Event);
        Assert.Equal("b", frame.Data);
    }
}
