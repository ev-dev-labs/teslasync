using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using Xunit;

namespace TeslaSync.App.Tests.Data;

/// <summary>Verifies that transport/HTTP faults map to the right <see cref="RepositoryError"/>.</summary>
public sealed class ApiErrorMapperTests
{
    [Theory]
    [InlineData(401, RepositoryErrorKind.Unauthorized)]
    [InlineData(403, RepositoryErrorKind.Unauthorized)]
    [InlineData(404, RepositoryErrorKind.NotFound)]
    [InlineData(408, RepositoryErrorKind.Network)]
    [InlineData(429, RepositoryErrorKind.RateLimited)]
    [InlineData(500, RepositoryErrorKind.Server)]
    [InlineData(503, RepositoryErrorKind.Server)]
    public void Maps_api_exception_status_to_kind(int status, RepositoryErrorKind expected)
    {
        var error = ApiErrorMapper.Map(new ApiException("x", status, errorCode: "E"));
        Assert.Equal(expected, error.Kind);
        Assert.Equal(status, error.StatusCode);
        Assert.Equal("E", error.Code);
    }

    [Fact]
    public void Maps_transport_and_cancellation_exceptions()
    {
        Assert.Equal(RepositoryErrorKind.Network, ApiErrorMapper.Map(new HttpRequestException("x")).Kind);
        Assert.Equal(RepositoryErrorKind.Network, ApiErrorMapper.Map(new IOException("x")).Kind);
        Assert.Equal(RepositoryErrorKind.Canceled, ApiErrorMapper.Map(new OperationCanceledException()).Kind);
        Assert.Equal(RepositoryErrorKind.Decoding, ApiErrorMapper.Map(new System.Text.Json.JsonException("x")).Kind);
        Assert.Equal(RepositoryErrorKind.Unknown, ApiErrorMapper.Map(new InvalidOperationException("x")).Kind);
    }

    [Fact]
    public void Unauthorized_requires_reauth_and_server_is_retryable()
    {
        Assert.True(ApiErrorMapper.FromStatus(401, null, null).RequiresReauth);
        Assert.True(ApiErrorMapper.FromStatus(503, null, null).IsRetryable);
        Assert.False(ApiErrorMapper.FromStatus(404, null, null).IsRetryable);
    }
}
