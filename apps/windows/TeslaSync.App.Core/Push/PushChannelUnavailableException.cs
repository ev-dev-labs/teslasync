namespace TeslaSync.App.Core.Push;

/// <summary>
/// Raised by an <see cref="IPushChannelProvider"/> when a WNS channel cannot be created in the
/// current environment — most commonly because the process has no MSIX package identity (an
/// unpackaged dev run) or the machine has no WNS connectivity. The registration service treats this
/// as the documented "live WNS integration unavailable" condition (P2/W6-0002 gate note): it parks
/// registration in <see cref="PushRegistrationState.Failed"/> rather than crashing the app.
/// </summary>
public sealed class PushChannelUnavailableException : Exception
{
    /// <summary>Creates the exception with a human-readable, PII-free <paramref name="reason"/>.</summary>
    public PushChannelUnavailableException(string reason)
        : base(reason)
    {
    }

    /// <summary>Creates the exception wrapping the originating platform failure.</summary>
    public PushChannelUnavailableException(string reason, Exception innerException)
        : base(reason, innerException)
    {
    }
}
