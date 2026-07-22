import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import api from '../utils/api';
import { formatPhoneDisplay, formatRelativeTime, getLanguageBadgeColor } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';
import { Search, MessageSquare, Bot, User, Flame, ChevronRight, Trash2 } from 'lucide-react';
import ChatWindow from '../components/ChatWindow';
import toast from 'react-hot-toast';

export default function ChatsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const socket = useSocket();
  
  const [chats, setChats] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);
  const [activeTab, setActiveTab] = useState(searchParams.get('filter') === 'hot' ? 'hot' : 'all');

  // Refs for in-flight per-chat mode requests (keyed by chatId)
  const pendingModeRequests = useRef({});

  // Check for desktop/mobile
  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch chats
  const fetchChats = useCallback(async (search = '') => {
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      
      const response = await api.get(`/chats?${params.toString()}`);
      setChats(response.data.chats);
    } catch (error) {
      console.error('Failed to fetch chats:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Clear all stored chats handler
  const handleClearAllChats = async () => {
    if (!window.confirm('Are you sure you want to delete ALL stored chats and leads? This cannot be undone.')) {
      return;
    }
    try {
      await api.delete('/chats/clear-all');
      toast.success('All chats cleared successfully');
      setChats([]);
      setSelectedChatId(null);
    } catch (err) {
      toast.error('Failed to clear chats');
    }
  };

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch chats when search changes
  useEffect(() => {
    fetchChats(debouncedSearch);
  }, [debouncedSearch, fetchChats]);

  // Handle URL params for initial selection and filter tab
  useEffect(() => {
    const chatIdFromUrl = searchParams.get('chatId');
    if (chatIdFromUrl) {
      setSelectedChatId(chatIdFromUrl);
    }
    const filterParam = searchParams.get('filter');
    if (filterParam === 'hot') {
      setActiveTab('hot');
    } else {
      setActiveTab('all');
    }
  }, [searchParams]);

  // Socket events
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data) => {
      setChats(prev => {
        const updated = prev.map(chat => {
          if (chat._id === data.chatId) {
            return {
              ...chat,
              lastMessageAt: new Date(),
              messages: [...chat.messages, {
                sender: 'customer',
                text: data.message,
                timestamp: new Date()
              }]
            };
          }
          return chat;
        });
        
        // Bump the updated chat to top
        const chatIndex = updated.findIndex(c => c._id === data.chatId);
        if (chatIndex > 0) {
          const [bumpedChat] = updated.splice(chatIndex, 1);
          updated.unshift(bumpedChat);
        }
        
        return updated;
      });
    };

    const handleBulkModeUpdated = (data) => {
      setChats(prev =>
        prev.map(chat => ({
          ...chat,
          mode: data.mode
        }))
      );
    };

    // Per-chat mode update from another tab/device
    const handleChatModeUpdated = (data) => {
      // Only apply if we don't have a pending request for this chat
      if (!pendingModeRequests.current[data.chatId]) {
        setChats(prev =>
          prev.map(chat =>
            chat._id === data.chatId ? { ...chat, mode: data.mode } : chat
          )
        );
      }
    };

    socket.on('chat:new_message', handleNewMessage);
    socket.on('chats:bulk_mode_updated', handleBulkModeUpdated);
    socket.on('chat:mode_updated', handleChatModeUpdated);
    
    return () => {
      socket.off('chat:new_message', handleNewMessage);
      socket.off('chats:bulk_mode_updated', handleBulkModeUpdated);
      socket.off('chat:mode_updated', handleChatModeUpdated);
    };
  }, [socket]);

  /**
   * Optimistic mode toggle for list rows.
   * Also called by ChatWindow via onModeChange callback for instant list sync.
   */
  const handleListRowToggle = useCallback((chatId, newModeOverride, e) => {
    // If called from a click event, prevent navigation into the chat
    if (e?.stopPropagation) e.stopPropagation();

    const chat = chats.find(c => c._id === chatId);
    if (!chat && !newModeOverride) return;

    const newMode = newModeOverride || (chat.mode === 'ai' ? 'human' : 'ai');

    // Optimistic update
    setChats(prev =>
      prev.map(c => c._id === chatId ? { ...c, mode: newMode } : c)
    );

    // If this is a callback from ChatWindow (newModeOverride provided), don't
    // fire another API call — ChatWindow already fires its own.
    if (newModeOverride) return;

    // Cancel any in-flight request for this chat
    if (pendingModeRequests.current[chatId]) {
      pendingModeRequests.current[chatId].abort?.();
    }

    const controller = new AbortController();
    pendingModeRequests.current[chatId] = controller;

    api.patch(`/chats/${chatId}/mode`, { mode: newMode }, { signal: controller.signal })
      .then(() => {
        delete pendingModeRequests.current[chatId];
      })
      .catch((err) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        delete pendingModeRequests.current[chatId];

        // Revert
        const revertTo = newMode === 'ai' ? 'human' : 'ai';
        setChats(prev =>
          prev.map(c => c._id === chatId ? { ...c, mode: revertTo } : c)
        );
        toast.error("Couldn't switch mode, try again");
      });
  }, [chats]);

  const handleChatSelect = (chatId) => {
    setSelectedChatId(chatId);
    if (!isDesktop) {
      navigate(`/chats/${chatId}`);
    }
  };

  const selectedChat = chats.find(c => c._id === selectedChatId);

  const filteredChats = chats.filter(chat => {
    if (activeTab === 'hot') {
      return chat.leadStatus === 'hot';
    }
    return true;
  });

  return (
    <div className="h-screen flex flex-col md:flex-row">
      {/* Chat List Panel */}
      <div className={`${isDesktop && selectedChat ? 'w-1/3' : 'w-full'} flex flex-col border-r border-gray-200 bg-white`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-800">Chats</h1>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2 py-1 rounded bg-gray-100 text-gray-600">
                Total: {chats.length}
              </span>
              {isAdmin && chats.length > 0 && (
                <button
                  onClick={handleClearAllChats}
                  title="Clear all chats"
                  className="flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded transition-colors"
                >
                  <Trash2 size={13} />
                  Clear All
                </button>
              )}
            </div>
          </div>
          
          {/* Search Bar */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or phone..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-whatsapp focus:border-transparent transition-all duration-200"
            />
          </div>

          {/* Tab Filters */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setActiveTab('all');
                navigate('/chats');
              }}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm ${
                activeTab === 'all'
                  ? 'bg-whatsapp text-white hover:bg-whatsapp-light'
                  : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              <MessageSquare size={14} />
              All ({chats.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('hot');
                navigate('/chats?filter=hot');
              }}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm ${
                activeTab === 'hot'
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Flame size={14} className={activeTab === 'hot' ? 'text-white' : 'text-gray-400'} />
              Hot Leads ({chats.filter(c => c.leadStatus === 'hot').length})
            </button>
          </div>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto chat-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-whatsapp"></div>
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <MessageSquare size={48} className="mb-2 text-gray-300" />
              <p>No {activeTab === 'hot' ? 'hot leads' : 'chats'} found</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredChats.map((chat) => {
                const lastMessage = chat.messages[chat.messages.length - 1];
                const isHot = chat.leadStatus === 'hot';
                const isAI = chat.mode === 'ai';
                
                return (
                  <div
                    key={chat._id}
                    onClick={() => handleChatSelect(chat._id)}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedChatId === chat._id ? 'bg-whatsapp bg-opacity-10' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className="w-12 h-12 bg-whatsapp rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0">
                        {chat.customerName?.charAt(0).toUpperCase() || chat.customerPhone?.slice(-2)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-semibold text-gray-800 truncate">
                            {chat.customerName || formatPhoneDisplay(chat.customerPhone)}
                          </h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {isHot && <Flame size={14} className="text-orange-500" />}

                            {/* Compact Instant Mode Toggle */}
                            <button
                              onClick={(e) => handleListRowToggle(chat._id, null, e)}
                              title={isAI ? 'AI replying' : "You're handling this chat"}
                              className="flex items-center justify-center flex-shrink-0"
                              style={{
                                width: '28px',
                                height: '28px',
                                borderRadius: '50%',
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s ease, transform 0.15s ease',
                                backgroundColor: isAI ? 'rgba(37, 211, 102, 0.15)' : 'rgba(251, 191, 36, 0.2)',
                                color: isAI ? '#25D366' : '#D97706',
                              }}
                              onMouseDown={(e) => { e.stopPropagation(); e.currentTarget.style.transform = 'scale(0.85)'; }}
                              onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                            >
                              {isAI ? <Bot size={14} /> : <User size={14} />}
                            </button>

                            <span className="text-xs text-gray-500">
                              {formatRelativeTime(chat.lastMessageAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${getLanguageBadgeColor(chat.language)}`}>
                            {chat.language}
                          </span>
                        </div>

                        <p className="text-sm text-gray-600 truncate">
                          {lastMessage?.text || 'No messages yet'}
                        </p>
                      </div>

                      {/* Chevron for desktop */}
                      {isDesktop && (
                        <ChevronRight className="text-gray-400 flex-shrink-0" size={20} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Chat Window Panel (Desktop) */}
      {isDesktop && (
        <div className={`${selectedChat ? 'w-2/3' : 'w-2/3'} flex flex-col bg-gray-100`}>
          {selectedChat ? (
            <ChatWindow
              chat={selectedChat}
              onClose={() => setSelectedChatId(null)}
              onModeChange={(chatId, newMode) => handleListRowToggle(chatId, newMode)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <MessageSquare size={64} className="mb-4 text-gray-300" />
              <p className="text-lg">Select a chat to view messages</p>
              <p className="text-sm mt-2">Choose from the list on the left</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
