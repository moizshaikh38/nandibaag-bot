import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { connectSocket, getSocket, disconnectSocket } from '../utils/socket';

/**
 * Custom hook for socket.io connection
 * 
 * Returns the connected socket instance and auto-reconnects
 * if disconnected while a user is logged in.
 * 
 * @returns {object} Socket instance
 */
export function useSocket() {
  const { token, isAuthenticated } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (isAuthenticated && token) {
      const socketInstance = connectSocket(token);
      setSocket(socketInstance);

      // Handle disconnection
      const handleDisconnect = () => {
        console.log('Socket disconnected, attempting to reconnect...');
        if (isAuthenticated && token) {
          setTimeout(() => {
            const reconnected = connectSocket(token);
            setSocket(reconnected);
          }, 1000);
        }
      };

      socketInstance.on('disconnect', handleDisconnect);

      return () => {
        socketInstance.off('disconnect', handleDisconnect);
      };
    } else {
      // Disconnect if not authenticated
      disconnectSocket();
      setSocket(null);
    }
  }, [isAuthenticated, token]);

  return socket;
}

export default useSocket;
