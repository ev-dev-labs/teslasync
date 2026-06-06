using System.Net;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using Xunit;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// Verifies the resilience handler: it retries retryable statuses, gives up after the
/// configured budget, and short-circuits once the breaker is open. Delay is a no-op so
/// the tests run without waiting.
/// </summary>
public sealed class ResilienceHandlerTests
{
    private static HttpClient Build(FakeHttpMessageHandler inner, RetryPolicy retry, CircuitBreaker breaker)
    {
        var handler = new ResilienceHandler(retry, breaker, (_, _) => Task.CompletedTask)
        {
            InnerHandler = inner,
        };
        return new HttpClient(handler) { BaseAddress = new Uri("https://teslasync.local") };
    }

    [Fact]
    public async Task Retries_a_503_then_succeeds()
    {
        var inner = new FakeHttpMessageHandler();
        inner.EnqueueStatus(HttpStatusCode.ServiceUnavailable);
        inner.EnqueueStatus(HttpStatusCode.OK);
        var http = Build(inner, new RetryPolicy { MaxRetries = 2 }, new CircuitBreaker());

        var response = await http.GetAsync("/x");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, inner.SendCount);
    }

    [Fact]
    public async Task Stops_after_the_retry_budget()
    {
        var inner = new FakeHttpMessageHandler();
        inner.EnqueueStatus(HttpStatusCode.ServiceUnavailable);
        inner.EnqueueStatus(HttpStatusCode.ServiceUnavailable);
        var http = Build(inner, new RetryPolicy { MaxRetries = 1 }, new CircuitBreaker(failureThreshold: 99));

        var response = await http.GetAsync("/x");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal(2, inner.SendCount);
    }

    [Fact]
    public async Task Open_circuit_short_circuits_with_503()
    {
        var inner = new FakeHttpMessageHandler();
        inner.EnqueueStatus(HttpStatusCode.InternalServerError);
        var http = Build(inner, new RetryPolicy { MaxRetries = 0 }, new CircuitBreaker(failureThreshold: 1));

        // First call trips the breaker (one 500, no retries).
        var first = await http.GetAsync("/x");
        Assert.Equal(HttpStatusCode.InternalServerError, first.StatusCode);

        // Second call is rejected by the open breaker before reaching the inner handler.
        var ex = await Assert.ThrowsAsync<ApiException>(async () => await http.GetAsync("/x"));
        Assert.Equal(503, ex.StatusCode);
        Assert.Equal(1, inner.SendCount);
    }
}
