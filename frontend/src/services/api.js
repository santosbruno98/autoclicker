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
export const startJob = async (payload) => (await API.post('/automation/start', payload)).data;
export const stopJob = async () => (await API.post('/automation/stop', payload)).data;