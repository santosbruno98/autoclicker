import axios from 'axios';

const backendURL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export const authAPI = axios.create({
  baseURL: backendURL || '/',
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
  },
});

export const API = axios.create({
  baseURL: backendURL ? `${backendURL}/api/v1` : '/api/v1',
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
  },
});