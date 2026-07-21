package main

import (
	"flag"
	"fmt"
	"strings"
	"time"

	"github.com/go-vgo/robotgo"
)

func pressKey(key string) {
	k := strings.ToLower(key)

	switch k {
	case "shift":
		robotgo.KeyToggle("lshift", "down")
		time.Sleep(50 * time.Millisecond)
		robotgo.KeyToggle("lshift", "up")
	case "ctrl", "control":
		robotgo.KeyToggle("lctrl", "down")
		time.Sleep(50 * time.Millisecond)
		robotgo.KeyToggle("lctrl", "up")
	case "alt":
		robotgo.KeyToggle("lalt", "down")
		time.Sleep(50 * time.Millisecond)
		robotgo.KeyToggle("lalt", "up")
	default:
		robotgo.KeyTap(k)
	}
}

func main() {
	// Flags
	pidFlag := flag.Int("pid", 0, "Target Process ID (PID) of the window (REQUIRED)")
	keysFlag := flag.String("keys", "tab,1", "Comma-separated list of keys to press (e.g. 'tab,1')")
	keyDelayFlag := flag.Float64("key-delay", 0.5, "Delay in seconds between key presses (e.g. 0.5)")
	loopDelayFlag := flag.Float64("loop-delay", 1.5, "Delay in seconds at end of each loop (e.g. 1.5)")
	flag.Parse()

	// Check if PID is supplied
	if *pidFlag <= 0 {
		fmt.Println("Error: You must provide a valid PID using the -pid flag.")
		fmt.Println("Example usage: go run main.go -pid=12345 -keys=\"tab,1\" -key-delay=0.5 -loop-delay=1.5")
		return
	}

	targetPID := int32(*pidFlag)

	// Clean up keys input
	rawKeys := strings.Split(*keysFlag, ",")
	var keys []string
	for _, k := range rawKeys {
		trimmed := strings.TrimSpace(k)
		if trimmed != "" {
			keys = append(keys, trimmed)
		}
	}

	if len(keys) == 0 {
		fmt.Println("Error: No valid keys provided.")
		return
	}

	fmt.Println("==========================================")
	fmt.Printf("Targeting PID: %d\n", targetPID)
	fmt.Printf("  • Key Sequence : %v\n", keys)
	fmt.Printf("  • Key Delay    : %.2f second(s)\n", *keyDelayFlag)
	fmt.Printf("  • Loop Delay   : %.2f second(s)\n", *loopDelayFlag)
	fmt.Println("Keystrokes will ONLY be sent when this PID's window is active.")
	fmt.Println("Press Ctrl+C in terminal to stop.")
	fmt.Println("==========================================\n")

	keyDelay := time.Duration(*keyDelayFlag * float64(time.Second))
	loopDelay := time.Duration(*loopDelayFlag * float64(time.Second))
	loopCount := 0

	for {
		// Verify currently active window PID on Windows
		currentPID := robotgo.GetPID()

		if currentPID != targetPID {
			fmt.Printf("[%s] Target PID (%d) is not in focus (Current active PID: %d). Pausing...\n",
				time.Now().Format("15:04:05"), targetPID, currentPID)
			time.Sleep(1 * time.Second)
			continue
		}

		loopCount++
		fmt.Printf("[%s] --- Loop #%d ---\n", time.Now().Format("15:04:05"), loopCount)

		for idx, key := range keys {
			// Safety check right before pressing key
			if robotgo.GetPID() != targetPID {
				fmt.Println("Focus lost mid-sequence! Aborting current loop.")
				break
			}

			fmt.Printf("[%s] Pressing key [%d/%d]: %s\n", time.Now().Format("15:04:05"), idx+1, len(keys), key)
			pressKey(key)

			if idx < len(keys)-1 && *keyDelayFlag > 0 {
				time.Sleep(keyDelay)
			}
		}

		if *loopDelayFlag > 0 {
			time.Sleep(loopDelay)
		}
	}
}