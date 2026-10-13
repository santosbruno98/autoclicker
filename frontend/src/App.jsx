
import React, { useState, useEffect, useCallback } from 'react';
import { fetchTasks } from './services/api';
import {
  checkLocalAgent,
  authorizeLocalAgent,
  clearLocalAgentAuthorization,
  fetchLocalProcesses,
  verifyLocalPID,
  fetchLocalAutomationStatus,
  fetchLocalAutomationLogs,
  startLocalJob,
  stopLocalJob,
} from './services/localAgent';

import ProcessSelector from './components/ProcessSelector';
import CommandSelector from './components/CommandSelector';
import LogPanel from './components/LogPanel';
import WorkerLogPanel from './components/WorkerLogPanel';
import TaskManager from './components/TaskManager';
import NotesTab from './components/NotesTab';
import PortfolioTab from './components/PortfolioTab';
import KafkaLogsTab from './components/KafkaLogsTab';

export default function App() {
  const [activeTab, setActiveTab] = useState('controller');
  const [agentOnline, setAgentOnline] = useState(false);
  const [agentAuthorized, setAgentAuthorized] = useState(false);
  const [pairingToken, setPairingToken] = useState('');
  const [agentError, setAgentError] = useState('');

  const [processes, setProcesses] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [searchName, setSearchName] = useState('');

  const [selectedPid, setSelectedPid] = useState('');
  const [manualPidInput, setManualPidInput] = useState('');
  const [pidVerificationStatus, setPidVerificationStatus] = useState(null);

  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [activeStatus, setActiveStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [workerLogs, setWorkerLogs] = useState([]);
  const [busy, setBusy] = useState(false);

  const isAutomating = Boolean(activeStatus?.is_running);

  const addLog = useCallback((message) => {
    setLogs((previous) => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...previous,
    ].slice(0, 100));
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      setTasks((await fetchTasks()) || []);
    } catch {
      addLog('Failed to load tasks from cloud API.');
    }
  }, [addLog]);

  const loadProcesses = useCallback(async () => {
    if (!agentAuthorized) return;

    try {
      setProcesses((await fetchLocalProcesses(searchName)) || []);
    } catch (error) {
      setAgentError(error.message);
    }
  }, [agentAuthorized, searchName]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (activeTab === 'controller') {
      loadProcesses();
    }
  }, [activeTab, loadProcesses]);

  useEffect(() => {
    if (activeTab !== 'controller') return undefined;

    let cancelled = false;

    const poll = async () => {
      try {
        await checkLocalAgent();
        if (cancelled) return;

        setAgentOnline(true);

        if (agentAuthorized) {
          const status = await fetchLocalAutomationStatus();
          if (cancelled) return;

          setActiveStatus(status);

          if (status.is_running) {
            const result = await fetchLocalAutomationLogs();
            if (!cancelled) {
              setWorkerLogs(result.logs || []);
            }
          }
        }
      } catch (error) {
        if (cancelled) return;

        if (
          error.message.includes('authorization') ||
          error.message.includes('401')
        ) {
          setAgentAuthorized(false);
          clearLocalAgentAuthorization();
          setActiveStatus(null);
          setAgentError(
            'Local token is no longer valid or the agent restarted. Pair again.'
          );
        } else {
          setAgentOnline(false);
          setAgentAuthorized(false);
          clearLocalAgentAuthorization();
          setActiveStatus(null);
        }
      }
    };

    poll();

    const interval = setInterval(poll, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTab, agentAuthorized]);

  const handlePair = async () => {
    if (!pairingToken.trim()) return;

    authorizeLocalAgent(pairingToken);

    try {
      const status = await fetchLocalAutomationStatus();

      setAgentAuthorized(true);
      setAgentOnline(true);
      setActiveStatus(status);
      setAgentError('');
      setPairingToken('');

      addLog('Local Windows agent authorized.');
    } catch (error) {
      clearLocalAgentAuthorization();
      setAgentAuthorized(false);
      setAgentError(error.message);
    }
  };

  const handleDisconnect = () => {
    clearLocalAgentAuthorization();
    setAgentAuthorized(false);
    setActiveStatus(null);
    setProcesses([]);
    addLog('Disconnected browser from local agent.');
  };

  const handleVerifyPID = async () => {
    if (!manualPidInput || !agentAuthorized) return;

    try {
      const result = await verifyLocalPID(manualPidInput);

      if (result.exists) {
        setPidVerificationStatus({
          valid: true,
          text: `Active PID: ${result.pid} (${result.name})`,
        });

        setSelectedPid(String(result.pid));
        addLog(`Verified target PID ${result.pid} (${result.name})`);
      } else {
        setPidVerificationStatus({
          valid: false,
          text: `PID ${manualPidInput} is NOT active.`,
        });
      }
    } catch (error) {
      setPidVerificationStatus({
        valid: false,
        text: error.message,
      });
    }
  };

  const handleStart = async () => {
    if (!agentAuthorized || !selectedPid || !selectedTaskId) {
      addLog('Authorize the agent, then select a PID and task.');
      return;
    }

    setBusy(true);

    try {
      await startLocalJob({
        pid: Number(selectedPid),
        task_id: Number(selectedTaskId),
      });

      setActiveStatus(await fetchLocalAutomationStatus());
      addLog(`Started local automation on PID ${selectedPid}.`);
    } catch (error) {
      addLog(`Start failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);

    try {
      await stopLocalJob();
      setActiveStatus(await fetchLocalAutomationStatus());
      addLog('Local automation stopped.');
    } catch (error) {
      addLog(`Stop failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 flex flex-col gap-6 font-sans">
      <header className="border-b border-slate-800 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          AutoClicker Controller
        </h1>
        <p className="text-sm text-slate-400">
          Target background windows and send automated keystroke patterns
        </p>
      </header>

      <div className="flex gap-1 border-b border-slate-800">
        {[
          ['controller', 'Controller'],
          ['notes', 'Notes'],
          ['portfolio', 'Portfolio'],
          ['kafka', 'Kafka UI'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
              activeTab === id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'notes' ? (
        <NotesTab />
      ) : activeTab === 'portfolio' ? (
        <PortfolioTab />
      ) : activeTab === 'kafka' ? (
        <KafkaLogsTab />
      ) : (
        <>
          <div className="rounded border border-slate-700 bg-slate-900 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">
                  Local Windows Agent
                </div>
                <div className="text-xs text-slate-400">
                  Only this PC · 127.0.0.1:8081
                </div>
              </div>

              <span
                className={`text-sm font-bold ${
                  agentAuthorized
                    ? 'text-emerald-400'
                    : agentOnline
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {agentAuthorized
                  ? 'CONNECTED / AUTHORIZED'
                  : agentOnline
                  ? 'ONLINE / LOCKED'
                  : 'OFFLINE'}
              </span>
            </div>

            {!agentOnline && (
              <p className="text-sm text-slate-300">
                Start the agent on this Windows PC:{' '}
                <code>go run ./cmd/localagent</code>.
                Your browser may request permission to access local devices.
              </p>
            )}

            {agentOnline && !agentAuthorized && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Paste the access token shown by the local agent"
                  value={pairingToken}
                  onChange={(event) =>
                    setPairingToken(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handlePair();
                  }}
                  className="bg-slate-800 border border-slate-700 rounded p-2 text-sm flex-1"
                />

                <button
                  onClick={handlePair}
                  disabled={!pairingToken.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-4 py-2 text-sm font-bold"
                >
                  Authorize this browser
                </button>
              </div>
            )}

            {agentAuthorized && (
              <button
                onClick={handleDisconnect}
                disabled={isAutomating}
                className="self-start bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-2 rounded text-sm"
              >
                Disconnect browser
              </button>
            )}

            {agentError && (
              <div role="alert" className="text-rose-300 text-sm">
                {agentError}
              </div>
            )}
          </div>

          <div
            className={`sticky top-2 z-10 rounded border px-4 py-2 flex items-center gap-3 font-mono text-sm ${
              isAutomating
                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                : 'bg-slate-900 border-slate-800 text-slate-500'
            }`}
          >
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                isAutomating
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-slate-600'
              }`}
            />

            {isAutomating
              ? `ACTIVE — PID ${activeStatus.pid} · Task ${activeStatus.task_name}`
              : 'IDLE — no automation running'}
          </div>

          <fieldset
            disabled={!agentAuthorized}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4 bg-slate-900 p-4 rounded border border-slate-800 disabled:opacity-50"
          >
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold text-slate-300">
                Search Process by Name
              </label>

              <input
                type="text"
                placeholder="Type process name (e.g., Digimon)..."
                value={searchName}
                onChange={(event) => setSearchName(event.target.value)}
                className="bg-slate-800 text-slate-100 border border-slate-700 rounded p-2 text-sm"
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

            <div className="flex flex-col gap-3 border-t lg:border-t-0 lg:border-l border-slate-800 pt-4 lg:pt-0 lg:pl-4">
              <label className="text-sm font-semibold text-slate-300">
                Verify PID Directly
              </label>

              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Enter PID..."
                  value={manualPidInput}
                  onChange={(event) =>
                    setManualPidInput(event.target.value)
                  }
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
          </fieldset>

          <TaskManager
            tasks={tasks}
            onRefresh={loadTasks}
          />

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
                disabled={!agentAuthorized || isAutomating || busy}
                className="px-6 py-2 rounded font-bold text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500"
              >
                Start Automation
              </button>

              <button
                onClick={handleStop}
                disabled={!agentAuthorized || !isAutomating || busy}
                className="px-6 py-2 rounded font-bold text-sm bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500"
              >
                Stop Automation
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LogPanel logs={logs} />
            <WorkerLogPanel logs={workerLogs} />
          </div>
        </>
      )}
    </div>
  );
}
