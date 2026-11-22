// Package personal defines the ownership boundary for optional personal features.
package personal

// OpenSubject cannot be supplied as a valid HTTP header value, so it cannot
// collide with a forwarded identity or existing authenticated-user data.
const OpenSubject = "\x1fteslasync:shared-open"
