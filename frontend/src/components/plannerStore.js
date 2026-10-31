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
        request.result.createObjectStore('records');
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return databasePromise;
}

export async function readDevice(key) {
  const db = await database();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readonly');
    const request = tx.objectStore('records').get(key);

    tx.oncomplete = () => resolve(request.result ?? null);

    tx.onabort = () => reject(
      tx.error || new Error('Device storage read failed')
    );
  });
}

async function editDevice(key, change) {
  const db = await database();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    const objectStore = tx.objectStore('records');
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
        tx.abort();
      }
    };

    tx.oncomplete = () => resolve(next);

    tx.onabort = () => reject(
      failure ||
      tx.error ||
      new Error('Device storage write failed')
    );
  });
}

export const rememberPlannerUser = (user) =>
  editDevice(
    'identity',
    () => user && ({
      user_id: user.user_id,
      email: user.email,
    })
  );

export const lastPlannerUser = () =>
  readDevice('identity');

export const readPlanner = (id) =>
  readDevice(`planner:${id}`);

export function emptyPlanner() {
  return {
    schema: 1,
    origin: null,
    complete: [],
    incomplete: [],
    plans: [],
    selectedId: null,
    tab: 'complete',
    screenshotCount: 0,
    phase: 'idle',
    error: '',
  };
}

function restoredState(state) {
  const next = {
    ...emptyPlanner(),
    ...state,
  };

  if (['extracting', 'optimizing'].includes(next.phase)) {
    next.phase = 'interrupted';
    next.error =
      'Processing was interrupted. Select screenshots again or ' +
      'explicitly regenerate; saved results have been preserved.';
  }

  return next;
}

const fromCloud = (snapshot) =>
  snapshot && ({
    ...snapshot,
    baseVersion: snapshot.version,
    dirty: false,
  });

const newVersion = () => crypto.randomUUID();

export class PlannerStore {
  constructor(id) {
    this.key = `planner:${id}`;
    this.listeners = new Set();
    this.remote = false;
    this.writes = Promise.resolve();

    this.view = {
      phase: 'loading',
      record: null,
      candidate: null,
      cloud: null,
      conflict: null,
      status: 'Loading saved journey…',
      error: '',
      fresh: false,
    };
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.view;

  emit(patch) {
    this.view = {
      ...this.view,
      ...patch,
    };

    for (const listener of this.listeners) {
      listener();
    }
  }

  setRemote(allowed) {
    this.remote = allowed;

    if (!allowed) {
      clearTimeout(this.timer);
    }
  }

  schedule() {
    clearTimeout(this.timer);

    if (
      this.remote &&
      navigator.onLine &&
      !this.view.conflict
    ) {
      this.timer = setTimeout(() => this.sync(), 500);
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

        cloud = response.data.snapshot;
      } catch {
        available = false;
      }

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
        error: `Device storage unavailable: ${error.message}`,
      });
    }
  }

  async install(record, fresh = false) {
    await this.writes;
    await editDevice(this.key, () => record);

    this.emit({
      phase: 'active',
      record,
      candidate: null,
      conflict: null,
      fresh,
      error: '',
      status: record.dirty
        ? 'Saved on this device · waiting to sync'
        : 'Saved journey restored',
    });

    this.schedule();
  }

  async continuePrevious() {
    let record = this.view.candidate;

    if (!record) {
      return;
    }

    record = {
      ...record,
      state: restoredState(record.state),
    };

    // The cloud copy expired, but the device still has it.
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
    const cloud = this.view.cloud;
    const previous =
      this.view.record || this.view.candidate;

    const baseVersion = this.view.cloudAvailable
      ? cloud?.version || ''
      : previous?.baseVersion || '';

    await this.install(
      {
        state: emptyPlanner(),
        baseVersion,
        version: newVersion(),
        updated_at: new Date().toISOString(),
        dirty: true,
      },
      true
    );
  }

  consumeFresh() {
    if (!this.view.fresh) {
      return false;
    }

    this.emit({ fresh: false });
    return true;
  }

  change(change) {
    if (!this.view.record) {
      return Promise.reject(
        new Error('Planner is not loaded')
      );
    }

    const expected = this.view.record.version;

    const state = typeof change === 'function'
      ? change(this.view.record.state)
      : change;

    const version = newVersion();
    const updated_at = new Date().toISOString();

    this.emit({
      record: {
        ...this.view.record,
        state,
        version,
        updated_at,
        dirty: true,
      },
      status: 'Saving on this device…',
    });

    const write = this.writes.then(() =>
      editDevice(this.key, (current) => {
        if (current?.version !== expected) {
          throw new Error(
            'Another tab changed this journey. ' +
            'Reload to restore the latest device copy.'
          );
        }

        return {
          ...current,
          state,
          version,
          updated_at,
          dirty: true,
        };
      })
    );

    this.writes = write.catch(() => {});

    return write
      .then((record) => {
        if (this.view.record.version === version) {
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

      if (!sent?.dirty) {
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

      const cloud = response.data.snapshot;

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
          status: latest.dirty
            ? 'More device changes waiting to sync'
            : 'Saved to Upstash · retained for 24 hours after this save',
        });
      }

      if (latest?.dirty) {
        this.again = true;
      }
    } catch (error) {
      if (error.response?.status === 409) {
        this.emit({
          conflict: {
            snapshot: error.response.data.snapshot,
          },
          status:
            'A newer cloud copy exists. Choose which copy to keep.',
        });
      } else if (error.response?.status === 401) {
        this.emit({
          status:
            'Saved on this device · sign in again to synchronize',
        });

        window.dispatchEvent(
          new Event('auth:expired')
        );
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

      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }

  async useCloud() {
    const snapshot = this.view.conflict?.snapshot;

    if (snapshot) {
      await this.install({
        ...fromCloud(snapshot),
        state: restoredState(snapshot.state),
      });
    } else {
      await this.install({
        state: emptyPlanner(),
        baseVersion: '',
        version: newVersion(),
        updated_at: new Date().toISOString(),
        dirty: true,
      });
    }
  }

  async keepDevice() {
    const current = await readDevice(this.key);

    await this.install({
      ...current,
      baseVersion:
        this.view.conflict?.snapshot?.version || '',
      version: newVersion(),
      dirty: true,
    });
  }
}

export function resetPlannerSession() {
  for (const store of stores.values()) {
    store.setRemote(false);
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
    store.open();

    const sync = () => store.sync();

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
      document.removeEventListener(
        'visibilitychange',
        visible
      );
      store.setRemote(false);
    };
  }, [store, identity.localOnly]);

  return {
    store,
    view,
    identity,
  };
}