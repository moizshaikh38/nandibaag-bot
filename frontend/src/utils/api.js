import axios from 'axios';

// Token storage pattern:
// - If rememberMe is true: store in localStorage (persists across sessions, JWT has 30-day expiry)
// - If rememberMe is false: store in sessionStorage (clears on tab close, JWT has default expiry e.g., 1 day)
// This gives users control over session persistence without requiring server-side session management

const STORAGE_KEY_TOKEN = 'nandibaag_token';
const STORAGE_KEY_REMEMBER = 'nandibaag_remember';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:7000',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor: attach Bearer token
api.interceptors.request.use(
  (config) => {
    const rememberMe = localStorage.getItem(STORAGE_KEY_REMEMBER) === 'true';
    const storage = rememberMe ? localStorage : sessionStorage;
    const token = storage.getItem(STORAGE_KEY_TOKEN);
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor: handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear token from both storage locations
      localStorage.removeItem(STORAGE_KEY_TOKEN);
      sessionStorage.removeItem(STORAGE_KEY_TOKEN);
      localStorage.removeItem(STORAGE_KEY_REMEMBER);
      
      // Redirect to login
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    
    return Promise.reject(error);
  }
);

// Token management helpers
export const setToken = (token, rememberMe = false) => {
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem(STORAGE_KEY_TOKEN, token);
  localStorage.setItem(STORAGE_KEY_REMEMBER, rememberMe.toString());
  
  // Clear the other storage to avoid conflicts
  if (rememberMe) {
    sessionStorage.removeItem(STORAGE_KEY_TOKEN);
  } else {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
  }
};

export const getToken = () => {
  const rememberMe = localStorage.getItem(STORAGE_KEY_REMEMBER) === 'true';
  const storage = rememberMe ? localStorage : sessionStorage;
  return storage.getItem(STORAGE_KEY_TOKEN);
};

export const clearToken = () => {
  localStorage.removeItem(STORAGE_KEY_TOKEN);
  sessionStorage.removeItem(STORAGE_KEY_TOKEN);
  localStorage.removeItem(STORAGE_KEY_REMEMBER);
};

export default api;
