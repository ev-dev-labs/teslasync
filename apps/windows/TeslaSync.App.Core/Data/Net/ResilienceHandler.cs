using TeslaSync.App.Core.Data.Behavior;

namespace TeslaSync.App.Core.Data.Net;

/// <summary>
/// A <see cref="DelegatingHandler"/> that centralizes the retry/backoff and circuit
/// policy for every API request. It sits outermost in the pipeline (above the W4 auth
/// handler), so a retried request re-runs auth and re-attaches a fresh token. Retries
/// fire on transient transport faults and 429/5xx responses per <see cref="RetryPolicy"/>;
/// the <see cref="CircuitBreaker"/> short-circuits once the API is persistently failing.
/// The delay function is injectable so tests run without real waiting.
/// </summary>
public sealed class ResilienceHandler : DelegatingHandler
{
    private readonly RetryPolicy _retry;
    private readonly CircuitBreaker _breaker;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;

    /// <summary>Creates the handler with explicit policy, breaker and delay (for tests).</summary>
    public ResilienceHandler(
        RetryPolicy retry,
        CircuitBreaker breaker,
        Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        ArgumentNullException.ThrowIfNull(retry);
        ArgumentNullException.ThrowIfNull(breaker);
        _retry = retry;
        _breaker = breaker;
        _delay = delay ?? Task.Delay;
    }

    /// <inheritdoc />
    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        for (var attempt = 0; ; attempt++)
        {
            if (!_breaker.Allow())
            {
                throw new ApiException("The service is temporarily unavailable (circuit open).", 503);
            }

            try
            {
                var response = await base.SendAsync(request, cancellationToken).ConfigureAwait(false);
                var status = (int)response.StatusCode;
                if (response.IsSuccessStatusCode)
                {
                    _breaker.RecordSuccess();
                    return response;
                }

                _breaker.RecordFailure();
                if (attempt < _retry.MaxRetries && RetryPolicy.IsRetryableStatus(status))
                {
                    response.Dispose();
                    await _delay(_retry.GetDelay(attempt + 1), cancellationToken).ConfigureAwait(false);
                    continue;
                }

                return response;
            }
            catch (Exception ex) when (ex is not OperationCanceledException && RetryPolicy.IsRetryableException(ex))
            {
                _breaker.RecordFailure();
                if (attempt >= _retry.MaxRetries)
                {
                    throw;
                }

                await _delay(_retry.GetDelay(attempt + 1), cancellationToken).ConfigureAwait(false);
            }
        }
    }
}
