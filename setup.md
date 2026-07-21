# Go Autoclicker - Complete Setup Guide

Build a background autoclicker in Go from scratch. This guide walks you through every step.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Setup](#project-setup)
3. [Understanding the Libraries](#understanding-the-libraries)
4. [Building Step-by-Step](#building-step-by-step)
5. [Finding Target Coordinates](#finding-target-coordinates)
6. [Configuration](#configuration)
7. [Compilation & Execution](#compilation--execution)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Install Go

**macOS:**
```bash
# Using Homebrew
brew install go

# Or download from: https://golang.org/dl/
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install golang-go

# Or:
wget https://go.dev/dl/go1.21.0.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin
```

**Windows:**
- Download installer: https://golang.org/dl/
- Run the `.msi` file
- Restart terminal after installation

### Verify Installation

```bash
go version
# Should output: go version go1.21.0 (or higher)

go env GOPATH
# Should show your Go workspace path
```

### Additional System Dependencies

**Linux Only** (required for mouse automation):

```bash
# Ubuntu/Debian
sudo apt-get install xdotool xclip libx11-dev libxrandr-dev

# Fedora/RHEL
sudo dnf install xdotool xclip libX11-devel libXrandr-devel

# Arch
sudo pacman -S xdotool xclip libx11 libxrandr
```

**macOS:** No additional dependencies needed (uses native APIs)

**Windows:** No additional dependencies needed

---

## Project Setup

### 1. Create Project Directory

```bash
mkdir go-autoclicker
cd go-autoclicker
```

### 2. Initialize Go Module

```bash
go mod init autoclicker
```

This creates a `go.mod` file that tracks your project dependencies.

### 3. Install Required Library

```bash
go get github.com/go-vgo/robotgo
```

This downloads the `robotgo` library, which provides cross-platform mouse/keyboard automation.

**What was created:**
- `go.mod` - Tracks dependencies
- `go.sum` - Locks dependency versions for reproducibility

---

## Understanding the Libraries

### robotgo

**What it does:**
- Controls mouse movement: `robotgo.MoveMouse(x, y)`
- Performs clicks: `robotgo.Click()`
- Gets current mouse position: `robotgo.Location()`
- Keyboard control: `robotgo.KeyTap("a")`
- Detects active window (platform-specific)

**Why we use it:**
- Cross-platform (Windows, macOS, Linux)
- Simple, lightweight API
- No dependencies on external tools
- Reliable for background automation

**Installation verification:**
```bash
go list -m github.com/go-vgo/robotgo
# Should show: github.com/go-vgo/robotgo v1.0.0 (or latest)
```

---

## Building Step-by-Step

### Step 1: Create Basic Structure

Create `main.go`:

```go
package main

import (
	"fmt"
)

func main() {
	fmt.Println("Autoclicker initialized")
}
```

Test it:
```bash
go run main.go
# Output: Autoclicker initialized
```

### Step 2: Add robotgo Import

```go
package main

import (
	"fmt"
	"github.com/go-vgo/robotgo"
)

func main() {
	// Get current mouse position
	x, y := robotgo.Location()
	fmt.Printf("Current mouse position: X=%d, Y=%d\n", x, y)
}
```

Test it:
```bash
go run main.go
# Output: Current mouse position: X=1234, Y=567 (your actual position)
```

### Step 3: Add Click Functionality

```go
package main

import (
	"fmt"
	"time"
	"github.com/go-vgo/robotgo"
)

func main() {
	// Define target coordinates
	targetX := 640
	targetY := 480

	fmt.Printf("Moving to (%d, %d) and clicking...\n", targetX, targetY)

	// Move mouse and click
	robotgo.MoveMouse(targetX, targetY)
	time.Sleep(100 * time.Millisecond) // Small delay for visibility
	robotgo.Click()

	fmt.Println("Click performed")
}
```

Test it (move your mouse to a browser window with a clickable element):
```bash
go run main.go
# The click should register on your page
```

### Step 4: Add Timer Loop

```go
package main

import (
	"fmt"
	"time"
	"github.com/go-vgo/robotgo"
)

func main() {
	targetX := 640
	targetY := 480
	intervalSeconds := 10

	fmt.Printf("Starting autoclicker\n")
	fmt.Printf("Target: (%d, %d)\n", targetX, targetY)
	fmt.Printf("Interval: %d seconds\n", intervalSeconds)
	fmt.Println("Press Ctrl+C to stop\n")

	// Create a ticker that fires every N seconds
	ticker := time.NewTicker(time.Duration(intervalSeconds) * time.Second)
	defer ticker.Stop()

	clickCount := 0

	for range ticker.C {
		clickCount++
		robotgo.MoveMouse(targetX, targetY)
		robotgo.Click()
		fmt.Printf("[%s] Click #%d\n", time.Now().Format("15:04:05"), clickCount)
	}
}
```

Test it:
```bash
go run main.go
# Will click every 10 seconds
# Press Ctrl+C to stop
```

### Step 5: Make It Configurable

```go
package main

import (
	"fmt"
	"time"
	"github.com/go-vgo/robotgo"
)

// Config holds the autoclicker settings
type Config struct {
	TargetX       int
	TargetY       int
	IntervalSecs  int
	DurationMins  int // 0 = infinite
	EnableLogging bool
}

func main() {
	// EDIT THESE VALUES
	config := Config{
		TargetX:       640,
		TargetY:       480,
		IntervalSecs:  10,
		DurationSecs:  0, // 0 = run forever
		EnableLogging: true,
	}

	startAutoclicker(config)
}

func startAutoclicker(config Config) {
	fmt.Printf("=== Autoclicker Started ===\n")
	fmt.Printf("Target: (%d, %d)\n", config.TargetX, config.TargetY)
	fmt.Printf("Interval: %d seconds\n", config.IntervalSecs)
	if config.DurationMins > 0 {
		fmt.Printf("Duration: %d minutes\n", config.DurationMins)
	} else {
		fmt.Printf("Duration: Infinite (Ctrl+C to stop)\n")
	}
	fmt.Printf("===========================\n\n")

	ticker := time.NewTicker(time.Duration(config.IntervalSecs) * time.Second)
	defer ticker.Stop()

	var endTimer *time.Timer
	if config.DurationMins > 0 {
		endTimer = time.NewTimer(time.Duration(config.DurationMins) * time.Minute)
		defer endTimer.Stop()
	}

	clickCount := 0

	for {
		select {
		case <-ticker.C:
			clickCount++
			robotgo.MoveMouse(config.TargetX, config.TargetY)
			robotgo.Click()

			if config.EnableLogging {
				fmt.Printf("[%s] Click #%d\n", time.Now().Format("15:04:05"), clickCount)
			}

		case <-endTimer.C:
			fmt.Printf("\nDuration reached. Total clicks: %d\n", clickCount)
			return
		}
	}
}
```

### Step 6: Add Graceful Shutdown (Ctrl+C)

```go
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
	"github.com/go-vgo/robotgo"
)

type Config struct {
	TargetX       int
	TargetY       int
	IntervalSecs  int
	DurationMins  int
	EnableLogging bool
}

func main() {
	config := Config{
		TargetX:       640,
		TargetY:       480,
		IntervalSecs:  10,
		DurationMins:  0,
		EnableLogging: true,
	}

	startAutoclicker(config)
}

func startAutoclicker(config Config) {
	fmt.Printf("=== Autoclicker Started ===\n")
	fmt.Printf("Target: (%d, %d)\n", config.TargetX, config.TargetY)
	fmt.Printf("Interval: %d seconds\n", config.IntervalSecs)
	fmt.Printf("Press Ctrl+C to stop\n")
	fmt.Printf("===========================\n\n")

	// Setup signal handling for Ctrl+C
	stopSignal := make(chan os.Signal, 1)
	signal.Notify(stopSignal, syscall.SIGINT, syscall.SIGTERM)

	ticker := time.NewTicker(time.Duration(config.IntervalSecs) * time.Second)
	defer ticker.Stop()

	clickCount := 0
	startTime := time.Now()

	for {
		select {
		case <-ticker.C:
			clickCount++
			robotgo.MoveMouse(config.TargetX, config.TargetY)
			robotgo.Click()

			if config.EnableLogging {
				fmt.Printf("[%s] Click #%d\n", time.Now().Format("15:04:05"), clickCount)
			}

		case <-stopSignal:
			elapsed := time.Since(startTime)
			fmt.Printf("\n\n=== Autoclicker Stopped ===\n")
			fmt.Printf("Total clicks: %d\n", clickCount)
			fmt.Printf("Total time: %v\n", elapsed)
			fmt.Printf("===========================\n")
			return
		}
	}
}
```

---

## Finding Target Coordinates

### Method 1: Simple Coordinate Finder

Create `coords.go`:

```go
package main

import (
	"fmt"
	"time"
	"github.com/go-vgo/robotgo"
)

func main() {
	fmt.Println("=== Coordinate Finder ===")
	fmt.Println("Move mouse to target location")
	fmt.Println("Coordinates update every 100ms")
	fmt.Println("Ctrl+C to exit")
	fmt.Println("=======================\n")

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	var lastX, lastY int

	for range ticker.C {
		x, y := robotgo.Location()

		if x != lastX || y != lastY {
			fmt.Printf("\rX: %d | Y: %d", x, y)
			lastX, y = x, y
		}
	}
}
```

Run it:
```bash
go run coords.go
# Move your mouse around and note the X, Y when over your target
```

### Method 2: Browser DevTools (For Web Elements)

If clicking a specific element on a webpage:

1. Open DevTools (F12)
2. Inspect the element
3. Run in console:
```javascript
const elem = document.querySelector('.your-button-class');
const rect = elem.getBoundingClientRect();
console.log(`X: ${Math.round(rect.left + rect.width/2)}, Y: ${Math.round(rect.top + rect.height/2)}`);
```

---

## Configuration

### Essential Variables

In your `main.go`, update the `Config` struct:

```go
config := Config{
	TargetX:       640,     // X pixel coordinate
	TargetY:       480,     // Y pixel coordinate
	IntervalSecs:  10,      // Seconds between clicks (1-60 typical)
	DurationMins:  0,       // Minutes to run (0 = infinite)
	EnableLogging: true,    // Print each click
}
```

### Common Intervals

```go
IntervalSecs: 5       // Click every 5 seconds
IntervalSecs: 10      // Click every 10 seconds
IntervalSecs: 30      // Click every 30 seconds
IntervalSecs: 60      // Click every 1 minute
```

### Duration Examples

```go
DurationMins: 0       // Run until Ctrl+C
DurationMins: 5       // Run for 5 minutes
DurationMins: 30      // Run for 30 minutes
DurationMins: 60      // Run for 1 hour
```

---

## Compilation & Execution

### Option 1: Direct Execution

```bash
go run main.go
```

**Pros:** Quick testing, no setup  
**Cons:** Requires Go installed on your machine

### Option 2: Compile to Binary

```bash
# Build for your current OS
go build -o autoclicker main.go

# Run the binary
./autoclicker        # macOS/Linux
autoclicker.exe      # Windows
```

**Pros:** Standalone executable, can share/move easily  
**Cons:** Larger file size (~6-10MB)

### Option 3: Optimize Binary Size

```bash
# Stripped binary (smaller, but no debugging info)
go build -ldflags="-s -w" -o autoclicker main.go

# Check size
ls -lh autoclicker
```

### Option 4: Build for Different OS

Build on macOS for Linux:
```bash
GOOS=linux GOARCH=amd64 go build -o autoclicker-linux main.go
```

Build on Linux for Windows:
```bash
GOOS=windows GOARCH=amd64 go build -o autoclicker.exe main.go
```

---

## Testing

### Step 1: Test Click Registration

1. Open a text editor or web form
2. Find coordinates using `coords.go`
3. Temporarily set `IntervalSecs: 3` (3 second interval)
4. Run autoclicker
5. Watch as text appears or form fills

### Step 2: Test Long-Running Execution

```bash
# Set DurationMins: 1 (run for 1 minute)
go run main.go

# Watch output for 60 seconds
# You should see 6 clicks (every 10 seconds)
```

### Step 3: Test Graceful Shutdown

```bash
go run main.go
# Wait for 2-3 clicks
# Press Ctrl+C
# Should see summary stats
```

### Step 4: Verify Background Operation

1. Start autoclicker:
```bash
go run main.go &  # Run in background
```

2. Use your mouse normally - it should NOT interfere
3. Stop with Ctrl+C

---

## Troubleshooting

### "Command not found: go"

Go is not in your PATH.

**Fix:**
```bash
# Add to ~/.bashrc or ~/.zshrc
export PATH=$PATH:/usr/local/go/bin

# Reload
source ~/.bashrc
# or
source ~/.zshrc
```

### "cannot find package"

robotgo not installed.

**Fix:**
```bash
go get github.com/go-vgo/robotgo
go mod tidy
```

### "X11 connection rejected" (Linux)

Running in a restricted environment.

**Fix:**
```bash
export DISPLAY=:0
go run main.go
```

Or check active display:
```bash
echo $DISPLAY
# If empty, try:
export DISPLAY=:1
```

### "Permission denied" (macOS)

Missing accessibility permissions.

**Fix:**
1. System Preferences → Security & Privacy → Accessibility
2. Add Terminal (or your IDE) to allowed apps
3. Restart the terminal/application

### Click not registering on website

Coordinates might be wrong or browser window not focused.

**Fix:**
1. Run `coords.go` to double-check coordinates
2. Click the browser window to focus it
3. Add a small delay:
```go
robotgo.MoveMouse(config.TargetX, config.TargetY)
time.Sleep(50 * time.Millisecond)  // Add this
robotgo.Click()
```

### "go: go.mod file not found"

You didn't initialize the Go module.

**Fix:**
```bash
go mod init autoclicker
go get github.com/go-vgo/robotgo
```

### High CPU Usage

Ticker loop is running too tight.

**Fix:** Ensure you're using `time.NewTicker()`, not a busy loop. The example code already does this correctly.

---

## Next Steps

### Optional Enhancements

1. **Add mouse idle detection** - Only click when mouse hasn't moved
2. **Add hotkey toggle** - Pause/resume with Alt+F12
3. **Add config file** - Load settings from JSON
4. **Add system tray icon** - Control from taskbar
5. **Add logging to file** - Save click history

### Example: Add File Logging

```go
import (
	"os"
	"log"
)

// At startup
f, _ := os.OpenFile("autoclicker.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
defer f.Close()
logger := log.New(f, "", log.LstdFlags)

// When clicking
logger.Printf("Click #%d at (%d, %d)\n", clickCount, config.TargetX, config.TargetY)
```

---

## Resources

- **robotgo GitHub:** https://github.com/go-vgo/robotgo
- **Go Documentation:** https://golang.org/doc/
- **time.Ticker:** https://golang.org/pkg/time/#Ticker

---

## Final Checklist

- [ ] Go 1.21+ installed and verified
- [ ] Project directory created: `go-autoclicker`
- [ ] Module initialized: `go mod init autoclicker`
- [ ] robotgo installed: `go get github.com/go-vgo/robotgo`
- [ ] `main.go` created with autoclicker logic
- [ ] Target coordinates found using `coords.go`
- [ ] Config updated with your X, Y values
- [ ] Tested with `go run main.go`
- [ ] Compiled to binary: `go build -o autoclicker main.go`

Good luck! 🚀