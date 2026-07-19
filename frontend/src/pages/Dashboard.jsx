import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { 
  LayoutDashboard, 
  MessageSquare, 
  Users, 
  Calendar, 
  AlertTriangle,
  Bell,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  X,
  Check,
  AlertCircle,
  Flame,
  Bot,
  User
} from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();
  
  const [stats, setStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [globalMode, setGlobalMode] = useState('ai');
  const [pendingModeChange, setPendingModeChange] = useState(null); // 'ai', 'human', or null
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [pendingFollowUps, setPendingFollowUps] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [notificationPermission, setNotificationPermission] = useState('default');

  const isAdmin = user?.role === 'admin';

  // Fetch stats
  const fetchStats = async () => {
    try {
      const response = await api.get('/dashboard/stats');
      setStats(response.data.stats);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  // Fetch settings
  const fetchSettings = async () => {
    try {
      const response = await api.get('/settings');
      setGlobalMode(response.data.settings.globalMode);
      setFollowUpEnabled(response.data.settings.followUpEnabled);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    }
  };

  // Request notification permission
  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
  };

  useEffect(() => {
    fetchStats();
    fetchSettings();
    requestNotificationPermission();
    
    // Refresh stats every 30 seconds
    const statsInterval = setInterval(fetchStats, 30000);
    return () => clearInterval(statsInterval);
  }, []);

  // Socket event listeners for alerts
  useEffect(() => {
    if (!socket) return;

    const addAlert = (alert) => {
      setAlerts(prev => [alert, ...prev].slice(0, 50));
      
      // Show toast
      toast(alert.message, {
        icon: alert.icon,
        duration: 5000,
      });

      // Show browser notification if permitted
      if (notificationPermission === 'granted' && alert.showNotification) {
        new Notification(alert.title, {
          body: alert.message,
          icon: '/icons/icon-192.png',
        });
      }
    };

    const handleHotLead = (data) => {
      addAlert({
        id: `hot-${data.chatId}-${Date.now()}`,
        type: 'hot_lead',
        title: '🔥 Hot Lead Alert',
        message: `Hot lead: ${data.customerPhone} (score: ${data.score})`,
        icon: <Flame size={20} className="text-orange-500" />,
        chatId: data.chatId,
        customerPhone: data.customerPhone,
        timestamp: new Date(),
        showNotification: true
      });
    };

    const handleAIFailure = (data) => {
      addAlert({
        id: `ai-fail-${data.chatId}-${Date.now()}`,
        type: 'ai_failure',
        title: '⚠️ AI Failure',
        message: `AI couldn't respond to ${data.customerPhone}, may need manual help`,
        icon: <AlertTriangle size={20} className="text-red-500" />,
        chatId: data.chatId,
        customerPhone: data.customerPhone,
        timestamp: new Date(),
        showNotification: true
      });
    };

    const handleWhatsAppDisconnected = (data) => {
      addAlert({
        id: `wa-disconnect-${data.sessionId}-${Date.now()}`,
        type: 'whatsapp_disconnected',
        title: 'WhatsApp Disconnected',
        message: `Session ${data.sessionId} disconnected: ${data.reason}`,
        icon: <AlertCircle size={20} className="text-red-500" />,
        sessionId: data.sessionId,
        timestamp: new Date(),
        showNotification: true
      });
    };

    const handleReconnectFailed = (data) => {
      addAlert({
        id: `reconnect-fail-${data.sessionId}-${Date.now()}`,
        type: 'reconnect_failed',
        title: 'Reconnection Failed',
        message: `Session ${data.sessionId} failed to reconnect after multiple attempts`,
        icon: <AlertTriangle size={20} className="text-red-500" />,
        sessionId: data.sessionId,
        timestamp: new Date(),
        showNotification: true
      });
    };

    const handleGlobalModeChanged = (data) => {
      setGlobalMode(data.globalMode);
      toast.success(`Global mode changed to ${data.globalMode === 'ai' ? 'AI' : 'Human'}`);
    };

    socket.on('lead:hot_alert', handleHotLead);
    socket.on('lead:ai_failure_alert', handleAIFailure);
    socket.on('whatsapp:disconnected', handleWhatsAppDisconnected);
    socket.on('whatsapp:reconnect_failed', handleReconnectFailed);
    socket.on('settings:global_mode_changed', handleGlobalModeChanged);

    return () => {
      socket.off('lead:hot_alert', handleHotLead);
      socket.off('lead:ai_failure_alert', handleAIFailure);
      socket.off('whatsapp:disconnected', handleWhatsAppDisconnected);
      socket.off('whatsapp:reconnect_failed', handleReconnectFailed);
      socket.off('settings:global_mode_changed', handleGlobalModeChanged);
    };
  }, [socket, notificationPermission]);

  const handleToggleGlobalMode = () => {
    setPendingModeChange(globalMode === 'ai' ? 'human' : 'ai');
  };

  const updateGlobalMode = async (newMode) => {
    try {
      await api.patch('/settings/global-mode', { globalMode: newMode });
      setGlobalMode(newMode);
      toast.success(`Switched to ${newMode === 'ai' ? 'AI' : 'Human'} mode`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update mode');
    }
  };

  const handleToggleFollowUps = async () => {
    try {
      await api.patch('/settings/follow-ups', { followUpEnabled: !followUpEnabled });
      setFollowUpEnabled(!followUpEnabled);
      toast.success(`Follow-ups ${!followUpEnabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update follow-ups');
    }
  };

  const navigateToChat = (chatId) => {
    navigate(`/chats/${chatId}`);
  };

  const dismissAlert = (alertId) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  };

  const formatRelativeTime = (date) => {
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  // Skeleton loader
  const StatCardSkeleton = () => (
    <div className="bg-white rounded-lg shadow p-4 md:p-6 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
      <div className="h-8 bg-gray-200 rounded w-1/2"></div>
    </div>
  );

  return (
    <>
      <div className="p-4 pb-20 md:pb-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
            <button
              onClick={fetchStats}
              className="p-2 text-gray-600 hover:text-whatsapp transition-colors"
              title="Refresh"
            >
              <RefreshCw size={20} className={isLoadingStats ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Global Mode Toggle */}
          <div className="bg-white rounded-lg shadow p-4 md:p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-1">Global Mode</h2>
                <p className="text-sm text-gray-600">
                  {globalMode === 'ai' 
                    ? 'AI is responding to all customer messages' 
                    : 'Staff must manually respond to all messages'}
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={handleToggleGlobalMode}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    globalMode === 'ai'
                      ? 'bg-whatsapp text-white hover:bg-whatsapp-light'
                      : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                  }`}
                >
                  {globalMode === 'ai' ? (
                    <>
                      <Bot size={20} />
                      AI Mode
                    </>
                  ) : (
                    <>
                      <User size={20} />
                      Human Mode
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {isLoadingStats ? (
              <>
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </>
            ) : (
              <>
                {/* Active Sessions */}
                <div className="bg-white rounded-lg shadow p-4 md:p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="text-whatsapp" size={20} />
                    <span className="text-sm text-gray-600">Sessions</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-800">
                    {stats?.activeSessions || 0} connected
                  </p>
                </div>

                {/* Chats Today */}
                <div className="bg-white rounded-lg shadow p-4 md:p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="text-blue-500" size={20} />
                    <span className="text-sm text-gray-600">Chats Today</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-800">
                    {stats?.chatsToday || 0}
                  </p>
                </div>

                {/* Hot Leads */}
                <button
                  onClick={() => navigate('/chats?filter=hot')}
                  className="bg-white rounded-lg shadow p-4 md:p-6 hover:shadow-md transition-shadow cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Flame className="text-orange-500" size={20} />
                    <span className="text-sm text-gray-600">Hot Leads</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-800">
                    {stats?.hotLeadsCount || 0}
                  </p>
                </button>

                {/* Bookings This Week */}
                <div className="bg-white rounded-lg shadow p-4 md:p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="text-green-500" size={20} />
                    <span className="text-sm text-gray-600">Bookings</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-800">
                    {stats?.bookingsThisWeek || 0}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* AI Failures Alert */}
          {stats?.aiFailuresLast24h > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-3">
                <AlertTriangle className="text-red-600" size={24} />
                <div className="flex-1">
                  <h3 className="font-semibold text-red-800">AI Failures Detected</h3>
                  <p className="text-sm text-red-700">
                    {stats.aiFailuresLast24h} AI response failure(s) in the last 24 hours. Manual intervention may be required.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Follow-up Status Widget */}
          <div className="bg-white rounded-lg shadow p-4 md:p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-1">Follow-ups</h2>
                <p className="text-sm text-gray-600">
                  {followUpEnabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={handleToggleFollowUps}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    followUpEnabled
                      ? 'bg-whatsapp text-white hover:bg-whatsapp-light'
                      : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                  }`}
                >
                  {followUpEnabled ? (
                    <>
                      <Check size={20} />
                      Enabled
                    </>
                  ) : (
                    <>
                      <X size={20} />
                      Disabled
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Live Alerts Panel */}
          <div className="bg-white rounded-lg shadow p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Bell size={20} />
                Live Alerts
              </h2>
              {alerts.length > 0 && (
                <button
                  onClick={() => setAlerts([])}
                  className="text-sm text-gray-600 hover:text-gray-800"
                >
                  Clear All
                </button>
              )}
            </div>

            {alerts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Bell size={48} className="mx-auto mb-2 text-gray-300" />
                <p>No recent alerts</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto chat-scrollbar">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-lg border ${
                      alert.type === 'hot_lead'
                        ? 'bg-orange-50 border-orange-200'
                        : alert.type === 'ai_failure'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-yellow-50 border-yellow-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {alert.icon}
                          <span className="font-medium text-gray-800">{alert.title}</span>
                        </div>
                        <p className="text-sm text-gray-700">{alert.message}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatRelativeTime(alert.timestamp)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {(alert.chatId || alert.customerPhone) && (
                          <button
                            onClick={() => alert.chatId && navigateToChat(alert.chatId)}
                            className="text-xs bg-whatsapp text-white px-2 py-1 rounded hover:bg-whatsapp-light"
                          >
                            View Chat
                          </button>
                        )}
                        <button
                          onClick={() => dismissAlert(alert.id)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Global Mode Confirmation Modal */}
        {pendingModeChange && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <AlertTriangle className="text-yellow-500" size={24} />
                <h3 className="text-lg font-semibold">Switch to {pendingModeChange === 'ai' ? 'AI' : 'Human'} Mode?</h3>
              </div>
              <p className="text-gray-600 mb-6">
                This will immediately switch ALL {stats?.totalChats || 0} existing chats to {pendingModeChange === 'ai' ? 'AI' : 'Human'} mode. Chats can still be individually adjusted afterward from their chat window. Continue?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setPendingModeChange(null)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    await updateGlobalMode(pendingModeChange);
                    setPendingModeChange(null);
                  }}
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
