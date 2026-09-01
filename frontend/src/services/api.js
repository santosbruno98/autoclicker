import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:8080/api/v1',
});

// Process APIs
export const fetchProcesses = async (nameQuery = '') => {
  const url = nameQuery ? `/processes?name=${encodeURIComponent(nameQuery)}` : '/processes';
  return (await API.get(url)).data;
};

export const verifyPID = async (pid) => {
  return (await API.get(`/processes/verify/${pid}`)).data;
};

// Task CRUD APIs
export const fetchTasks = async () => (await API.get('/tasks')).data;
export const createTask = async (taskData) => (await API.post('/tasks', taskData)).data;
export const updateTask = async (id, taskData) => (await API.put(`/tasks/${id}`, taskData)).data;
export const deleteTask = async (id) => (await API.delete(`/tasks/${id}`)).data;

// Automation Controls
export const fetchAutomationStatus = async () => (await API.get('/automation/status')).data;
export const fetchAutomationLogs = async () => (await API.get('/automation/logs')).data;
export const startJob = async (payload) => (await API.post('/automation/start', payload)).data;
export const stopJob = async () => (await API.post('/automation/stop')).data;

// Notes / Checklist APIs (separate SQLite-backed store)
export const fetchNotes = async () => (await API.get('/notes')).data;
export const createNote = async (content) => (await API.post('/notes', { content })).data;
export const updateNote = async (id, payload) => (await API.put(`/notes/${id}`, payload)).data;
export const deleteNote = async (id) => (await API.delete(`/notes/${id}`)).data;