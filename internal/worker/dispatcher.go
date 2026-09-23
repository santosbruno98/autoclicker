package worker

import (
	enginev1 "autoclicker/gen/go"
	"context"
	"log"
	"sync"
	"time"
)

// The goal of this file is to prevent the main loop from blocking on the gRPC client when execution time takes longer than expected.

type Dispatcher struct {
	signalChan  <-chan *enginev1.SignalResponse
	workerCount int
	ctx         context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

func NewDispatcher(parentCtx context.Context, signalChan <-chan *enginev1.SignalResponse, workerCount int) *Dispatcher {
	ctx, cancel := context.WithCancel(parentCtx)
	return &Dispatcher{
		signalChan:  signalChan,
		workerCount: workerCount,
		ctx:         ctx,
		cancel:      cancel,
		wg:          sync.WaitGroup{},
	}
}

func (d *Dispatcher) Start() {
	log.Printf("[Worker Poll] Starting %d execution workers...", d.workerCount)
	for i := 0; i < d.workerCount; i++ {
		d.wg.Add(1)
		go d.worker(i)
	}
}

func (d *Dispatcher) worker(workerID int) {
	defer d.wg.Done()
	log.Println("[Worker Poll] Ready for incoming trade signals", workerID)
	for {
		select {
		case <-d.ctx.Done():
			log.Printf("[Worker Poll] Worker %d exiting...", workerID)
			return
		case signal, ok := <-d.signalChan:
			if !ok {
				log.Printf("[Worker Poll] Worker %d exiting...", workerID)
				return
			}
			log.Printf("[Worker Poll] Worker %d received signal %s...", workerID, signal.GetSymbol())
			// Processes the signal
			d.executeSignal(workerID, signal)
		}
	}
}

func (d *Dispatcher) executeSignal(workerID int, signal *enginev1.SignalResponse) {
	// Skip hold or unknown signals
	if signal.GetSignalType() == enginev1.SignalType_SIGNAL_TYPE_HOLD || signal.GetSignalType() == enginev1.SignalType_SIGNAL_TYPE_UNSPECIFIED {
		log.Printf("[Worker Poll] Skipping signal %s...", signal.GetSymbol())
		return
	}
	start := time.Now()
	log.Printf("[Worker %d] 🚀 EXECUTION START | Symbol: %s | Signal Type: %s | Confidence Score: %.2f",
		workerID, signal.GetSymbol(), signal.GetSignalType(), signal.GetConfidenceScore())

	// Example simulation delay:
	//TODO: send to discord webhook to manually trigger the execution

	log.Printf("[Worker %d] ✅ EXECUTION COMPLETE | Symbol: %s | Duration: %v",
		workerID, signal.GetSymbol(), time.Since(start))
}

func (d *Dispatcher) Stop() {
	d.cancel()
	d.wg.Wait()
	log.Println("[Worker Poll] All workers stopped.")
}
