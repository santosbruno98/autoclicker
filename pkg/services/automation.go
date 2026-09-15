package services

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/go-vgo/robotgo"
	"github.com/segmentio/kafka-go"
	"github.com/shirou/gopsutil/v4/process"

	"autoclicker/pkg/database"
	"autoclicker/pkg/models"
)

// Loging to Kafka

const maxLogLines = 500

type JobManager struct {
	mu     sync.Mutex
	cancel chan struct{}
	active bool
	status models.JobStatus

	logsMu      sync.Mutex
	logs        []string
	kafkaWriter *kafka.Writer
}

var Manager = &JobManager{}

func (m *JobManager) InitKafka(brokers []string, topic string) {
	m.kafkaWriter = &kafka.Writer{
		Addr:     kafka.TCP(brokers...),
		Topic:    topic,
		Balancer: &kafka.LeastBytes{},
	}
}

func (m *JobManager) log(format string, args ...interface{}) {
	line := fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
	m.logsMu.Lock()
	m.logs = append(m.logs, line)
	if len(m.logs) > maxLogLines {
		m.logs = m.logs[len(m.logs)-maxLogLines:]
	}
	m.logsMu.Unlock()

	if m.kafkaWriter != nil {
		go func(msg string) {
			err := m.kafkaWriter.WriteMessages(context.Background(), kafka.Message{
				Value: []byte(msg),
			})
			if err != nil {
				log.Printf("Failed to write log message to Kafka: %v", err)
			}
		}(line)
	}
}

func (m *JobManager) GetLogs() []string {
	m.logsMu.Lock()
	defer m.logsMu.Unlock()
	out := make([]string, len(m.logs))
	copy(out, m.logs)
	return out
}

func (m *JobManager) clearLogs() {
	m.logsMu.Lock()
	m.logs = nil
	m.logsMu.Unlock()
}

func (m *JobManager) IsActive() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.active
}

func (m *JobManager) StartJob(taskID uint, pid int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.active {
		return fmt.Errorf("a task is already running")
	}

	var task models.Task
	if err := database.DB.First(&task, taskID).Error; err != nil {
		return fmt.Errorf("task profile not found")
	}

	m.clearLogs()
	m.cancel = make(chan struct{})
	m.active = true
	m.status = models.JobStatus{
		ID:        "active_job",
		TaskID:    task.ID,
		PID:       pid,
		TaskName:  task.Name,
		IsRunning: true,
	}

	m.log("Target PID: %d | Task: %s | Keys: %s | Key Delay: %.2fs | Loop Delay: %.2fs | Auto-Focus: %v",
		pid, task.Name, task.Keys, task.KeyDelay, task.LoopDelay, task.AutoFocus)

	go m.worker(task, pid, m.cancel)
	return nil
}

func (m *JobManager) StopJob() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.active {
		// already stopped
		// not an error so there is nothing to do
		return nil
	}

	close(m.cancel)
	m.active = false
	m.status.IsRunning = false
	m.log("Automation stopped.")
	return nil
}

// stopFromWorker is called by the worker itself (e.g. on crash detection),
// so it must not try to close(m.cancel) again or re-lock what the caller holds.
func (m *JobManager) stopFromWorker(reason string) {
	m.mu.Lock()
	m.active = false
	m.status.IsRunning = false
	m.mu.Unlock()
	m.log(reason)
}

func (m *JobManager) GetStatus() models.JobStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

func (m *JobManager) worker(task models.Task, pid int, cancel chan struct{}) {
	keyDelay := time.Duration(task.KeyDelay * float64(time.Second))
	loopDelay := time.Duration(task.LoopDelay * float64(time.Second))

	rawKeys := strings.Split(task.Keys, ",")
	keys := make([]string, 0, len(rawKeys))
	for _, k := range rawKeys {
		if trimmed := strings.TrimSpace(strings.ToLower(k)); trimmed != "" {
			keys = append(keys, trimmed)
		}
	}

	loopCount := 0
	ctx := context.Background()

	for {
		select {
		case <-cancel:
			return
		default:
			// Crash detection: is the target process still alive at all?
			exists, _ := process.PidExistsWithContext(ctx, int32(pid))
			if !exists {
				m.stopFromWorker(fmt.Sprintf("Target PID %d no longer exists (process crashed or closed). Automation stopped automatically.", pid))
				return
			}

			// Focus handling (process alive but not the foreground window)
			if robotgo.GetPid() != pid {
				if task.AutoFocus {
					m.log("Target PID %d lost focus. Activating window...", pid)
					_ = robotgo.ActivePid(pid)
					time.Sleep(200 * time.Millisecond)
				} else {
					m.log("Target PID %d is not active. Pausing...", pid)
					time.Sleep(1 * time.Second)
					continue
				}
			}

			loopCount++
			m.log("--- Loop #%d ---", loopCount)

			for idx, key := range keys {
				select {
				case <-cancel:
					return
				default:
					exists, _ := process.PidExistsWithContext(ctx, int32(pid))
					if !exists {
						m.stopFromWorker(fmt.Sprintf("Target PID %d no longer exists mid-sequence. Automation stopped automatically.", pid))
						return
					}
					if robotgo.GetPid() != pid {
						m.log("Target lost focus mid-sequence! Aborting current loop.")
						break
					}
					m.log("Pressing key [%d/%d]: %s", idx+1, len(keys), key)
					pressKey(key)
					if idx < len(keys)-1 && keyDelay > 0 {
						time.Sleep(keyDelay)
					}
				}
			}

			if loopDelay > 0 {
				time.Sleep(loopDelay)
			}
		}
	}
}

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
