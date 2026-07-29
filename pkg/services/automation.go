package services

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/go-vgo/robotgo"

	"autoclicker/pkg/database"
	"autoclicker/pkg/models"
)

type JobManager struct {
	mu     sync.Mutex
	cancel chan struct{}
	active bool
	status models.JobStatus
}

var Manager = &JobManager{}

func (m *JobManager) StartJob(taskID uint, pid int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.active {
		return fmt.Errorf("a task is already running")
	}

	// Fetch task profile from MySQL
	var task models.Task
	if err := database.DB.First(&task, taskID).Error; err != nil {
		return fmt.Errorf("task profile not found")
	}

	m.cancel = make(chan struct{})
	m.active = true
	m.status = models.JobStatus{
		ID:        "active_job",
		TaskID:    task.ID,
		PID:       pid,
		TaskName:  task.Name,
		IsRunning: true,
	}

	go m.worker(task, pid, m.cancel)
	return nil
}

func (m *JobManager) StopJob() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.active {
		return fmt.Errorf("no task is currently running")
	}

	close(m.cancel)
	m.active = false
	m.status.IsRunning = false
	return nil
}

func (m *JobManager) GetStatus() models.JobStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

func (m *JobManager) worker(task models.Task, pid int, cancel chan struct{}) {
	keyDelay := time.Duration(task.KeyDelay * float64(time.Second))
	loopDelay := time.Duration(task.LoopDelay * float64(time.Second))

	// Parse comma-separated keys
	rawKeys := strings.Split(task.Keys, ",")
	keys := make([]string, 0, len(rawKeys))
	for _, k := range rawKeys {
		if trimmed := strings.TrimSpace(strings.ToLower(k)); trimmed != "" {
			keys = append(keys, trimmed)
		}
	}

	for {
		select {
		case <-cancel:
			return
		default:
			// Auto-focus check
			if robotgo.GetPid() != pid {
				if task.AutoFocus {
					_ = robotgo.ActivePid(pid)
					time.Sleep(200 * time.Millisecond)
				} else {
					time.Sleep(1 * time.Second)
					continue
				}
			}

			// Key sequence
			for idx, key := range keys {
				select {
				case <-cancel:
					return
				default:
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
