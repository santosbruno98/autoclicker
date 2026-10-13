
import axios from 'axios';

const API = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
  },
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.dispatchEvent(new Event('auth:expired'));
    }
    return Promise.reject(error);
  }
);

// Process APIs
export const fetchProcesses = async (nameQuery = '') => {
  const url = nameQuery
    ? `/processes?name=${encodeURIComponent(nameQuery)}`
    : '/processes';
  return (await API.get(url)).data;
};

export const verifyPID = async (pid) =>
  (await API.get(`/processes/verify/${pid}`)).data;

// Task APIs
export const fetchTasks = async () =>
  (await API.get('/tasks')).data;

export const createTask = async (payload) =>
  (await API.post('/tasks', payload)).data;

export const updateTask = async (id, payload) =>
  (await API.put(`/tasks/${id}`, payload)).data;

export const deleteTask = async (id) =>
  (await API.delete(`/tasks/${id}`)).data;

// Automation APIs
export const fetchAutomationStatus = async () =>
  (await API.get('/automation/status')).data;

export const fetchAutomationLogs = async () =>
  (await API.get('/automation/logs')).data;

export const startJob = async (payload) =>
  (await API.post('/automation/start', payload)).data;

export const stopJob = async () =>
  (await API.post('/automation/stop')).data;

// Notes APIs
export const fetchNotes = async () =>
  (await API.get('/notes')).data;

export const createNote = async (content) =>
  (await API.post('/notes', { content })).data;

export const updateNote = async (id, payload) =>
  (await API.put(`/notes/${id}`, payload)).data;

export const deleteNote = async (id) =>
  (await API.delete(`/notes/${id}`)).data;

// Portfolio APIs
export const fetchHoldings = async () =>
  (await API.get('/portfolio/holdings')).data;

export const createHolding = async (payload) =>
  (await API.post('/portfolio/holdings', payload)).data;

export const updateHolding = async (id, payload) =>
  (await API.put(`/portfolio/holdings/${id}`, payload)).data;

export const deleteHolding = async (id) =>
  (await API.delete(`/portfolio/holdings/${id}`)).data;

export const fetchPortfolioSummary = async () =>
  (await API.get('/portfolio/summary')).data;

export const fetchPortfolioHistory = async () =>
  (await API.get('/portfolio/history')).data;

export const fetchBuyingPower = async () =>
  (await API.get('/portfolio/buyingPower')).data;

export const updateBuyingPower = async (buyingPower) =>
  (
    await API.put('/portfolio/buyingPower', {
      buying_power: parseFloat(buyingPower),
    })
  ).data;

// Alerts APIs
export const fetchThresholds = async () =>
  (await API.get('/portfolio/thresholds')).data;

export const fetchThreshold = async (id) =>
  (await API.get(`/portfolio/thresholds/${id}`)).data;

export const createThreshold = async (payload) =>
  (await API.post('/portfolio/thresholds', payload)).data;

export const updateThreshold = async (id, payload) =>
  (await API.put(`/portfolio/thresholds/${id}`, payload)).data;

export const deleteThreshold = async (id) =>
  (await API.delete(`/portfolio/thresholds/${id}`)).data;

// Market APIs
export const processMarketDocument = async (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return (await API.post('/market/documents', formData)).data;
};

export const fetchMarketQuotes = async (symbols) => {
  if (!symbols || symbols.length === 0) {
    return { quotes: {} };
  }

  const uniqueSymbols = [
    ...new Set(
      symbols
        .map((symbol) => String(symbol).trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  if (uniqueSymbols.length === 0) {
    return { quotes: {} };
  }

  return (
    await API.get('/market/quotes', {
      params: { symbols: uniqueSymbols.join(',') },
    })
  ).data;
};

// Dividend APIs
export const fetchDividends = async () =>
  (await API.get('/portfolio/dividends')).data;

export const createDividend = async (payload) =>
  (await API.post('/portfolio/dividends', payload)).data;

export const updateDividend = async (id, payload) =>
  (await API.put(`/portfolio/dividends/${id}`, payload)).data;

export const deleteDividend = async (id) =>
  (await API.delete(`/portfolio/dividends/${id}`)).data;


export const fetchPortfolioDividends = async (forceRefresh = false) => {
  const response = await API.get('/portfolio/dividends', {
    params: forceRefresh ? { refresh: 'true' } : {},
  });

  return response.data;
};
