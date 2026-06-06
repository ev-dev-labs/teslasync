using TeslaSync.App.Core.Data.Behavior;
using Xunit;

namespace TeslaSync.App.Tests.Data;

/// <summary>Verifies the circuit breaker open/half-open/closed transitions via an injected clock.</summary>
public sealed class CircuitBreakerTests
{
    [Fact]
    public void Opens_after_the_failure_threshold()
    {
        var breaker = new CircuitBreaker(failureThreshold: 3, openDuration: TimeSpan.FromSeconds(30));

        breaker.RecordFailure();
        breaker.RecordFailure();
        Assert.True(breaker.Allow());
        Assert.Equal(CircuitState.Closed, breaker.State);

        breaker.RecordFailure();
        Assert.Equal(CircuitState.Open, breaker.State);
        Assert.False(breaker.Allow());
    }

    [Fact]
    public void Half_opens_after_the_cooldown_then_closes_on_success()
    {
        var now = new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var breaker = new CircuitBreaker(failureThreshold: 1, openDuration: TimeSpan.FromSeconds(30), clock: () => now);

        breaker.RecordFailure();
        Assert.Equal(CircuitState.Open, breaker.State);

        now = now.AddSeconds(31);
        Assert.Equal(CircuitState.HalfOpen, breaker.State);
        Assert.True(breaker.Allow());

        breaker.RecordSuccess();
        Assert.Equal(CircuitState.Closed, breaker.State);
    }

    [Fact]
    public void Failure_in_half_open_reopens_immediately()
    {
        var now = new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var breaker = new CircuitBreaker(failureThreshold: 2, openDuration: TimeSpan.FromSeconds(10), clock: () => now);

        breaker.RecordFailure();
        breaker.RecordFailure();
        now = now.AddSeconds(11);
        Assert.Equal(CircuitState.HalfOpen, breaker.State);

        breaker.RecordFailure();
        Assert.Equal(CircuitState.Open, breaker.State);
    }
}
