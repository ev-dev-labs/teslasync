package httputil

import (
	"context"
	"testing"
	"time"
)

func TestRateLimiter_AllowBurst(t *testing.T) {
	rl := NewRateLimiter(10, 3) // 10/s, burst of 3

	// Should allow 3 immediate requests (burst)
	for i := 0; i < 3; i++ {
		if !rl.Allow() {
			t.Errorf("Allow() should succeed for burst request %d", i+1)
		}
	}

	// 4th should fail (burst exhausted)
	if rl.Allow() {
		t.Error("Allow() should fail after burst exhausted")
	}
}

func TestRateLimiter_TokenRefill(t *testing.T) {
	rl := NewRateLimiter(100, 1) // 100/s, burst of 1

	// Use the single token
	if !rl.Allow() {
		t.Fatal("first Allow() should succeed")
	}
	if rl.Allow() {
		t.Fatal("second Allow() should fail immediately")
	}

	// Wait for refill (100/s = 10ms per token)
	time.Sleep(20 * time.Millisecond)

	if !rl.Allow() {
		t.Error("Allow() should succeed after token refill")
	}
}

func TestRateLimiter_Wait_Success(t *testing.T) {
	rl := NewRateLimiter(100, 1) // 100/s, burst of 1

	// Drain the token
	rl.Allow()

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	start := time.Now()
	err := rl.Wait(ctx)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("Wait() error: %v", err)
	}
	// Should have waited ~10ms (1 token at 100/s)
	if elapsed < 5*time.Millisecond {
		t.Errorf("Wait() returned too fast: %v", elapsed)
	}
}

func TestRateLimiter_Wait_ContextCancelled(t *testing.T) {
	rl := NewRateLimiter(0.1, 1) // very slow: 0.1/s

	// Drain the token
	rl.Allow()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := rl.Wait(ctx)
	if err == nil {
		t.Fatal("Wait() should fail on cancelled context")
	}
}

func TestRateLimiter_AllowReturnsFalseWhenExhausted(t *testing.T) {
	rl := NewRateLimiter(1, 2) // 1/s, burst of 2

	// Drain both burst tokens
	rl.Allow()
	rl.Allow()

	if rl.Allow() {
		t.Error("Allow() should return false when exhausted")
	}
}
