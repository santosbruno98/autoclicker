import React, { useState, useEffect } from 'react';
import { fetchProcesses, verifyPID, fetchTasks, fetchAutomationStatus, startJob, stopJob } from './services/api';
import ProcessSelector from './components/ProcessSelector';
import CommandSelector from './components/CommandSelector';
import LogPanel from './components/LogPanel';
import TaskManager from './components/TaskManager';

export default function App() {
  const [processes, setProcesses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [searchName, setSearchName] = useState('');
  
  const [selectedPid, setSelectedPid] = useState('');
  const [manualPidInput, setManualPidInput] = useState('');
  const [pidVerificationStatus, setPidVerificationStatus] = useState(null);

  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [isAutomating, setIsAutomating] = useState(false);
  const [logs, setLogs] = useState([]);

  const addLog = (msg) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const loadInitialData = async () => {
    try {
      const [procsData, tasksData] = await Promise.all([
        fetchProcesses(searchName),
        fetchTasks(),
      ]);
      setProcesses(procsData || []);
      setTasks(tasksData || []);
    } catch (err) {
      addLog('Error fetching initial process/task data.');
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [searchName]);

  // Handle Manual PID Verification
  const handleVerifyPID = async () => {
    if (!manualPidInput) return;
    try {
      const res = await verifyPID(manualPidInput);
      if (res.exists) {
        setPidVerificationStatus({ valid: true, text: `Active PID: ${res.pid} (${res.name})` });
        setSelectedPid(res.pid.toString());
        addLog(`Verified target PID ${res.pid} (${res.name})`);
      } else {
        setPidVerificationStatus({ valid: false, text: `PID ${manualPidInput} is NOT active.` });
      }
    } catch (err) {
      setPidVerificationStatus({ valid: false, text: 'Verification check failed.' });
    }
  };

  // Start Automation
  const handleStart = async () => {
    if (!selectedPid || !selectedTaskId) {
      addLog('Error: Please select both a PID and a Task profile first.');
      return;
    }
    try {
      await startJob({ pid: parseInt(selectedPid, 10), task_id: parseInt(selectedTaskId, 10) });
      setIsAutomating(true);
      addLog(`Started automation on PID: ${selectedPid}`);
    } catch (err) {
      addLog('Failed to start automation.');
    }
  };

  // Stop Automation
  const handleStop = async () => {
    try {
      await stopJob();
      setIsAutomating(false);
      addLog('Automation stopped.');
    } catch (err) {
      addLog('Failed to stop automation.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 flex flex-col gap-6 font-sans">
      <header className="border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">AutoClicker Controller</h1>
        <p className="text-sm text-slate-400">Target background windows and send automated keystroke patterns</p>
      </header>

      {/* Process Selection & Verification Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 bg-slate-900 p-4 rounded border border-slate-800">
        <div className="flex flex-col gap-3">
          <label className="text-sm font-semibold text-slate-300">Search Process by Name</label>
          <input
            type="text"
            placeholder="Type process name (e.g., Digimon)..."
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            className="bg-slate-800 text-slate-100 border border-slate-700 rounded p-2 text-sm"
          />
          <ProcessSelector
            processes={processes}
            selectedPid={selectedPid}
            onSelect={(pid) => {
              setSelectedPid(pid);
              setManualPidInput(pid);
            }}
          />
        </div>

        {/* Manual PID Check */}
        <div className="flex flex-col gap-3 border-t lg:border-t-0 lg:border-l border-slate-800 pt-4 lg:pt-0 lg:pl-4">
          <label className="text-sm font-semibold text-slate-300">Verify PID Directly</label>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Enter PID..."
              value={manualPidInput}
              onChange={(e) => setManualPidInput(e.target.value)}
              className="bg-slate-800 text-slate-100 border border-slate-700 rounded p-2 text-sm w-full"
            />
            <button
              onClick={handleVerifyPID}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-sm font-medium"
            >
              Verify
            </button>
          </div>
          {pidVerificationStatus && (
            <div
              className={`text-xs px-3 py-2 rounded ${
                pidVerificationStatus.valid
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-rose-950 text-rose-400 border border-rose-800'
              }`}
            >
              {pidVerificationStatus.text}
            </div>
          )}
        </div>
      </div>

      {/* Task Profiles & CRUD Management */}
      <TaskManager tasks={tasks} onRefresh={loadInitialData} />

      {/* Task Selection & Controls */}
      <div className="bg-slate-900 p-4 rounded border border-slate-800 flex flex-col md:flex-row items-end justify-between gap-4">
        <div className="w-full md:w-1/2">
          <CommandSelector
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelect={(id) => setSelectedTaskId(id)}
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleStart}
            disabled={isAutomating}
            className={`px-6 py-2 rounded font-bold text-sm ${
              isAutomating
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            Start Automation
          </button>
          <button
            onClick={handleStop}
            disabled={!isAutomating}
            className={`px-6 py-2 rounded font-bold text-sm ${
              !isAutomating
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-rose-600 hover:bg-rose-500 text-white'
            }`}
          >
            Stop Automation
          </button>
        </div>
      </div>

      {/* Realtime Execution Log Panel */}
      <LogPanel logs={logs} />
    </div>
  );
}