package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	enginev1 "autoclicker/gen/go"
	"autoclicker/internal/grpc"
	"autoclicker/internal/websocket"
	"autoclicker/internal/worker"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	// Step 1 -> Step 2: Market Ticks Channel Buffer
	tickChan := make(chan *enginev1.MarketTick, 5000)

	// Step 2 -> Step 3: Trade Signals Channel Buffer
	signalChan := make(chan *enginev1.SignalResponse, 1000)

	// 1. Initialize Step 3 Execution Worker Pool (e.g., 5 concurrent execution workers)
	disp := worker.NewDispatcher(ctx, signalChan, 5)
	disp.Start()

	// 2. Initialize Step 1 WebSocket Ingestion Client
	wsClient := websocket.NewClient(
		ctx,
		"wss://stream.binance.com:9443/ws/btcusdt@trade",
		tickChan,
	)

	// 3. Initialize Step 2 gRPC Pipeline Client
	grpcClient := grpc.NewStreamClient(
		ctx,
		"localhost:50051",
		tickChan,
		signalChan,
	)

	// Start services in background
	go wsClient.Start()
	go grpcClient.Start()

	log.Println("[Engine] Engine fully started. Listening for live ticks and executing signals...")

	// Wait for OS shutdown signal (Ctrl+C)
	<-ctx.Done()

	log.Println("[Engine] Shutting down services gracefully...")
	wsClient.Close()
	grpcClient.Close()
	disp.Stop()
	log.Println("[Engine] Shutdown complete.")
}
