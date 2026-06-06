using TeslaSync.App.Core.Push;
using Xunit;

namespace TeslaSync.App.Tests.Push;

/// <summary>Verifies the bounded, newest-first <see cref="NotificationInbox"/>.</summary>
public sealed class NotificationInboxTests
{
    [Fact]
    public async Task IngestAsync_adds_newest_first_and_raises_changed()
    {
        var inbox = new NotificationInbox();
        int changes = 0;
        inbox.Changed += (_, _) => changes++;

        await inbox.IngestAsync(new PushPayload("a", "First", null, null, PushPayload.Unknown.Data));
        await inbox.IngestAsync(new PushPayload("b", "Second", null, null, PushPayload.Unknown.Data));

        Assert.Equal(2, changes);
        Assert.Equal("b", inbox.Recent[0].Kind);
        Assert.Equal("a", inbox.Recent[1].Kind);
    }

    [Fact]
    public async Task IngestAsync_is_bounded_to_capacity()
    {
        var inbox = new NotificationInbox(capacity: 2);

        for (int i = 0; i < 5; i++)
        {
            await inbox.IngestAsync(new PushPayload($"k{i}", null, null, null, PushPayload.Unknown.Data));
        }

        Assert.Equal(2, inbox.Recent.Count);
        Assert.Equal("k4", inbox.Recent[0].Kind);
        Assert.Equal("k3", inbox.Recent[1].Kind);
    }
}
