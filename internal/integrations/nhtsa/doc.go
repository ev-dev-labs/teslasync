// Package nhtsa implements bounded, typed adapters for documented NHTSA
// vehicle-safety APIs.
//
// The adapter intentionally keeps raw upstream JSON at the HTTP decode
// boundary. Only normalized typed values may enter its in-memory cache or
// cross into the service-intelligence use case.
//
// Layer: adapter
package nhtsa
