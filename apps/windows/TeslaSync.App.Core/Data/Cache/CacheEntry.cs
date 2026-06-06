namespace TeslaSync.App.Core.Data.Cache;

/// <summary>
/// One row of the offline cache: a serialized API payload keyed by a stable request
/// key and stamped with the time it was fetched. Carries no credential material.
/// </summary>
public sealed record CacheEntry(string Key, string Payload, DateTimeOffset FetchedAt);
