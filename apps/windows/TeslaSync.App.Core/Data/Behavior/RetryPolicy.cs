namespace TeslaSync.App.Core.Data.Behavior;

/// <summary>
/// Deterministic exponential-backoff retry policy for transient API failures. The
/// schedule is jitter-free so it can be unit-tested row-for-row: the delay before the
/// n-th retry (1-based) is <c>min(MaxDelay, BaseDelay × 2^(n-1))</c>. Retryability is
/// decided by HTTP status (429 / 5xx) or transport exception, never by response body.
/// </summary>
public sealed class RetryPolicy
{
    /// <summary>The default policy: 3 retries, 200 ms base, capped at 5 s.</summary>
    public static readonly RetryPolicy Default = new();

    /// <summary>Maximum number of retries after the initial attempt.</summary>
    public int MaxRetries { get; init; } = 3;

    /// <summary>The base backoff delay used for the first retry.</summary>
    public TimeSpan BaseDelay { get; init; } = TimeSpan.FromMilliseconds(200);

    /// <summary>The ceiling applied to every computed delay.</summary>
    public TimeSpan MaxDelay { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>The deterministic delay before retry number <paramref name="attempt"/> (1-based).</summary>
    public TimeSpan GetDelay(int attempt)
    {
        if (attempt < 1)
        {
            return TimeSpan.Zero;
        }

        // Compute in ticks with a guard so the shift cannot overflow.
        var factor = attempt - 1 >= 30 ? long.MaxValue : 1L << (attempt - 1);
        var ticks = BaseDelay.Ticks <= 0 || factor > long.MaxValue / Math.Max(1, BaseDelay.Ticks)
            ? MaxDelay.Ticks
            : BaseDelay.Ticks * factor;
        return TimeSpan.FromTicks(Math.Min(ticks, MaxDelay.Ticks));
    }

    /// <summary>True when an HTTP status warrants a retry (429 Too Many Requests or any 5xx).</summary>
    public static bool IsRetryableStatus(int statusCode) =>
        statusCode == 429 || (statusCode >= 500 && statusCode <= 599);

    /// <summary>True when a thrown exception represents a retryable transport fault.</summary>
    public static bool IsRetryableException(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);

        // A genuine cancellation is never retried; a timeout (TaskCanceledException
        // with no user token cancellation) surfaces as a transport fault upstream.
        return exception is HttpRequestException
            || exception is IOException
            || (exception is TaskCanceledException tce && tce.InnerException is TimeoutException);
    }
}
