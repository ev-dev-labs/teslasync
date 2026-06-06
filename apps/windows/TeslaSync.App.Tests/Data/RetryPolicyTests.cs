using TeslaSync.App.Core.Data.Behavior;
using Xunit;

namespace TeslaSync.App.Tests.Data;

/// <summary>Verifies the deterministic backoff schedule and retryability predicates.</summary>
public sealed class RetryPolicyTests
{
    [Theory]
    [InlineData(1, 200)]
    [InlineData(2, 400)]
    [InlineData(3, 800)]
    public void GetDelay_doubles_each_attempt(int attempt, int expectedMs)
    {
        var policy = new RetryPolicy { BaseDelay = TimeSpan.FromMilliseconds(200), MaxDelay = TimeSpan.FromSeconds(5) };
        Assert.Equal(expectedMs, policy.GetDelay(attempt).TotalMilliseconds, 3);
    }

    [Fact]
    public void GetDelay_is_capped_at_max_delay()
    {
        var policy = new RetryPolicy { BaseDelay = TimeSpan.FromSeconds(1), MaxDelay = TimeSpan.FromSeconds(5) };
        Assert.Equal(TimeSpan.FromSeconds(5), policy.GetDelay(20));
    }

    [Fact]
    public void GetDelay_below_one_is_zero()
    {
        Assert.Equal(TimeSpan.Zero, RetryPolicy.Default.GetDelay(0));
    }

    [Theory]
    [InlineData(429, true)]
    [InlineData(500, true)]
    [InlineData(503, true)]
    [InlineData(400, false)]
    [InlineData(404, false)]
    [InlineData(200, false)]
    public void IsRetryableStatus_matches_429_and_5xx(int status, bool expected)
    {
        Assert.Equal(expected, RetryPolicy.IsRetryableStatus(status));
    }

    [Fact]
    public void IsRetryableException_classifies_transport_faults()
    {
        Assert.True(RetryPolicy.IsRetryableException(new HttpRequestException("x")));
        Assert.True(RetryPolicy.IsRetryableException(new IOException("x")));
        Assert.True(RetryPolicy.IsRetryableException(new TaskCanceledException("timeout", new TimeoutException())));
        Assert.False(RetryPolicy.IsRetryableException(new InvalidOperationException("x")));
    }
}
