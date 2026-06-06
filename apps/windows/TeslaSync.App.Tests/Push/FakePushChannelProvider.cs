using TeslaSync.App.Core.Push;

namespace TeslaSync.App.Tests.Push;

/// <summary>
/// A scriptable <see cref="IPushChannelProvider"/> + <see cref="IForegroundPushReceiver"/> for the
/// push tests. Each <see cref="CreateChannelAsync"/> dequeues the next scripted outcome (a channel or
/// a <see cref="PushChannelUnavailableException"/>); <see cref="CloseChannelAsync"/> and creation are
/// counted, and <see cref="RaisePayload"/> drives the foreground receiver path.
/// </summary>
internal sealed class FakePushChannelProvider : IPushChannelProvider, IForegroundPushReceiver
{
    private readonly Queue<Func<PushChannel>> _outcomes = new();

    public int CreateCount { get; private set; }

    public int CloseCount { get; private set; }

    public event EventHandler<string>? PayloadReceived;

    public FakePushChannelProvider EnqueueChannel(string uri, DateTimeOffset expiresAt)
    {
        _outcomes.Enqueue(() => new PushChannel(uri, expiresAt));
        return this;
    }

    public FakePushChannelProvider EnqueueUnavailable()
    {
        _outcomes.Enqueue(() => throw new PushChannelUnavailableException("test: no channel"));
        return this;
    }

    public Task<PushChannel> CreateChannelAsync(CancellationToken cancellationToken = default)
    {
        CreateCount++;
        if (_outcomes.Count == 0)
        {
            throw new InvalidOperationException("FakePushChannelProvider has no scripted channel.");
        }

        return Task.FromResult(_outcomes.Dequeue()());
    }

    public Task CloseChannelAsync(CancellationToken cancellationToken = default)
    {
        CloseCount++;
        return Task.CompletedTask;
    }

    public void RaisePayload(string raw) => PayloadReceived?.Invoke(this, raw);
}
