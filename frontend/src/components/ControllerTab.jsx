
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  Plug,
  PlugZap,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';

// Cloud API: saved task profiles only.
import { fetchTasks } from '../services/api';

// Local Windows API: processes and automation.
import {
  authorizeLocalAgent,
  clearLocalAgentAuthorization,
  hasLocalAgentAuthorization,
  checkLocalAgent,
  fetchLocalProcesses,
  verifyLocalPID,
  fetchLocalAutomationStatus,
  fetchLocalAutomationLogs,
  startLocalJob,
  stopLocalJob,
} from '../services/localAgent';

import ProcessSelector from './ProcessSelector';
import CommandSelector from './CommandSelector';
import LogPanel from './LogPanel';
import WorkerLogPanel from './WorkerLogPanel';
import TaskManager from './TaskManager';

const LOCAL_AGENT_ADDRESS = 'http://127.0.0.1:8081';

export default function ControllerTab() {
  const [processes, setProcesses] = useState([]);
  const [tasks, setTasks] = useState([]);

  const [searchName, setSearchName] = useState('');
  const [selectedPid, setSelectedPid] = useState('');
  const [manualPidInput, setManualPidInput] = useState('');
  const [pidVerificationStatus, setPidVerificationStatus] =
    useState(null);

  const [selectedTaskId, setSelectedTaskId] = useState('');

  const [isAutomating, setIsAutomating] = useState(false);
  const [activeStatus, setActiveStatus] = useState(null);

  const [logs, setLogs] = useState([]);
  const [workerLogs, setWorkerLogs] = useState([]);

  // Agent connection.
  const [agentOnline, setAgentOnline] = useState(false);
  const [paired, setPaired] = useState(
    hasLocalAgentAuthorization()
  );
  const [accessTokenInput, setAccessTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');

  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [taskError, setTaskError] = useState('');

  const mountedRef = useRef(true);
  const pairingGeneration = useRef(0);
  const pollingRef = useRef(false);

  const addLog = useCallback((message) => {
    setLogs((previous) => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...previous,
    ].slice(0, 200));
  }, []);

  // --------------------------------------------------
  // Cloud task profiles
  // --------------------------------------------------

  const loadTasks = useCallback(async () => {
    try {
      const data = await fetchTasks();

      if (!mountedRef.current) return;

      setTasks(Array.isArray(data) ? data : []);
      setTaskError('');
    } catch (error) {
      if (!mountedRef.current) return;

      setTaskError(
        error?.response?.data?.error ||
        error?.message ||
        'Failed to load saved task profiles.'
      );
    }
  }, []);

  // --------------------------------------------------
  // Local agent availability
  // --------------------------------------------------

  const checkAgent = useCallback(async () => {
    try {
      const response = await checkLocalAgent();

      if (!mountedRef.current) return false;

      const online = response?.status === 'online';

      setAgentOnline(online);

      return online;
    } catch (error) {
      if (!mountedRef.current) return false;

      setAgentOnline(false);

      return false;
    }
  }, []);

  // --------------------------------------------------
  // Local processes
  // --------------------------------------------------

  const loadProcesses = useCallback(async (name = '') => {
    if (!hasLocalAgentAuthorization()) return;

    setLoadingProcesses(true);

    try {
      const response = await fetchLocalProcesses(name);

      if (!mountedRef.current) return;

      setProcesses(Array.isArray(response) ? response : []);
    } catch (error) {
      if (!mountedRef.current) return;

      setProcesses([]);

      addLog(
        `Failed to load local processes: ${error.message}`
      );
    } finally {
      if (mountedRef.current) {
        setLoadingProcesses(false);
      }
    }
  }, [addLog]);

  // --------------------------------------------------
  // Local automation status and logs
  // --------------------------------------------------

  const pollLocalStatus = useCallback(async () => {
    if (!hasLocalAgentAuthorization()) return;
    if (pollingRef.current) return;

    pollingRef.current = true;

    try {
      const status = await fetchLocalAutomationStatus();

      if (!mountedRef.current) return;

      setActiveStatus(status);
      setIsAutomating(Boolean(status?.is_running));

      if (status?.is_running) {
        const response = await fetchLocalAutomationLogs();

        if (mountedRef.current) {
          setWorkerLogs(
            Array.isArray(response?.logs) ? response.logs : []
          );
        }
      }
    } catch (error) {
      if (!mountedRef.current) return;

      // A failed status request does not prove the
      // automation has stopped. Preserve its last status.
      setConnectionError(
        `Unable to reach the local agent: ${error.message}`
      );
    } finally {
      pollingRef.current = false;
    }
  }, []);

  // --------------------------------------------------
  // Pairing
  // --------------------------------------------------

  const connect = async (event) => {
    event.preventDefault();

    const token = accessTokenInput.trim();

    if (!token) {
      setConnectionError('Enter the local access token.');
      return;
    }

    setConnecting(true);
    setConnectionError('');

    // Invalidate older pairing attempts.
    const generation = ++pairingGeneration.current;

    authorizeLocalAgent(token);

    try {
      // Health checks availability, not authentication.
      await checkLocalAgent();

      // This protected endpoint verifies the Bearer token.
      const status = await fetchLocalAutomationStatus();

      if (
        !mountedRef.current ||
        generation !== pairingGeneration.current
      ) {
        return;
      }

      setPaired(true);
      setAgentOnline(true);
      setActiveStatus(status);
      setIsAutomating(Boolean(status?.is_running));

      // Do not keep the token in the visible form.
      setAccessTokenInput('');
      setShowToken(false);

      addLog('Connected to the local Windows agent.');

      await loadProcesses(searchName);
    } catch (error) {
      if (generation !== pairingGeneration.current) return;

      clearLocalAgentAuthorization();

      setPaired(false);
      setAgentOnline(false);

      setConnectionError(
        `Connection failed: ${error.message}. ` +
        'Check the token, local agent and FRONTEND_ORIGIN.'
      );
    } finally {
      if (
        mountedRef.current &&
        generation === pairingGeneration.current
      ) {
        setConnecting(false);
      }
    }
  };

  const disconnect = () => {
    ++pairingGeneration.current;

    clearLocalAgentAuthorization();

    setPaired(false);
    setAgentOnline(false);
    setAccessTokenInput('');
    setConnectionError('');
    setProcesses([]);
    setSelectedPid('');
    setManualPidInput('');
    setPidVerificationStatus(null);
    setActiveStatus(null);
    setIsAutomating(false);
    setWorkerLogs([]);

    addLog('Disconnected from the local agent.');
  };

  // --------------------------------------------------
  // Initial loading
  // --------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    loadTasks();
    checkAgent();

    return () => {
      mountedRef.current = false;
    };
  }, [loadTasks, checkAgent]);

  // Poll only while paired.
  useEffect(() => {
    if (!paired) return undefined;

    pollLocalStatus();

    const interval = window.setInterval(() => {
      if (!document.hidden) {
        pollLocalStatus();
      }
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [paired, pollLocalStatus]);

  // Search local processes after pairing.
  useEffect(() => {
    if (!paired) return undefined;

    const timer = window.setTimeout(() => {
      loadProcesses(searchName);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [paired, searchName, loadProcesses]);

  // --------------------------------------------------
  // Verify PID locally
  // --------------------------------------------------

  const verify = async () => {
    if (!paired) {
      addLog('Connect to the local agent first.');
      return;
    }

    const pid = Number(manualPidInput);

    if (!Number.isInteger(pid) || pid <= 0) {
      setPidVerificationStatus({
        valid: false,
        text: 'Enter a valid PID.',
      });
      return;
    }

    try {
      const response = await verifyLocalPID(pid);

      if (response?.exists) {
        setSelectedPid(String(response.pid));

        setPidVerificationStatus({
          valid: true,
          text: `Active PID: ${response.pid} (${response.name})`,
        });
      } else {
        setPidVerificationStatus({
          valid: false,
          text: 'Process not found on this computer.',
        });
      }
    } catch (error) {
      setPidVerificationStatus({
        valid: false,
        text: `Verification failed: ${error.message}`,
      });
    }
  };

  // --------------------------------------------------
  // Start / stop local automation
  // --------------------------------------------------

  const start = async () => {
    if (!paired) {
      addLog('Connect to the local agent first.');
      return;
    }

    if (!selectedPid || !selectedTaskId) {
      addLog('Select a process and task profile first.');
      return;
    }

    try {
      await startLocalJob({
        pid: Number(selectedPid),
        task_id: Number(selectedTaskId),
      });

      addLog(
        `Started local automation for PID ${selectedPid}.`
      );

      await pollLocalStatus();
    } catch (error) {
      addLog(`Failed to start automation: ${error.message}`);
    }
  };

  const stop = async () => {
    if (!paired) return;

    try {
      await stopLocalJob();

      addLog('Local automation stopped.');

      await pollLocalStatus();
    } catch (error) {
      addLog(`Failed to stop automation: ${error.message}`);
    }
  };

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="space-y-5">

      {/* Page heading */}
      <div className="terminal-card p-5">
        <h2 className="text-xl font-semibold">
          Desktop Automation
        </h2>

        <p className="mt-1 text-sm text-slate-400">
          Control Windows processes through your local Go agent.
          Your cloud API is used only for saved task profiles.
        </p>
      </div>

      {/* Local agent pairing */}
      <div className="terminal-card space-y-4 p-5">

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              <Plug size={18} className="text-cyan-400" />
              Local Agent Connection
            </h3>

            <p className="mt-1 text-xs text-slate-400">
              {LOCAL_AGENT_ADDRESS}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                paired
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : agentOnline
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-slate-500/10 text-slate-400'
              }`}
            >
              {paired
                ? 'Paired'
                : agentOnline
                  ? 'Agent detected'
                  : 'Not connected'}
            </span>

            <button
              type="button"
              onClick={checkAgent}
              className="terminal-button-secondary"
              title="Check local agent"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        {!paired ? (
          <form onSubmit={connect} className="space-y-3">
            <p className="text-sm text-slate-400">
              Start the local Go agent on this computer,
              then paste the access token shown in its terminal.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <input
                  type={showToken ? 'text' : 'password'}
                  className="terminal-input w-full pr-12"
                  placeholder="Local access token"
                  value={accessTokenInput}
                  onChange={(event) =>
                    setAccessTokenInput(event.target.value)
                  }
                  autoComplete="off"
                  spellCheck={false}
                />

                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  aria-label={
                    showToken ? 'Hide token' : 'Show token'
                  }
                >
                  {showToken
                    ? <EyeOff size={17} />
                    : <Eye size={17} />}
                </button>
              </div>

              <button
                type="submit"
                className="terminal-button"
                disabled={connecting || !accessTokenInput.trim()}
              >
                <PlugZap size={16} />
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>

            {connectionError && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-400">
                <ShieldAlert size={17} className="mt-0.5 shrink-0" />
                <span>{connectionError}</span>
              </div>
            )}

            <p className="text-xs text-slate-500">
              The token is kept in JavaScript memory only.
              Refreshing the page requires pairing again.
            </p>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <ShieldCheck size={18} />
              Connected to your local Windows agent
            </div>

            <button
              type="button"
              onClick={disconnect}
              className="terminal-button-secondary"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Automation status */}
      <div
        className={`terminal-card p-4 text-sm ${
          isAutomating
            ? 'text-emerald-400'
            : 'text-slate-400'
        }`}
      >
        {!paired
          ? 'DISCONNECTED — Pair with your local agent'
          : isAutomating
            ? `ACTIVE — PID ${activeStatus?.pid} · ${activeStatus?.task_name}`
            : 'IDLE — no automation running'}
      </div>

      {/* Process selection and PID verification */}
      <div className="grid gap-4 lg:grid-cols-2">

        <div className="terminal-card space-y-3 p-5">
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-300">
              Search Local Process
            </label>

            <button
              type="button"
              onClick={() => loadProcesses(searchName)}
              disabled={!paired || loadingProcesses}
              className="text-cyan-400 disabled:opacity-40"
              title="Refresh local processes"
            >
              <RefreshCw
                size={16}
                className={
                  loadingProcesses ? 'animate-spin' : ''
                }
              />
            </button>
          </div>

          <input
            className="terminal-input"
            value={searchName}
            onChange={(event) =>
              setSearchName(event.target.value)
            }
            placeholder="Process name..."
            disabled={!paired}
          />

          <div className={!paired ? 'pointer-events-none opacity-50' : ''}>
            <ProcessSelector
              processes={processes}
              selectedPid={selectedPid}
              onSelect={(pid) => {
                setSelectedPid(String(pid));
                setManualPidInput(String(pid));
                setPidVerificationStatus(null);
              }}
            />
          </div>
        </div>

        <div className="terminal-card space-y-3 p-5">
          <label className="text-sm text-slate-300">
            Verify Local PID
          </label>

          <div className="flex gap-2">
            <input
              className="terminal-input"
              type="number"
              value={manualPidInput}
              onChange={(event) =>
                setManualPidInput(event.target.value)
              }
              placeholder="PID"
              disabled={!paired}
            />

            <button
              type="button"
              className="terminal-button"
              onClick={verify}
              disabled={!paired}
            >
              Verify
            </button>
          </div>

          {pidVerificationStatus && (
            <p
              className={`text-xs ${
                pidVerificationStatus.valid
                  ? 'text-emerald-400'
                  : 'text-rose-400'
              }`}
            >
              {pidVerificationStatus.text}
            </p>
          )}
        </div>
      </div>

      {/* Saved task profiles still use Cloud Run */}
      <div className="space-y-3">
        {taskError && (
          <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-400">
            Cloud task profiles: {taskError}
          </p>
        )}

        <TaskManager
          tasks={tasks}
          onRefresh={loadTasks}
        />
      </div>

      {/* Automation execution */}
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
            type="button"
            className="terminal-button"
            disabled={
              !paired ||
              isAutomating ||
              !selectedPid ||
              !selectedTaskId
            }
            onClick={start}
          >
            Start
          </button>

          <button
            type="button"
            className="terminal-button-secondary"
            disabled={!paired || !isAutomating}
            onClick={stop}
          >
            Stop
          </button>
        </div>
      </div>

      {/* Logs */}
      <div className="grid gap-4 lg:grid-cols-2">
        <LogPanel logs={logs} />
        <WorkerLogPanel logs={workerLogs} />
      </div>
    </div>
  );
}
