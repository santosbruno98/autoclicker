package services

import (
	"sync"
	"time"
)

type cacheEntry[T any] struct {
	value     T
	expiresAt time.Time
}

type ttlCache[T any] struct {
	mu    sync.RWMutex
	items map[string]cacheEntry[T]
}

func newTTLCache[T any]() *ttlCache[T] {
	return &ttlCache[T]{items: make(map[string]cacheEntry[T])}
}

func (c *ttlCache[T]) get(key string) (T, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	entry, ok := c.items[key]
	if !ok || time.Now().After(entry.expiresAt) {
		var zero T
		return zero, false
	}
	return entry.value, true
}

func (c *ttlCache[T]) set(key string, value T, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = cacheEntry[T]{value: value, expiresAt: time.Now().Add(ttl)}
}

var (
	quoteCache    = newTTLCache[Quote]()
	fxCache       = newTTLCache[float64]()
	intradayCache = newTTLCache[[]OHLCPoint]()
)

const (
	quoteCacheTTL    = time.Minute * 12
	fxCacheTTL       = time.Minute * 5
	intradayCacheTTL = time.Second * 30
)
