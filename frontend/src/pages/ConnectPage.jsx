import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { Plus, QrCode, Smartphone, RefreshCw, X, Copy, Check, CheckCircle, AlertTriangle, Loader, Trash2 } from 'lucide-react';

const statusConfig = {
  connected: { color: 'bg-green-100 text-green-800 border-green-200', label: 'Connected' },
  connecting: { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', label: 'Connecting' },
  disconnected: { color: 'bg-red-100 text-red-800 border-red-200', label: 'Disconnected' },
  not_initialized: { color: 'bg-gray-100 text-gray-800 border-gray-200', label: 'Not Initialized' }
};

/**
 * Connection flow state machine:
 * 
 *   idle ──▶ initializing ──▶ qr_ready ──▶ scanning ──▶ connected
 *                │                │                          ▲
 *                ▼                ▼                          │
 *           init_failed     auth_failed    ──── (poll backup)
 *                │                │
 *                ▼                ▼
 *          (Retry button cleans up + re-enters 'initializing')
 */

export default function ConnectPage() {
  const { user } = useAuth();
  const socket = useSocket();
  const [sessions, setSessions] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [connectionMethod, setConnectionMethod] = useState(null); // 'qr' or 'pairing'
  const [newSessionLabel, setNewSessionLabel] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('+91');
  const [pairingCode, setPairingCode] = useState(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(null);

  // ─── Connection state machine ───
  const [connState, setConnState] = useState('idle');
  // 'idle' | 'initializing' | 'qr_ready' | 'scanning' | 'connected' | 'init_failed' | 'auth_failed' | 'reconnect_failed'
  const [qrCode, setQrCode] = useState(null);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const pollIntervalRef = useRef(null);
  const autoCloseTimerRef = useRef(null);

  const isAdmin = user?.role === 'admin';

  // ─── Fetch sessions ───
  const fetchSessions = useCallback(async () => {
    try {
      const response = await api.get('/whatsapp/sessions');
      setSessions(response.data.sessions);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  // ─── Fallback polling: while modal is open and not yet connected ───
  useEffect(() => {
    if (!currentSessionId || connState === 'connected' || connState === 'idle') {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    // Poll every 3 seconds as a backup in case socket events are missed
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await api.get('/whatsapp/sessions');
        const sessionStatus = response.data.sessions[currentSessionId];
        if (sessionStatus === 'connected') {
          setConnState('connected');
          setSessions(response.data.sessions);
        }
      } catch (_) {
        // Polling is best-effort
      }
    }, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [currentSessionId, connState]);

  // ─── Auto-close modal after connected ───
  useEffect(() => {
    if (connState === 'connected') {
      autoCloseTimerRef.current = setTimeout(() => {
        closeModal();
      }, 3000);
      return () => {
        if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
      };
    }
  }, [connState]);

  // ─── Socket event listeners ───
  useEffect(() => {
    if (!socket) return;

    const handleQR = (data) => {
      if (data.sessionId === currentSessionId) {
        setQrCode(data.qr);
        setConnState('qr_ready');
      }
    };

    const handleReady = (data) => {
      if (data.sessionId === currentSessionId) {
        setConnState('connected');
        toast.success('WhatsApp connected successfully!');
        fetchSessions();
      }
      // Also refresh the session list for any ready event (covers other tabs)
      fetchSessions();
    };

    const handlePairingCode = (data) => {
      if (data.sessionId === currentSessionId) {
        setPairingCode(data.code);
        setConnState('qr_ready'); // reuse qr_ready state for pairing flow
      }
    };

    const handleAuthFailure = (data) => {
      if (data.sessionId === currentSessionId) {
        setConnState('auth_failed');
        setErrorMessage(data.message || 'Authentication failed');
      }
    };

    const handleInitFailed = (data) => {
      if (data.sessionId === currentSessionId) {
        setConnState('init_failed');
        setErrorMessage(data.message || 'Initialization failed');
      }
    };

    const handleReconnectFailed = (data) => {
      if (data.sessionId === currentSessionId) {
        setConnState('reconnect_failed');
        setErrorMessage('Reconnection failed after multiple attempts');
      }
    };

    const handleSessionDestroyed = () => {
      fetchSessions();
    };

    socket.on('whatsapp:qr', handleQR);
    socket.on('whatsapp:ready', handleReady);
    socket.on('whatsapp:pairing_code', handlePairingCode);
    socket.on('whatsapp:auth_failure', handleAuthFailure);
    socket.on('whatsapp:init_failed', handleInitFailed);
    socket.on('whatsapp:reconnect_failed', handleReconnectFailed);
    socket.on('whatsapp:session_destroyed', handleSessionDestroyed);

    return () => {
      socket.off('whatsapp:qr', handleQR);
      socket.off('whatsapp:ready', handleReady);
      socket.off('whatsapp:pairing_code', handlePairingCode);
      socket.off('whatsapp:auth_failure', handleAuthFailure);
      socket.off('whatsapp:init_failed', handleInitFailed);
      socket.off('whatsapp:reconnect_failed', handleReconnectFailed);
      socket.off('whatsapp:session_destroyed', handleSessionDestroyed);
    };
  }, [socket, currentSessionId, fetchSessions]);

  // ─── Start QR session ───
  const handleAddSession = async (cleanStart = false) => {
    if (!newSessionLabel.trim()) {
      toast.error('Please enter a label for the session');
      return;
    }

    setConnState('initializing');
    setQrCode(null);
    setPairingCode(null);
    setErrorMessage('');
    setCurrentSessionId(newSessionLabel);

    try {
      await api.post('/whatsapp/sessions', {
        sessionId: newSessionLabel,
        cleanStart
      });
      // API returns immediately. Socket events will drive state transitions.
    } catch (error) {
      setConnState('init_failed');
      setErrorMessage(error.response?.data?.message || 'Failed to start session initialization');
    }
  };

  // ─── Retry from failure ───
  const handleRetry = async () => {
    // Delete the stale session data and retry from scratch
    try {
      await api.delete(`/whatsapp/sessions/${currentSessionId}`);
    } catch (_) {
      // Session may not exist on backend, that's fine
    }
    // Re-init with cleanStart
    handleAddSession(true);
  };

  // ─── Pairing code flow ───
  const handlePairingCodeSubmit = async () => {
    if (!phoneNumber.trim() || phoneNumber.length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }

    setConnState('initializing');
    setCurrentSessionId(newSessionLabel);

    try {
      await api.post(`/whatsapp/sessions/${newSessionLabel}/pairing-code`, { phoneNumber });
    } catch (error) {
      setConnState('init_failed');
      setErrorMessage(error.response?.data?.message || 'Failed to request pairing code');
    }
  };

  // ─── Disconnect ───
  const handleDisconnect = async (sessionId) => {
    try {
      await api.delete(`/whatsapp/sessions/${sessionId}`);
      toast.success('Session disconnected');
      fetchSessions();
      setShowDisconnectConfirm(null);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to disconnect session');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const closeModal = () => {
    setShowAddModal(false);
    setConnectionMethod(null);
    setNewSessionLabel('');
    setPhoneNumber('+91');
    setQrCode(null);
    setPairingCode(null);
    setCurrentSessionId(null);
    setConnState('idle');
    setErrorMessage('');
    if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
    fetchSessions();
  };

  // ─── Render the connection state UI inside the modal ───
  const renderQRFlowUI = () => {
    switch (connState) {
      case 'initializing':
        return (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-whatsapp mb-4"></div>
            <p className="text-gray-600 font-medium">Initializing session...</p>
            <p className="text-gray-400 text-sm mt-1 mb-6">Starting WhatsApp Web session</p>
            {currentSessionId && (
              <button
                onClick={() => {
                  handleDisconnect(currentSessionId);
                  closeModal();
                }}
                className="text-xs text-red-600 hover:text-red-700 underline font-medium"
              >
                Cancel & Delete Session
              </button>
            )}
          </div>
        );

      case 'qr_ready':
        return (
          <div className="text-center">
            {qrCode && (
              <>
                <div className="bg-white p-3 rounded-xl inline-block mb-4 shadow-inner border border-gray-100">
                  <img src={qrCode} alt="QR Code" className="mx-auto" style={{ width: 256, height: 256 }} />
                </div>
                <p className="text-sm text-gray-600 mb-1 font-medium">
                  Scan this QR code with WhatsApp
                </p>
                <p className="text-xs text-gray-400 mb-4">
                  Open WhatsApp → Linked Devices → Link a Device
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-yellow-600 bg-yellow-50 rounded-lg px-3 py-2 mb-4">
                  <Loader size={14} className="animate-spin" />
                  Waiting for scan...
                </div>
                {currentSessionId && (
                  <button
                    onClick={() => {
                      handleDisconnect(currentSessionId);
                      closeModal();
                    }}
                    className="text-xs text-red-600 hover:text-red-700 underline font-medium flex items-center gap-1 mx-auto"
                  >
                    <Trash2 size={13} />
                    Cancel & Delete Session
                  </button>
                )}
              </>
            )}
          </div>
        );

      case 'connected':
        return (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle size={40} className="text-green-500" />
            </div>
            <p className="text-lg font-semibold text-green-700">Connected successfully!</p>
            <p className="text-sm text-gray-500 mt-1">WhatsApp session is now active</p>
            <button
              onClick={closeModal}
              className="mt-6 px-6 py-2 bg-whatsapp text-white rounded-lg hover:bg-whatsapp-light transition-colors font-medium"
            >
              Done
            </button>
          </div>
        );

      case 'init_failed':
      case 'auth_failed':
      case 'reconnect_failed':
        return (
          <div className="flex flex-col items-center justify-center py-8">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle size={32} className="text-red-500" />
            </div>
            <p className="text-lg font-semibold text-red-700 mb-1">
              {connState === 'auth_failed' ? 'Authentication Failed' :
               connState === 'reconnect_failed' ? 'Reconnection Failed' :
               'Initialization Failed'}
            </p>
            <p className="text-sm text-gray-500 text-center px-4 mb-6 max-w-xs">
              {errorMessage || 'Something went wrong. Try cleaning up and reconnecting.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={closeModal}
                className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
              >
                Close
              </button>
              <button
                onClick={handleRetry}
                className="px-3 py-2 bg-whatsapp text-white rounded-lg hover:bg-whatsapp-light transition-colors text-sm font-medium flex items-center gap-1.5"
              >
                <RefreshCw size={14} />
                Clean Retry
              </button>
              {currentSessionId && (
                <button
                  onClick={() => {
                    handleDisconnect(currentSessionId);
                    closeModal();
                  }}
                  className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium flex items-center gap-1.5"
                >
                  <Trash2 size={14} />
                  Delete Session
                </button>
              )}
            </div>
          </div>
        );

      default: // 'idle' or unexpected
        return (
          <div className="text-center py-8">
            <p className="text-gray-500">Waiting for QR code...</p>
          </div>
        );
    }
  };

  return (
    <div className="p-4 pb-20 md:pb-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">WhatsApp Connections</h1>
          <button
            onClick={fetchSessions}
            className="p-2 text-gray-600 hover:text-whatsapp transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {isAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full md:w-auto mb-6 flex items-center justify-center gap-2 bg-whatsapp text-white px-4 py-2 rounded-lg hover:bg-whatsapp-light transition-colors"
          >
            <Plus size={20} />
            Add New Number
          </button>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-whatsapp"></div>
          </div>
        ) : Object.keys(sessions).length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <Smartphone size={48} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600">No WhatsApp sessions configured</p>
            {isAdmin && (
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 text-whatsapp hover:text-whatsapp-light font-medium"
              >
                Add your first session
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(sessions).map(([sessionId, status]) => {
              const config = statusConfig[status] || statusConfig.not_initialized;
              return (
                <div key={sessionId} className="bg-white rounded-lg shadow p-4 md:p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800 text-lg">{sessionId}</h3>
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${config.color} mt-2`}>
                        {config.label}
                      </span>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => setShowDisconnectConfirm(sessionId)}
                        className="flex items-center gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 transition-colors font-medium text-sm"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Session Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Add WhatsApp Number</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            {!connectionMethod ? (
              <div className="p-4">
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Session Label
                  </label>
                  <input
                    type="text"
                    value={newSessionLabel}
                    onChange={(e) => setNewSessionLabel(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
                    placeholder="e.g., Main Number"
                  />
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => {
                      setConnectionMethod('qr');
                      handleAddSession();
                    }}
                    disabled={!newSessionLabel.trim()}
                    className="w-full flex items-center justify-center gap-3 p-4 border-2 border-gray-200 rounded-lg hover:border-whatsapp hover:bg-whatsapp hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <QrCode size={24} />
                    <span className="font-medium">Connect with QR Code</span>
                  </button>

                  <button
                    onClick={() => setConnectionMethod('pairing')}
                    disabled={!newSessionLabel.trim()}
                    className="w-full flex items-center justify-center gap-3 p-4 border-2 border-gray-200 rounded-lg hover:border-whatsapp hover:bg-whatsapp hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Smartphone size={24} />
                    <span className="font-medium">Connect with Phone Number</span>
                  </button>
                </div>
              </div>
            ) : connectionMethod === 'qr' ? (
              <div className="p-4">
                {renderQRFlowUI()}
              </div>
            ) : (
              <div className="p-4">
                {connState === 'initializing' ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-whatsapp mb-4"></div>
                    <p className="text-gray-600">Requesting pairing code...</p>
                  </div>
                ) : connState === 'connected' ? (
                  renderQRFlowUI()
                ) : connState === 'init_failed' || connState === 'auth_failed' ? (
                  renderQRFlowUI()
                ) : pairingCode ? (
                  <div className="text-center">
                    <div className="bg-gray-100 p-6 rounded-lg mb-4">
                      <p className="font-mono text-2xl tracking-widest text-gray-800 mb-4">
                        {pairingCode}
                      </p>
                      <button
                        onClick={() => copyToClipboard(pairingCode)}
                        className="flex items-center justify-center gap-2 text-whatsapp hover:text-whatsapp-light mx-auto"
                      >
                        <Copy size={18} />
                        Copy Code
                      </button>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                      Open WhatsApp → Linked Devices → Link with phone number → Enter this code
                    </p>
                    <button
                      onClick={handlePairingCodeSubmit}
                      className="text-whatsapp hover:text-whatsapp-light font-medium"
                    >
                      Request New Code
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp"
                        placeholder="+91 XXXXX XXXXX"
                      />
                    </div>
                    <button
                      onClick={handlePairingCodeSubmit}
                      className="w-full bg-whatsapp text-white py-2 rounded-lg hover:bg-whatsapp-light transition-colors"
                    >
                      Get Pairing Code
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Session Confirmation Modal */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 size={20} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold">Delete Session?</h3>
            </div>
            <p className="text-gray-600 mb-6">
              This will disconnect and permanently remove session <strong>"{showDisconnectConfirm}"</strong>. You'll need to scan QR again to reconnect.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDisconnectConfirm(null)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDisconnect(showDisconnectConfirm)}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center justify-center gap-1.5"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
