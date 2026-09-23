package grpc

import (
	enginev1 "autoclicker/gen/go"
	"context"
	"io"
	"log"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type StreamClient struct {
	target 			string
	conn   			*grpc.ClientConn
	client 			enginev1.SignalPredictorServiceClient

	tickChan   		<-chan *enginev1.MarketTick     // <- means that the channel is read only Inbound channel
	signalChan 		chan<- *enginev1.SignalResponse // Outbound channel feed for Worker

	mu          	sync.Mutex
	isConnected 	bool

	ctx    			context.Context
	cancel 			context.CancelFunc
}

func NewStreamClient(parentCtx context.Context, target string, tickChan <-chan *enginev1.MarketTick, 
		signalChan chan<- *enginev1.SignalResponse) *StreamClient {
	ctx, cancel := context.WithCancel(parentCtx)
	return &StreamClient{
		target:   target,
		tickChan: tickChan,
		signalChan: signalChan,
		ctx:      ctx,
		cancel:   cancel,
	}
}

// start manages the connection lifecycle and streaming pumps
func (s *StreamClient) Start() {
	backoff := 1 * time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-s.ctx.Done():
			log.Println("[StreamClient] Service context cancelled. Stopping client loop...")
			return
		default:
			// TODO: shouldn't this do something??
		}

		log.Println("[StreamClient] connected to Python ML worker at &s...", s.target)
		err := s.connectAndStream()
		if err != nil {
			log.Println("[StreamClient] failed to connect to &s. Retrying in %s...", s.target, backoff)
			select {
			case <-s.ctx.Done():
				return
			case <-time.After(backoff):
			}

			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
			continue
		}
		backoff = 1 * time.Second
	}
}

func (s *StreamClient) connectAndStream() error {
	// connect to the grpc Server
	conn, err := grpc.NewClient(
		s.target,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return err
	}

	defer conn.Close()

	s.conn = conn
	s.client = enginev1.NewSignalPredictorServiceClient(conn)

	streamCtx, streamCancel := context.WithCancel(s.ctx)
	defer streamCancel()

	stream, err := s.client.LiveSignalPipeline(streamCtx)
	if err != nil {
		return err
	}

	s.SetConnected(true)
	log.Println("[gRPC] Sucessefully estabilished LiveSignalPipeline stream.")

	var wg sync.WaitGroup
	wg.Add(2)

	// Launch two goroutines to read from the stream and write to the tick channel
	go func() {
		defer wg.Done()
		s.writePump(stream, streamCancel)
	}()

	go func() {
		defer wg.Done()
		s.readPump(stream, streamCancel)
	}()

	wg.Wait()
	s.SetConnected(false)
	return nil
}

func (s *StreamClient) writePump(stream enginev1.SignalPredictorService_LiveSignalPipelineClient, 
			cancel context.CancelFunc) {
	defer cancel()

	for {
		select {
		case <-s.ctx.Done():
			_ = stream.CloseSend()
			return
		case tick, ok := <-s.tickChan:
			if !ok {
				log.Println("[gRPC WritePump] tickChan closed.")
				_ = stream.CloseSend()
				return
			}
			if err := stream.Send(tick); err != nil {
				log.Println("[gRPC WritePump] Error sending tick to Python ML worker...%v", err)
				return
			}
		}
	}
}

func (s *StreamClient) readPump(stream enginev1.SignalPredictorService_LiveSignalPipelineClient, cancel context.CancelFunc) {
	defer cancel()
	for {
		resp, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				log.Println("[gRPC ReadPump] Stream closed by Python ML worker.")
				return
			}
			log.Printf("[gRPC ReadPump] Error receiving signal from Python ML worker...%v", err)
			return
		}
		// Processes the signal
		select {
		case s.signalChan <- resp:
		default:
			log.Println("[gRPC ReadPump] WARNING: Signal queue full! Dropping gRPC signal to prevent blockage.")
			// TODO: this should be sent to another queue until the main is ready to process it
		}
	}
}

func (s *StreamClient) IsConnected() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isConnected
}

func (s *StreamClient) SetConnected(state bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.isConnected = state
}

func (s *StreamClient) Close() {
	s.cancel()
}
