package main

import (
	"fmt"
	"time"

	"github.com/go-vgo/robotgo"
)

func main_1() {
	// x , y := robotgo.Location()
	
	// fmt.Println("current : X=%d, Y=%d\n", x, y)
	X := 761
	Y := 493
	
	intervalSeconds := 7

	robotgo.Move(X, Y)
	robotgo.Click()
	// Create a ticker that fires every N seconds
	ticker := time.NewTicker(time.Duration(intervalSeconds) * time.Second)
	defer ticker.Stop()

	clickCount := 0

	for range ticker.C {
		robotgo.Move(X, Y)
		robotgo.Click()
		clickCount++
		fmt.Printf("[%s] Click #%d\n", time.Now().Format("15:04:05"), clickCount)
	}
}