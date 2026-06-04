// Package config manages TeslaSync application configuration by loading
// values from environment variables with sensible defaults.
//
// The top-level [Config] struct embeds sub-configs for each subsystem:
// [DatabaseConfig] (PostgreSQL DSN, pool sizes), [TeslaConfig] (OAuth
// client ID/secret, Fleet API URLs), [MQTTConfig] (broker address,
// topic prefix), [WorkerConfig] (poll interval, sleep multiplier),
// [RedisConfig], [AuthConfig] (JWT), and [RetentionConfig] (data and
// position retention days). Call [Load] to populate from the environment.
// Layer: platform
package config
