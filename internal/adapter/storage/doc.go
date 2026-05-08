// Package storage implements blob/object storage adapters (S3, Azure, local FS). implements outbound adapters for the declared ports.
//
// Layer: adapter
// Layering: implements storage interfaces; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package storage
