package websocket

import (
	enginev1 "autoclicker/gen/go"
	"context"
	"crypto/tls"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"
)

// This file manages the websocket connection lifecycle

// open

// close

// handler

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 512 * 1024 // 512KB

)

type Client struct {
	url     string
	outChan chan<- *enginev1.MarketTick

	mu          sync.Mutex
	conn        *websocket.Conn
	isConnected bool

	ctx    context.Context
	cancel context.CancelFunc
}

func NewDefaultDialer() *websocket.Dialer {
	return &websocket.Dialer{
		Proxy: http.ProxyFromEnvironment,
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: false, // false for secure tls verification
		},
		HandshakeTimeout: 10 * time.Second,
	}
}

func NewClient(parentCtx context.Context, url string, outChan chan<- *enginev1.MarketTick) *Client {
	ctx, cancel := context.WithCancel(parentCtx)
	return &Client{
		url:     url,
		conn:    nil,
		outChan: outChan,
		ctx:     ctx,
		cancel:  cancel,
	}
}

func (c *Client) Start() {
	backoff := 1 * time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-c.ctx.Done():
			// TODO: Send this to the logger service...
			log.Println("[Websocket] Service context cancelled. Stopping client loop...")
			return
		default:

		}

		log.Println("[Websocket] connected to &s...", c.url)
		err := c.connect()
		if err != nil {
			log.Println("[Websocket] failed to connect to &s. Retrying in %s...", c.url, backoff)
			select {
			case <-c.ctx.Done():
				return
			case <-time.After(backoff):
			}
		}
		// exponential backoff
		backoff = backoff * 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
		continue
	}
}

func (c *Client) connect() error {
	dialer := NewDefaultDialer()
	conn, _, err := dialer.DialContext(c.ctx, c.url, nil)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.conn = conn
	c.isConnected = true
	c.mu.Unlock()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	log.Println("[Websocket] connnection sucessefull connected!")
	return nil
}

func (c *Client) readPump() {
	defer func() {
		c.Close()
	}()

	// coroutine that sends periodic pings to the server
	go c.pingPump()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WebSocket] Unexpected close error: %v", err)
			} else {
				log.Printf("[WebSocket] Read loop exited: %v", err)
			}
			break
		}

		// Desiralize raw message bytes into *enginev1.MarketTick struct
		var decodedMessage enginev1.MarketTick
		err = proto.Unmarshal(message, &decodedMessage)
		if err != nil {
			log.Printf("[WebSocket] Failed to decode message: %v", err)
			continue
		}

		tick := &enginev1.MarketTick{
			Symbol:     decodedMessage.Symbol,
			Price:      decodedMessage.Price,
			Volume:     decodedMessage.Volume,
			BidPrice:   decodedMessage.BidPrice,
			AskPrice:   decodedMessage.AskPrice,
			Timestamp:  decodedMessage.Timestamp,
			SequenceId: decodedMessage.SequenceId,
		}
		c.dispatchTick(tick)
	}
}

func (c *Client) pingPump() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			if !c.isConnected {
				return
			}
			c.mu.Lock()
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			err := c.conn.WriteMessage(websocket.PingMessage, nil)
			c.mu.Unlock()

			if err != nil {
				log.Println("[WebSocket] Failed to write ping message:", err)
				return
			}
		}
	}
}

func (c *Client) dispatchTick(tick *enginev1.MarketTick) {
	select {
	case <-c.ctx.Done():
		return
	case c.outChan <- tick:
		// todo: publish to go engine pipeline
	default:
		log.Println("[Websocket] WARNING: outChan buffer full! Dropping tick to prevent deadlock.")
	}
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.isConnected || c.conn == nil {
		return nil
	}

	c.isConnected = false
	c.cancel()

	// send close frame
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	_ = c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))

	return c.conn.Close()
}

func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.isConnected
}

func (c *Client) setConnected(state bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.isConnected = state
}
