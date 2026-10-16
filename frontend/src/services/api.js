
import axios from 'axios';

const API = axios.create({
  baseURL: '/api/v1',
});

export const fetchProcesses = async (nameQuery = '') =>
  (await API.get('/processes', {
    params: nameQuery ? { name: nameQuery } : {},
  })).data;

export const verifyPID = async (pid) =>
  (await API.get(`/processes/verify/${pid}`)).data;

export const fetchTasks = async () =>
  (await API.get('/tasks')).data;

export const createTask = async (payload) =>
  (await API.post('/tasks', payload)).data;

export const updateTask = async (id, payload) =>
  (await API.put(`/tasks/${id}`, payload)).data;

export const deleteTask = async (id) =>
  (await API.delete(`/tasks/${id}`)).data;

export const fetchAutomationStatus = async () =>
  (await API.get('/automation/status')).data;

export const fetchAutomationLogs = async () =>
  (await API.get('/automation/logs')).data;

export const startJob = async (payload) =>
  (await API.post('/automation/start', payload)).data;

export const stopJob = async () =>
  (await API.post('/automation/stop')).data;

export const fetchNotes = async () =>
  (await API.get('/notes')).data;

export const createNote = async (content) =>
  (await API.post('/notes', { content })).data;

export const updateNote = async (id, payload) =>
  (await API.put(`/notes/${id}`, payload)).data;

export const deleteNote = async (id) =>
  (await API.delete(`/notes/${id}`)).data;

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

export const updateBuyingPower = async (value) =>
  (await API.put('/portfolio/buyingPower', {
    buying_power: Number(value),
  })).data;

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

export const processMarketDocument = async (file) => {
  const formData = new FormData();
  formData.append('file', file);

  return (await API.post('/market/documents', formData, {
    timeout: 300_000,
  })).data;
};

export const fetchMarketQuotes = async (symbols) => {
  const unique = [
    ...new Set(
      (symbols || [])
        .map((symbol) => String(symbol).trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  if (!unique.length) return { quotes: {}, errors: {} };

  return (await API.get('/market/quotes', {
    params: { symbols: unique.join(',') },
  })).data;
};
