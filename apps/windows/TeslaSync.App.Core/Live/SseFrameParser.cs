using System.Globalization;
using System.Text;

namespace TeslaSync.App.Core.Live;

/// <summary>
/// One dispatched Server-Sent-Events frame: the accumulated <c>event</c>, <c>data</c>,
/// <c>id</c> and <c>retry</c> fields between two blank-line boundaries (W3C EventSource framing).
///
/// <para><see cref="Data"/> is the multi-line <c>data:</c> payload joined with <c>\n</c> (the
/// spec's dispatch rule). <see cref="LastEventId"/> is the most recent <c>id:</c> field of THIS
/// frame, or <see langword="null"/> when the frame carried none. <see cref="Retry"/> is the
/// server-suggested reconnection delay in milliseconds, when a valid <c>retry:</c> field was
/// present.</para>
/// </summary>
public sealed record SseFrame(string? Event, string Data, string? LastEventId, long? Retry);

/// <summary>
/// Incremental, allocation-light parser for the SSE wire format. Feed it arbitrary text chunks
/// (lines may be split across chunk boundaries) via <see cref="Feed"/>; it returns the frames
/// completed by that chunk. State persists across <see cref="Feed"/> calls so a frame split over
/// several reads is assembled correctly.
///
/// <para>Mirrors the framing the web <c>EventSource</c> does natively (and the shared Kotlin
/// <c>SseFrameParser</c>), which the Windows transport must reproduce by hand because no native
/// EventSource exists off-browser. Comment lines (leading <c>:</c>, used by the server for
/// keep-alive heartbeats) are ignored per spec but still count as wire traffic, so the client
/// treats any received chunk as liveness.</para>
/// </summary>
public sealed class SseFrameParser
{
    private readonly StringBuilder _buffer = new();
    private readonly List<string> _dataLines = new();
    private string? _event;
    private string? _id;
    private long? _retry;
    private bool _hasField;

    /// <summary>
    /// True when the most recent <see cref="Feed"/> consumed at least one comment line (a leading
    /// <c>:</c>, the server's keep-alive heartbeat shape). Such lines complete no frame but are
    /// still wire traffic, so the client treats them as liveness that re-arms the freshness window.
    /// </summary>
    public bool LastFeedHadComment { get; private set; }

    /// <summary>Feeds a raw text <paramref name="chunk"/> and returns any frames completed by it.</summary>
    public IReadOnlyList<SseFrame> Feed(string chunk)
    {
        ArgumentNullException.ThrowIfNull(chunk);
        LastFeedHadComment = false;
        _buffer.Append(chunk);
        var frames = new List<SseFrame>();

        while (true)
        {
            int newline = IndexOf(_buffer, '\n');
            if (newline < 0)
            {
                break;
            }

            string line = _buffer.ToString(0, newline);
            _buffer.Remove(0, newline + 1);
            if (line.EndsWith('\r'))
            {
                line = line[..^1];
            }

            if (line.Length == 0)
            {
                var frame = BuildFrame();
                if (frame is not null)
                {
                    frames.Add(frame);
                }

                ResetFrame();
            }
            else
            {
                ParseLine(line);
            }
        }

        return frames;
    }

    private void ParseLine(string line)
    {
        // A leading colon marks a comment / heartbeat keep-alive line: ignore per spec, but flag
        // it so the client can treat the keep-alive as liveness.
        if (line[0] == ':')
        {
            LastFeedHadComment = true;
            return;
        }

        int colon = line.IndexOf(':', StringComparison.Ordinal);
        string field;
        string value;
        if (colon < 0)
        {
            field = line;
            value = string.Empty;
        }
        else
        {
            field = line[..colon];
            value = line[(colon + 1)..];
            if (value.StartsWith(' '))
            {
                value = value[1..];
            }
        }

        _hasField = true;
        switch (field)
        {
            case "event":
                _event = value;
                break;
            case "data":
                _dataLines.Add(value);
                break;
            case "id":
                _id = value;
                break;
            case "retry":
                if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out long retry))
                {
                    _retry = retry;
                }

                break;
        }
    }

    private SseFrame? BuildFrame()
    {
        if (!_hasField)
        {
            return null;
        }

        return new SseFrame(_event, string.Join('\n', _dataLines), _id, _retry);
    }

    private void ResetFrame()
    {
        _event = null;
        _dataLines.Clear();
        _id = null;
        _retry = null;
        _hasField = false;
    }

    private static int IndexOf(StringBuilder builder, char value)
    {
        for (int i = 0; i < builder.Length; i++)
        {
            if (builder[i] == value)
            {
                return i;
            }
        }

        return -1;
    }
}
