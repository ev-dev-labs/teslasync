package config

import "time"

// Centralized timing constants. Change here → applies everywhere.
const (
	// HTTP
	HTTPClientTimeout = 10 * time.Second
	HTTPWriteTimeout  = 30 * time.Second

	// Auth
	AuthCacheTTL        = 5 * time.Minute
	AuthRefreshInterval = 30 * time.Minute

	// MQTT
	MQTTKeepAlive    = 30 * time.Second
	MQTTReconnectMax = 60 * time.Second

	// Signal pipeline
	SignalFlushInterval    = 2 * time.Second
	SignalFlushTimeout     = 10 * time.Second
	LiveStateFlushNormal   = 1 * time.Second
	LiveStateFlushDegraded = 5 * time.Second

	// Cache
	MemCacheCleanup = 60 * time.Second

	// Circuit breaker
	CBFailureThreshold = 5
	CBResetTimeout     = 30 * time.Second
)
