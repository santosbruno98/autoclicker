import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

import { API } from './http';

export const PlannerIdentity = createContext(null);

const stores = new Map();
let databasePromise;

function database() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(
        'myplatform-route-planner',
        1
      );

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('records')) {
          db.createObjectStore('records');
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          databasePromise = undefined;
        };

        resolve(db);
      };

      request.onerror = () => {
        reject(
          request.error ||
          new Error('Cannot open device storage')
        );
      };
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }

  return databasePromise;
}

export async function readDevice(key) {
  const db = await database();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      'records',
      'readonly'
    );

    const request = transaction
      .objectStore('records')
      .get(key);

    transaction.oncomplete = () => {
      resolve(request.result ?? null);
    };

    transaction.onabort = () => {
      reject(
        transaction.error ||
        new Error('Device storage read failed')
      );
    };
  });
}

async function editDevice(key, change) {
  const db = await database();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      'records',
      'readwrite'
    );

    const objectStore = transaction.objectStore('records');
    const request = objectStore.get(key);

    let next;
    let failure;

    request.onsuccess = () => {
      try {
        next = change(request.result ?? null);

        if (next == null) {
          objectStore.delete(key);
        } else {
          objectStore.put(next, key);
        }
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };

    transaction.oncomplete = () => resolve(next);

    transaction.onabort = () => {
      reject(
        failure ||
        transaction.error ||
        new Error('Device storage write failed')
      );
    };
  });
}

export function rememberPlannerUser(user) {
  return editDevice(
    'identity',
    () => user
      ? {
          user_id: user.user_id,
          email: user.email,
        }
      : null
  );
}

export function lastPlannerUser() {
  return readDevice('identity');
}

export function readPlanner(userId) {
  return readDevice(`planner:${userId}`);
}

export function emptyPlanner() {
  return {
    schema: 1,
    origin: null,
    originError: '',

    // Null preserves compatibility with legacy snapshots.
    // The page migrates old complete/incomplete records for review.
    services: null,

    complete: [],
    incomplete: [],
    corrections: {},

    plans: [],
    selectedId: null,
    tab: 'complete',

    screenshotCount: 0,
    phase: 'idle',
    error: '',
  };
}

function restoredState(state) {
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    state.schema !== 1
  ) {
    throw new Error('Unsupported saved planner format');
  }

  const next = {
    ...emptyPlanner(),
    ...state,
    complete: Array.isArray(state.complete)
      ? state.complete
      : [],
    incomplete: Array.isArray(state.incomplete)
      ? state.incomplete
      : [],
    plans: Array.isArray(state.plans)
      ? state.plans
      : [],
    services: Array.isArray(state.services)
      ? state.services
      : null,
    corrections:
      state.corrections &&
      typeof state.corrections === 'object' &&
      !Array.isArray(state.corrections)
        ? state.corrections
        : {},
  };

  if (['extracting', 'optimizing'].includes(next.phase)) {
    next.phase = 'interrupted';
    next.error =
      'Processing was interrupted. Saved addresses and routes remain. ' +
      'Retry the operation explicitly when connected.';
  }

  return next;
}

function fromCloud(snapshot) {
  if (!snapshot) return null;

  if (
    typeof snapshot.version !== 'string' ||
    !snapshot.version
  ) {
    throw new Error('Cloud snapshot has no version');
  }

  return {
    version: snapshot.version,
    updated_at: snapshot.updated_at,
    state: restoredState(snapshot.state),
    baseVersion: snapshot.version,
    dirty: false,
  };
}

function newVersion() {
  return crypto.randomUUID();
}

export class PlannerStore {
  constructor(userId) {
    this.key = `planner:${userId}`;
    this.listeners = new Set();

    this.remote = false;
    this.disposed = false;
    this.syncing = false;
    this.again = false;

    this.timer = null;
    this.opening = null;
    this.writes = Promise.resolve();

    this.view = {
      phase: 'loading',
      record: null,
      candidate: null,
      cloud: null,
      cloudAvailable: false,
      conflict: null,
      fresh: false,
      status: 'Loading saved journey…',
      error: '',
    };
  }

  subscribe = (listener) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.view;

  emit(patch) {
    if (this.disposed) return;

    this.view = {
      ...this.view,
      ...patch,
    };

    for (const listener of this.listeners) {
      listener();
    }
  }

  setRemote(allowed) {
    this.remote = Boolean(allowed) && !this.disposed;

    if (!this.remote) {
      clearTimeout(this.timer);
    }
  }

  dispose() {
    this.remote = false;
    this.disposed = true;
    clearTimeout(this.timer);
  }

  schedule() {
    clearTimeout(this.timer);

    if (
      !this.disposed &&
      this.remote &&
      navigator.onLine &&
      !this.view.conflict &&
      this.view.phase === 'active'
    ) {
      this.timer = setTimeout(() => {
        void this.sync();
      }, 500);
    }
  }

  open() {
    if (!this.opening) {
      this.opening = this.load();
    }

    return this.opening;
  }

  async load() {
    try {
      const local = await readDevice(this.key);

      if (this.disposed) return;

      if (!this.remote || !navigator.onLine) {
        if (local) {
          this.emit({
            phase: 'active',
            record: {
              ...local,
              state: restoredState(local.state),
            },
            status: 'Saved journey · local copy',
          });
        } else {
          this.emit({
            phase: 'choice',
            candidate: null,
            status: 'No saved journey on this device',
          });
        }

        return;
      }

      let cloud = null;
      let available = true;

      try {
        const response = await API.get(
          '/route-planner/state',
          { timeout: 10000 }
        );

        cloud = response.data.snapshot ?? null;

        // Validate the snapshot before offering it for restoration.
        if (cloud) fromCloud(cloud);
      } catch {
        available = false;
        cloud = null;
      }

      if (this.disposed) return;

      const candidate = local?.dirty
        ? local
        : fromCloud(cloud) || local;

      this.emit({
        phase: 'choice',
        candidate,
        cloud,
        cloudAvailable: available,
        status: available
          ? 'Choose whether to restore your previous journey'
          : 'Cloud unavailable; the saved device copy is available',
      });

      if (!candidate && available) {
        await this.startNew();
      }
    } catch (error) {
      this.emit({
        phase: 'error',
        error: `Cannot load saved planner: ${error.message}`,
      });
    }
  }

  async install(record, fresh = false) {
    await this.writes;

    if (this.disposed) return;

    const normalized = {
      ...record,
      state: restoredState(record.state),
    };

    await editDevice(this.key, () => normalized);

    if (this.disposed) return;

    this.emit({
      phase: 'active',
      record: normalized,
      candidate: null,
      conflict: null,
      fresh,
      error: '',
      status: normalized.dirty
        ? 'Saved on this device · waiting to sync'
        : 'Saved journey restored',
    });

    this.schedule();
  }

  async continuePrevious() {
    let record = this.view.candidate;
    if (!record) return;

    record = {
      ...record,
      state: restoredState(record.state),
    };

    // Redis expired, but this device still has a clean local copy.
    // Re-upload only after the user explicitly restores it.
    if (
      this.view.cloudAvailable &&
      !this.view.cloud &&
      !record.dirty
    ) {
      record = {
        ...record,
        baseVersion: '',
        version: newVersion(),
        dirty: true,
      };
    }

    await this.install(record);
  }

  async startNew() {
    await this.writes;

    const previous =
      this.view.record || this.view.candidate;

    // An active record may have synchronized since the page loaded.
    // Its current base version takes precedence over initial metadata.
    const baseVersion = this.view.record
      ? this.view.record.baseVersion || ''
      : this.view.cloudAvailable
        ? this.view.cloud?.version || ''
        : previous?.baseVersion || '';

    const previousState = previous?.state;
    const corrections =
      previousState?.corrections &&
      typeof previousState.corrections === 'object'
        ? previousState.corrections
        : {};

    await this.install(
      {
        state: {
          ...emptyPlanner(),
          corrections,
        },
        baseVersion,
        version: newVersion(),
        updated_at: new Date().toISOString(),
        dirty: true,
      },
      true
    );
  }

  consumeFresh() {
    if (!this.view.fresh) return false;

    this.emit({ fresh: false });
    return true;
  }

  change(change) {
    if (this.disposed || !this.view.record) {
      return Promise.reject(
        new Error('Planner is not available')
      );
    }

    const expectedVersion = this.view.record.version;

    const nextState = typeof change === 'function'
      ? change(this.view.record.state)
      : change;

    if (!nextState || nextState.schema !== 1) {
      return Promise.reject(
        new Error('Invalid planner state')
      );
    }

    const version = newVersion();
    const updatedAt = new Date().toISOString();

    this.emit({
      record: {
        ...this.view.record,
        state: nextState,
        version,
        updated_at: updatedAt,
        dirty: true,
      },
      status: 'Saving on this device…',
    });

    const write = this.writes.then(() =>
      editDevice(this.key, (current) => {
        if (current?.version !== expectedVersion) {
          throw new Error(
            'Another tab changed this journey. ' +
            'Reload to restore the latest device copy.'
          );
        }

        return {
          ...current,
          state: nextState,
          version,
          updated_at: updatedAt,
          dirty: true,
        };
      })
    );

    this.writes = write.catch(() => {});

    return write
      .then((record) => {
        if (this.view.record?.version === version) {
          this.emit({
            record,
            status: 'Saved on this device · waiting to sync',
          });
        }

        this.schedule();
        return record;
      })
      .catch((error) => {
        this.emit({
          phase: 'error',
          error: `Could not save on this device: ${error.message}`,
        });

        throw error;
      });
  }

  async sync() {
    if (
      this.disposed ||
      this.syncing ||
      !this.remote ||
      !navigator.onLine ||
      this.view.conflict ||
      this.view.phase !== 'active'
    ) {
      return;
    }

    this.syncing = true;

    try {
      await this.writes;

      const sent = await readDevice(this.key);

      if (
        !sent?.dirty ||
        this.disposed ||
        !this.remote
      ) {
        return;
      }

      this.emit({
        status: 'Synchronizing with Upstash…',
      });

      const response = await API.put(
        '/route-planner/state',
        {
          expected_version: sent.baseVersion || '',
          version: sent.version,
          state: sent.state,
        },
        { timeout: 12000 }
      );

      if (this.disposed) return;

      const cloud = response.data.snapshot;

      if (!cloud || cloud.version !== sent.version) {
        throw new Error('Invalid planner save response');
      }

      await editDevice(this.key, (current) => {
        if (
          !current ||
          (
            current.baseVersion !== sent.baseVersion &&
            current.version !== sent.version
          )
        ) {
          return current;
        }

        return {
          ...current,
          baseVersion: cloud.version,
          dirty: current.version !== sent.version,
          updated_at: current.version === sent.version
            ? cloud.updated_at
            : current.updated_at,
        };
      });

      await this.writes;

      const latest = await readDevice(this.key);

      if (
        latest &&
        this.view.record?.version === latest.version
      ) {
        this.emit({
          record: latest,
          cloud,
          cloudAvailable: true,
          error: '',
          status: latest.dirty
            ? 'More device changes waiting to sync'
            : 'Saved to Upstash · retained for 24 hours after this save',
        });
      }

      if (latest?.dirty) {
        this.again = true;
      }
    } catch (error) {
      if (this.disposed) return;

      if (error.response?.status === 409) {
        this.emit({
          conflict: {
            snapshot: error.response.data.snapshot ?? null,
          },
          status:
            'A newer cloud copy exists. Choose which copy to keep.',
        });
      } else if (error.response?.status === 401) {
        this.emit({
          status:
            'Saved on this device · sign in again to synchronize',
        });

        if (this.remote) {
          window.dispatchEvent(new Event('auth:expired'));
        }
      } else {
        this.emit({
          status:
            'Saved on this device · synchronization pending',
          error:
            error.response?.data?.error ||
            'Cloud connection unavailable. Your local copy is retained.',
        });
      }
    } finally {
      this.syncing = false;

      if (this.again && !this.disposed) {
        this.again = false;
        this.schedule();
      }
    }
  }

  async useCloud() {
    if (!this.view.conflict) return;

    const snapshot = this.view.conflict.snapshot;

    if (snapshot) {
      await this.install(fromCloud(snapshot));

      this.emit({
        cloud: snapshot,
        cloudAvailable: true,
      });
    } else {
      await this.install({
        state: emptyPlanner(),
        baseVersion: '',
        version: newVersion(),
        updated_at: new Date().toISOString(),
        dirty: true,
      });

      this.emit({
        cloud: null,
        cloudAvailable: true,
      });
    }
  }

  async keepDevice() {
    if (!this.view.conflict) return;

    await this.writes;

    const current = await readDevice(this.key);
    if (!current) {
      throw new Error('No saved device copy is available');
    }

    await this.install({
      ...current,
      baseVersion:
        this.view.conflict.snapshot?.version || '',
      version: newVersion(),
      updated_at: new Date().toISOString(),
      dirty: true,
    });
  }
}

export function resetPlannerSession() {
  for (const store of stores.values()) {
    store.dispose();
  }

  stores.clear();
}

export function usePlanner() {
  const identity = useContext(PlannerIdentity);

  const store = useMemo(() => {
    if (!identity?.user_id) {
      throw new Error('Planner identity missing');
    }

    if (!stores.has(identity.user_id)) {
      stores.set(
        identity.user_id,
        new PlannerStore(identity.user_id)
      );
    }

    return stores.get(identity.user_id);
  }, [identity?.user_id]);

  const view = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot
  );

  useEffect(() => {
    store.setRemote(!identity.localOnly);
    void store.open();

    const sync = () => {
      void store.sync();
    };

    const visible = () => {
      if (document.visibilityState === 'visible') {
        sync();
      }
    };

    const timer = setInterval(sync, 30000);

    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', visible);

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', visible);
      store.setRemote(false);
    };
  }, [store, identity.localOnly]);

  return {
    store,
    view,
    identity,
  };
}