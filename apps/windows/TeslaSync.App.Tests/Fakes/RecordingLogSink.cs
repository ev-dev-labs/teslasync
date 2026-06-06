using System.Collections.Concurrent;

namespace TeslaSync.App.Tests.Fakes;

/// <summary>
/// A thread-safe capturing logger for the <c>Action&lt;string&gt;</c> diagnostics sink the Core push,
/// SSE and notification layers emit through. Lets a test assert what was logged (and that secrets
/// were redacted before they reached the sink) without a real logging backend. Reusable across the
/// W9 suite as the canonical logger seam.
/// </summary>
internal sealed class RecordingLogSink
{
    private readonly ConcurrentQueue<string> _messages = new();

    /// <summary>The sink to hand to a component under test.</summary>
    public Action<string> Sink => _messages.Enqueue;

    /// <summary>Every message captured so far, in arrival order.</summary>
    public IReadOnlyList<string> Messages => _messages.ToArray();

    /// <summary>The number of captured messages.</summary>
    public int Count => _messages.Count;

    /// <summary>Whether any captured message contains <paramref name="substring"/> (ordinal).</summary>
    public bool Contains(string substring) =>
        _messages.Any(m => m.Contains(substring, StringComparison.Ordinal));

    /// <summary>Drops all captured messages.</summary>
    public void Clear()
    {
        while (_messages.TryDequeue(out _))
        {
        }
    }
}
