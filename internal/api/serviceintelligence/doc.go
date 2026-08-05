// Package serviceintelligence serves recall and service-intelligence
// hypotheses for a server-resolved vehicle.
//
// The package is intentionally split at narrow ports: the service owns
// applicability and symptom-ranking rules, while NHTSA and signal storage are
// replaceable adapters. HTTP handlers only validate, trace, log at the
// authenticated boundary, and map errors.
//
// Layer: handler
package serviceintelligence
