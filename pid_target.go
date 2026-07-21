package main

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/go-vgo/robotgo"
)

// Dispatcher for key inputs (handles modifier holds vs. normal taps)
func pressKey(key string) {
	switch key {
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
		robotgo.KeyTap(key)
	}
}

func main() {
	pidFlag := flag.Int("pid", 0, "Target Process ID (PID) of the window [REQUIRED]")
	keysFlag := flag.String("keys", "tab,1", "Comma-separated list of keys to press (e.g. 'tab,1')")
	keyDelayFlag := flag.Float64("key-delay", 0.5, "Delay in seconds between key presses")
	loopDelayFlag := flag.Float64("loop-delay", 1.5, "Delay in seconds at end of each loop")
	autoFocusFlag := flag.Bool("auto-focus", false, "Automatically pull target window to front if unfocused")
	flag.Parse()

	// 1. Validation
	if *pidFlag <= 0 {
		fmt.Println("❌ Error: You must provide a valid PID with -pid.")
		fmt.Println("Example: go run pid_target.go -pid=12345 -keys=\"tab,1\" -key-delay=0.5 -loop-delay=1.5")
		os.Exit(1)
	}

	targetPID := *pidFlag // Kept as standard int to match robotgo signature

	// 2. Optimized slice allocation
	rawKeys := strings.Split(*keysFlag, ",")
	keys := make([]string, 0, len(rawKeys))
	for _, k := range rawKeys {
		if trimmed := strings.TrimSpace(strings.ToLower(k)); trimmed != "" {
			keys = append(keys, trimmed)
		}
	}

	if len(keys) == 0 {
		fmt.Println("❌ Error: No valid keys provided.")
		os.Exit(1)
	}

	// 3. Pre-calculate durations
	keyDelay := time.Duration(*keyDelayFlag * float64(time.Second))
	loopDelay := time.Duration(*loopDelayFlag * float64(time.Second))
	hasKeyDelay := keyDelay > 0
	hasLoopDelay := loopDelay > 0

	fmt.Println("==========================================")
	fmt.Printf("🎯 Target PID   : %d\n", targetPID)
	fmt.Printf("⌨️  Key Sequence : %v\n", keys)
	fmt.Printf("⏱️  Key Delay    : %.2fs\n", *keyDelayFlag)
	fmt.Printf("⏱️  Loop Delay   : %.2fs\n", *loopDelayFlag)
	fmt.Printf("⚡ Auto-Focus   : %v\n", *autoFocusFlag)
	fmt.Println("Press Ctrl+C in terminal to stop.")
	fmt.Println("==========================================\n")

	loopCount := 0

	// 4. Main Automation Loop
	for {
		// Check focus state
		if robotgo.GetPid() != targetPID {
			if *autoFocusFlag {
				fmt.Printf("[%s] Target PID %d lost focus. Activating window...\n", time.Now().Format("15:04:05"), targetPID)
				_ = robotgo.ActivePid(targetPID)
				time.Sleep(200 * time.Millisecond) // Give OS time to focus window
			} else {
				fmt.Printf("[%s] Target PID %d is not active. Pausing...\n", time.Now().Format("15:04:05"), targetPID)
				time.Sleep(1 * time.Second)
				continue
			}
		}

		loopCount++
		fmt.Printf("[%s] --- Loop #%d ---\n", time.Now().Format("15:04:05"), loopCount)

		for idx, key := range keys {
			// Safety check right before sending keystroke
			if robotgo.GetPid() != targetPID {
				fmt.Println("⚠️ Target lost focus mid-sequence! Aborting current loop.")
				break
			}

			fmt.Printf("[%s] Pressing key [%d/%d]: %s\n", time.Now().Format("15:04:05"), idx+1, len(keys), key)
			pressKey(key)

			if idx < len(keys)-1 && hasKeyDelay {
				time.Sleep(keyDelay)
			}
		}

		if hasLoopDelay {
			time.Sleep(loopDelay)
		}
	}
}
