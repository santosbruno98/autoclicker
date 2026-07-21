# Target Window AutoClicker (Go)

A CLI keyboard sequence automator written in Go using `robotgo`. It safely targets a specific process PID and sends keystrokes **only** when that window is active.

## Features
- **PID Target Lock**: Keystrokes are guarded and paused if you switch windows.
- **Sub-Second Delays**: Supports floating-point delays (e.g., `0.2s`, `0.5s`).
- **Auto-Focus Option**: Pulls target app back to the foreground if it loses focus.
- **Graceful Exit**: Responds cleanly to `Ctrl+C`.

## Installation & Setup

1. Clone the repository:
   ```bash
   git clone [https://github.com/yourusername/autoclicker.git](https://github.com/yourusername/autoclicker.git)
   cd autoclicker