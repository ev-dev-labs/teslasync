namespace TeslaSync.App.Core.Push;

/// <summary>
/// Surfaces raw foreground push payloads to the app (P2/W6-0002). The Windows implementation raises
/// this from the WNS channel's <c>PushReceived</c> event (raw notifications delivered while the app
/// is running); the <c>PushSessionController</c> decodes each payload with
/// <see cref="PushPayloadParser"/> and routes it through <see cref="IForegroundPushRouter"/> — no
/// background SSE stream is held open for notifications (ADR-009).
///
/// <para>The event argument is the raw notification body exactly as delivered; consumers must treat
/// it as untrusted and never log it verbatim.</para>
/// </summary>
public interface IForegroundPushReceiver
{
    /// <summary>Raised on the arrival of a raw foreground push payload (the raw notification body).</summary>
    event EventHandler<string>? PayloadReceived;
}
