// Package sse hosts the Server-Sent Events fan-out hub and HTTP endpoint.
// Producers broadcast through this concrete hub while carved-out handlers depend on local interfaces.
//
// Layer: handler
package sse
