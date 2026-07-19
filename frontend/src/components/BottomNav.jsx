import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, QrCode, MessageSquare, Settings } from 'lucide-react';
import api from '../utils/api';
import { useSocket } from '../hooks/useSocket';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/chats', label: 'Chats', icon: MessageSquare },
  { path: '/connect', label: 'Connect', icon: QrCode },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function BottomNav() {
  const location = useLocation();
  const socket = useSocket();
  const [hotLeadCount, setHotLeadCount] = useState(0);

  useEffect(() => {
    if (location.pathname === '/login') return;

    const fetchStats = async () => {
      try {
        const response = await api.get('/dashboard/stats');
        setHotLeadCount(response.data.stats?.hotLeadsCount || 0);
      } catch (err) {
        console.error('Failed to fetch hot lead count in BottomNav:', err);
      }
    };

    fetchStats();

    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [location.pathname]);

  // Real-time socket updates for hot leads
  useEffect(() => {
    if (!socket) return;

    const handleHotLead = () => {
      setHotLeadCount(prev => prev + 1);
    };

    socket.on('hot_lead', handleHotLead);
    return () => {
      socket.off('hot_lead', handleHotLead);
    };
  }, [socket]);

  // Hide on login page
  if (location.pathname === '/login') {
    return null;
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          const showBadge = item.path === '/chats' && hotLeadCount > 0;
          
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive: linkIsActive }) =>
                `flex flex-col items-center justify-center w-full h-full text-sm transition-colors ${
                  linkIsActive
                    ? 'text-whatsapp font-semibold'
                    : 'text-gray-600 hover:text-whatsapp'
                }`
              }
            >
              <div className="relative mb-1">
                <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                {showBadge && (
                  <span className="absolute -top-1 -right-2 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                    {hotLeadCount}
                  </span>
                )}
              </div>
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
