
import React, { useEffect, useState } from 'react';
import {
  fetchProcesses, verifyPID, fetchTasks,
  fetchAutomationStatus, fetchAutomationLogs,
  startJob, stopJob
} from '../services/api';

import ProcessSelector from './ProcessSelector';
import CommandSelector from './CommandSelector';
import LogPanel from './LogPanel';
import WorkerLogPanel from './WorkerLogPanel';
import TaskManager from './TaskManager';

export default function ControllerTab() {
  const [processes, setProcesses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [searchName, setSearchName] = useState('');
  const [selectedPid, setSelectedPid] = useState('');
  const [manualPidInput, setManualPidInput] = useState('');
  const [pidVerificationStatus, setPidVerificationStatus] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [isAutomating, setIsAutomating] = useState(false);
  const [activeStatus, setActiveStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [workerLogs, setWorkerLogs] = useState([]);

  const addLog = (message) => {
    setLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...prev,
    ]);
  };

  const loadInitialData = async () => {
    try {
      const [procs, taskData] = await Promise.all([
        fetchProcesses(searchName),
        fetchTasks(),
      ]);
      setProcesses(procs || []);
      setTasks(taskData || []);
    } catch {
      addLog('Failed to load processes or tasks.');
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [searchName]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const status = await fetchAutomationStatus();
        if (cancelled) return;
        setActiveStatus(status);
        setIsAutomating(Boolean(status?.is_running));

        if (status?.is_running) {
          const response = await fetchAutomationLogs();
          if (!cancelled) setWorkerLogs(response.logs || []);
        }
      } catch {
        // Retry on the next poll.
      }
    };

    poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const verify = async () => {
    if (!manualPidInput) return;
    try {
      const response = await verifyPID(manualPidInput);
      if (response.exists) {
        setSelectedPid(String(response.pid));
        setPidVerificationStatus({
          valid: true,
          text: `Active PID: ${response.pid} (${response.name})`,
        });
      } else {
        setPidVerificationStatus({
          valid: false,
          text: 'Process not found.',
        });
      }
    } catch {
      setPidVerificationStatus({
        valid: false,
        text: 'Verification failed.',
      });
    }
  };

  const start = async () => {
    if (!selectedPid || !selectedTaskId) {
      addLog('Select a PID and task first.');
      return;
    }
    try {
      await startJob({
        pid: Number(selectedPid),
        task_id: Number(selectedTaskId),
      });
      addLog('Automation started.');
    } catch (error) {
      addLog(error?.response?.data?.error || 'Failed to start automation.');
    }
  };

  const stop = async () => {
    try {
      await stopJob();
      addLog('Automation stopped.');
    } catch {
      addLog('Failed to stop automation.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="terminal-card p-5">
        <h2 className="text-xl font-semibold">Desktop Automation</h2>
        <p className="mt-1 text-sm text-slate-400">
          Local Windows process automation. Not intended for cloud deployment.
        </p>
      </div>

      <div className={`terminal-card p-4 text-sm ${
        isAutomating ? 'text-emerald-400' : 'text-slate-400'
      }`}>
        {isAutomating
          ? `ACTIVE — PID ${activeStatus?.pid} · ${activeStatus?.task_name}`
          : 'IDLE — no automation running'}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="terminal-card space-y-3 p-5">
          <label className="text-sm text-slate-300">Search Process</label>
          <input
            className="terminal-input"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder="Process name..."
          />
          <ProcessSelector
            processes={processes}
            selectedPid={selectedPid}
            onSelect={(pid) => {
              setSelectedPid(String(pid));
              setManualPidInput(String(pid));
            }}
          />
        </div>

        <div className="terminal-card space-y-3 p-5">
          <label className="text-sm text-slate-300">Verify PID</label>
          <div className="flex gap-2">
            <input
              className="terminal-input"
              type="number"
              value={manualPidInput}
              onChange={(e) => setManualPidInput(e.target.value)}
              placeholder="PID"
            />
            <button className="terminal-button" onClick={verify}>
              Verify
            </button>
          </div>
          {pidVerificationStatus && (
            <p className={`text-xs ${
              pidVerificationStatus.valid ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {pidVerificationStatus.text}
            </p>
          )}
        </div>
      </div>

      <TaskManager tasks={tasks} onRefresh={loadInitialData} />

      <div className="terminal-card flex flex-col gap-4 p-5 md:flex-row md:items-end md:justify-between">
        <div className="w-full md:max-w-md">
          <CommandSelector
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelect={setSelectedTaskId}
          />
        </div>
        <div className="flex gap-2">
          <button
            className="terminal-button"
            disabled={isAutomating}
            onClick={start}
          >
            Start
          </button>
          <button
            className="terminal-button-secondary"
            disabled={!isAutomating}
            onClick={stop}
          >
            Stop
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LogPanel logs={logs} />
        <WorkerLogPanel logs={workerLogs} />
      </div>
    </div>
  );
}
