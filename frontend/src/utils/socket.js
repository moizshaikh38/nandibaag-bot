import { io } from 'socket.io-client';
import { getToken } from './api';

let socket = null;

/**
 * Initializes and returns a singleton socket.io-client instance
 * Connects to VITE_API_URL with JWT authentication
 * 
 * @param {string} token - JWT token for authentication
 * @returns {object} Socket.io client instance
 */
export function connectSocket(token) {
  if (socket?.connected) {
    return socket;
  }

  const socketUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:7000';
  
  socket = io(socketUrl, {
    auth: {
      token: token || getToken()
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  socket.on('connect', () => {
    console.log('Socket connected');
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
  });

  return socket;
}

/**
 * Returns the existing socket instance or null if not connected
 * 
 * @returns {object|null} Socket.io client instance or null
 */
export function getSocket() {
  return socket;
}

/**
 * Disconnects the socket instance
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export default { connectSocket, getSocket, disconnectSocket };
