using TeslaSync.App.Core.Data.State;
using Xunit;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// Verifies the repository state types: the <see cref="RepositoryResult{T}"/> factories
/// set the right status/flags and <see cref="RepositoryResult{T}.ToLoadState"/> projects
/// onto the exhaustive <see cref="LoadState{T}"/> union the W7 pages bind to.
/// </summary>
public sealed class RepositoryStateTests
{
    [Fact]
    public void Factories_set_expected_status_and_flags()
    {
        var at = DateTimeOffset.UtcNow;
        Assert.Equal(LoadStatus.Loading, RepositoryResult<int>.Loading().Status);
        Assert.True(RepositoryResult<int>.Cached(1, at, stale: true).IsStale);
        Assert.True(RepositoryResult<int>.Refreshing(1, at, false).IsLoading);
        Assert.Equal(LoadStatus.Loaded, RepositoryResult<int>.Loaded(1, at).Status);
        Assert.False(RepositoryResult<string>.Empty().HasValue);
        Assert.Equal(LoadStatus.Error, RepositoryResult<int>.Failure(new RepositoryError(RepositoryErrorKind.Server, "x")).Status);

        var offline = RepositoryResult<int>.OfflineCached(9, at, new RepositoryError(RepositoryErrorKind.Network, "x"));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.HasValue);
        Assert.True(offline.IsStale);
    }

    [Fact]
    public void ToLoadState_maps_each_status_to_its_union_case()
    {
        var at = DateTimeOffset.UtcNow;
        var err = new RepositoryError(RepositoryErrorKind.Unauthorized, "x");

        Assert.IsType<LoadState<int>.Loading>(RepositoryResult<int>.Loading().ToLoadState());
        Assert.IsType<LoadState<int>.Cached>(RepositoryResult<int>.Cached(1, at, false).ToLoadState());
        Assert.IsType<LoadState<int>.Refreshing>(RepositoryResult<int>.Refreshing(1, at, false).ToLoadState());
        Assert.IsType<LoadState<int>.Loaded>(RepositoryResult<int>.Loaded(1, at).ToLoadState());
        Assert.IsType<LoadState<int>.Empty>(RepositoryResult<int>.Empty().ToLoadState());
        Assert.IsType<LoadState<int>.Offline>(RepositoryResult<int>.OfflineCached(1, at, err).ToLoadState());
        Assert.IsType<LoadState<int>.Error>(RepositoryResult<int>.Failure(err).ToLoadState());
    }

    [Fact]
    public void ValueOrDefault_returns_the_carried_value_or_default()
    {
        var at = DateTimeOffset.UtcNow;
        Assert.Equal(5, RepositoryResult<int>.Loaded(5, at).ToLoadState().ValueOrDefault);
        Assert.Equal(0, RepositoryResult<int>.Loading().ToLoadState().ValueOrDefault);
    }

    [Fact]
    public void Error_kinds_drive_retry_and_reauth_flags()
    {
        Assert.True(new RepositoryError(RepositoryErrorKind.Server, "x").IsRetryable);
        Assert.True(new RepositoryError(RepositoryErrorKind.RateLimited, "x").IsRetryable);
        Assert.True(new RepositoryError(RepositoryErrorKind.Unauthorized, "x").RequiresReauth);
        Assert.False(new RepositoryError(RepositoryErrorKind.NotFound, "x").IsRetryable);
    }
}
