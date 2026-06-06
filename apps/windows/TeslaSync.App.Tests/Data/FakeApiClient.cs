using TeslaSync.App.Core.Data.Net;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// A test <see cref="IApiClient"/> that returns scripted results (values or thrown
/// exceptions) without any HTTP, so the cache-then-network engine and repositories can
/// be exercised deterministically. Records the requests it received.
/// </summary>
internal sealed class FakeApiClient : IApiClient
{
    private readonly Queue<Func<object?>> _responses = new();

    public List<ApiRequest> Requests { get; } = new();

    public FakeApiClient ReturnsValue<T>(T value)
    {
        _responses.Enqueue(() => value);
        return this;
    }

    public FakeApiClient Throws(Exception exception)
    {
        _responses.Enqueue(() => throw exception);
        return this;
    }

    public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
        GeneratedApi.ApiEndpoints.All.First(e => e.OperationId == operationId);

    public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Requests.Add(request);
        if (_responses.Count == 0)
        {
            throw new InvalidOperationException("FakeApiClient received an unexpected request.");
        }

        var value = _responses.Dequeue()();
        return Task.FromResult((T)value!);
    }
}
