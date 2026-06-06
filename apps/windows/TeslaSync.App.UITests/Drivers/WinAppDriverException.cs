namespace TeslaSync.App.UITests.Drivers;

/// <summary>
/// Raised for every WinAppDriver protocol failure: an unreachable driver, a timed-out request, a
/// WebDriver error envelope, or a malformed response. Carries the raw WebDriver error keyword so
/// callers can distinguish an expected "no such element" miss from a genuine fault.
/// </summary>
public sealed class WinAppDriverException : Exception
{
    /// <summary>Create an exception with a message and the raw WebDriver error keyword.</summary>
    public WinAppDriverException(string message, string error = "")
        : base(message) => Error = error;

    /// <summary>Create an exception wrapping an underlying transport failure.</summary>
    public WinAppDriverException(string message, Exception innerException)
        : base(message, innerException) => Error = string.Empty;

    /// <summary>The WebDriver error keyword (e.g. <c>no such element</c>), or empty.</summary>
    public string Error { get; }

    /// <summary>True when the failure is specifically a "no such element" miss.</summary>
    public bool IsNoSuchElement =>
        Error.Equals("no such element", StringComparison.OrdinalIgnoreCase);
}
