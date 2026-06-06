using System.Collections.ObjectModel;

namespace TeslaSync.App.Core.Push;

/// <summary>An item ingested into the foreground notifications inbox from a push (P2/W6-0002).</summary>
public sealed record NotificationInboxItem(string Kind, string? Title, string? Body, string? Category, DateTimeOffset ReceivedAt);

/// <summary>
/// The foreground surface of the notifications repository that push updates without a background
/// stream (P2/W6-0002, ADR-009). When a foreground push arrives, the router ingests it here so the
/// in-app notifications state reflects it immediately; durable history still comes from the W5 REST
/// notifications endpoints. Implementations must be safe to call from a background thread.
/// </summary>
public interface INotificationInbox
{
    /// <summary>The most-recent ingested notifications, newest first (bounded).</summary>
    IReadOnlyList<NotificationInboxItem> Recent { get; }

    /// <summary>Raised after <see cref="IngestAsync"/> mutates the inbox.</summary>
    event EventHandler? Changed;

    /// <summary>Ingests a foreground push <paramref name="payload"/> into the inbox.</summary>
    Task IngestAsync(PushPayload payload, CancellationToken cancellationToken = default);
}

/// <summary>
/// The default in-memory <see cref="INotificationInbox"/>: a bounded, thread-safe, newest-first ring
/// of recently-received foreground notifications. It deliberately does not persist history — the W5
/// REST notifications repository remains the durable source — it only reflects live foreground push
/// so the UI updates without polling.
/// </summary>
public sealed class NotificationInbox : INotificationInbox
{
    private readonly object _gate = new();
    private readonly LinkedList<NotificationInboxItem> _items = new();
    private readonly int _capacity;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the inbox with an optional bounded <paramref name="capacity"/> and clock seam.</summary>
    public NotificationInbox(int capacity = 50, Func<DateTimeOffset>? clock = null)
    {
        _capacity = capacity > 0 ? capacity : 50;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<NotificationInboxItem> Recent
    {
        get
        {
            lock (_gate)
            {
                return new ReadOnlyCollection<NotificationInboxItem>(_items.ToArray());
            }
        }
    }

    /// <inheritdoc />
    public Task IngestAsync(PushPayload payload, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var item = new NotificationInboxItem(payload.Kind, payload.Title, payload.Body, payload.Category, _clock());
        lock (_gate)
        {
            _items.AddFirst(item);
            while (_items.Count > _capacity)
            {
                _items.RemoveLast();
            }
        }

        Changed?.Invoke(this, EventArgs.Empty);
        return Task.CompletedTask;
    }
}
