import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import api from '../utils/api';
import { formatPhoneDisplay, formatRelativeTime } from '../utils/formatters';
import toast from 'react-hot-toast';
import { 
  ArrowLeft, 
  Bot, 
  User, 
  Send, 
  RefreshCw,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Info,
  Calendar,
  Users,
  IndianRupee,
  MessageSquare
} from 'lucide-react';

export default function ChatWindow({ chat, onClose, onModeChange }) {
  const navigate = useNavigate();
  const socket = useSocket();
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showBookingInfo, setShowBookingInfo] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Optimistic mode state — local override that leads, API catches up
  const [optimisticMode, setOptimisticMode] = useState(chat?.mode || 'ai');
  const latestIntendedModeRef = useRef(chat?.mode || 'ai');
  const pendingRequestRef = useRef(null);

  // Sync optimistic state when parent chat prop changes (e.g. from socket)
  useEffect(() => {
    if (chat?.mode && !pendingRequestRef.current) {
      setOptimisticMode(chat.mode);
      latestIntendedModeRef.current = chat.mode;
    }
  }, [chat?.mode]);

  // Auto-scroll handling
  useEffect(() => {
    if (!isUserScrolledUp && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat?.messages, isUserScrolledUp]);

  // Track scroll position
  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setIsUserScrolledUp(!isNearBottom);
    }
  };

  // Socket event for new messages
  useEffect(() => {
    if (!socket || !chat?._id) return;

    const handleNewMessage = (data) => {
      if (data.chatId === chat._id) {
        if (!isUserScrolledUp) {
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 100);
        }
      }
    };

    // Listen for per-chat mode updates from other tabs/devices
    const handleModeUpdated = (data) => {
      if (data.chatId === chat._id && !pendingRequestRef.current) {
        setOptimisticMode(data.mode);
        latestIntendedModeRef.current = data.mode;
      }
    };

    // Listen for bulk mode update from global toggle
    const handleBulkModeUpdated = (data) => {
      if (!pendingRequestRef.current) {
        setOptimisticMode(data.mode);
        latestIntendedModeRef.current = data.mode;
      }
    };

    socket.on('chat:new_message', handleNewMessage);
    socket.on('chat:mode_updated', handleModeUpdated);
    socket.on('chats:bulk_mode_updated', handleBulkModeUpdated);
    return () => {
      socket.off('chat:new_message', handleNewMessage);
      socket.off('chat:mode_updated', handleModeUpdated);
      socket.off('chats:bulk_mode_updated', handleBulkModeUpdated);
    };
  }, [socket, chat?._id, isUserScrolledUp]);

  /**
   * Instant optimistic mode toggle.
   * - Flips UI immediately
   * - Only the LATEST intended mode is sent to the API (debounce via ref)
   * - On failure, reverts to server truth
   */
  const handleToggleMode = useCallback(() => {
    const newMode = optimisticMode === 'ai' ? 'human' : 'ai';

    // Instantly update UI
    setOptimisticMode(newMode);
    latestIntendedModeRef.current = newMode;

    // Notify parent (ChatsPage sidebar) for instant list-row sync
    if (onModeChange) onModeChange(chat._id, newMode);

    // Cancel any in-flight request — only latest mode matters
    if (pendingRequestRef.current) {
      pendingRequestRef.current.abort?.();
    }

    const controller = new AbortController();
    pendingRequestRef.current = controller;

    api.patch(`/chats/${chat._id}/mode`, { mode: newMode }, { signal: controller.signal })
      .then(() => {
        // Success — nothing to do, UI already shows the correct state
        pendingRequestRef.current = null;
      })
      .catch((err) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return; // Superseded by newer request
        pendingRequestRef.current = null;

        // Revert to previous state
        const revertTo = newMode === 'ai' ? 'human' : 'ai';
        setOptimisticMode(revertTo);
        latestIntendedModeRef.current = revertTo;
        if (onModeChange) onModeChange(chat._id, revertTo);
        toast.error("Couldn't switch mode, try again");
      });
  }, [optimisticMode, chat?._id, onModeChange]);

  const handleSendMessage = async () => {
    if (!messageText.trim() || isSending) return;

    const textToSend = messageText;
    setIsSending(true);
    try {
      const response = await api.post(`/chats/${chat._id}/message`, { text: textToSend });
      setMessageText('');
      toast.success('Message sent');
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (error) {
      const errMsg = error.response?.data?.message || 'Message failed to send — check WhatsApp connection';
      toast.error(errMsg);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleResetConversation = async () => {
    try {
      await api.post(`/chats/${chat._id}/reset`);
      toast.success('Conversation reset');
      setShowResetConfirm(false);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to reset conversation');
    }
  };

  if (!chat) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
          <MessageSquare size={32} className="text-gray-400" />
        </div>
        <p className="text-lg">No chat selected</p>
        <p className="text-sm mt-2">Select a chat from the list</p>
      </div>
    );
  }

  const bookingDraft = chat.bookingDraft || {};
  const hasBookingInfo = bookingDraft.checkIn || bookingDraft.guests || bookingDraft.roomType;
  const isAI = optimisticMode === 'ai';

  return (
    <div className="flex flex-col h-full bg-gray-100">
      {/* Header */}
      <div className="bg-whatsapp text-white p-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose || (() => navigate('/chats'))}
            className="md:hidden p-1 hover:bg-whatsapp-light rounded"
          >
            <ArrowLeft size={24} />
          </button>
          
          <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-whatsapp font-semibold">
            {chat.customerName?.charAt(0).toUpperCase() || chat.customerPhone?.slice(-2)}
          </div>
          
          <div>
            <h2 className="font-semibold">
              {chat.customerName ? `${chat.customerName} (${formatPhoneDisplay(chat.customerPhone)})` : formatPhoneDisplay(chat.customerPhone)}
            </h2>
            <div className="flex items-center gap-2 text-xs text-whatsapp-light">
              {isAI ? (
                <>
                  <Bot size={14} />
                  AI Mode
                </>
              ) : (
                <>
                  <User size={14} />
                  Human Mode
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Compact Instant Mode Toggle */}
          <button
            id="chat-mode-toggle"
            onClick={handleToggleMode}
            title={isAI ? 'AI replying' : "You're handling this chat"}
            className="mode-toggle-btn"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              cursor: 'pointer',
              transition: 'background-color 0.2s ease, transform 0.15s ease',
              backgroundColor: isAI ? 'rgba(37, 211, 102, 0.25)' : 'rgba(251, 191, 36, 0.3)',
              color: 'white',
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.9)'; }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
          >
            {isAI ? <Bot size={18} /> : <User size={18} />}
          </button>

          <button
            onClick={() => setShowResetConfirm(true)}
            className="p-2 hover:bg-whatsapp-light rounded"
            title="Reset conversation"
          >
            <RotateCcw size={20} />
          </button>

          {hasBookingInfo && (
            <button
              onClick={() => setShowBookingInfo(!showBookingInfo)}
              className="p-2 hover:bg-whatsapp-light rounded"
              title="Booking info"
            >
              <Info size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Booking Info Panel */}
      {showBookingInfo && hasBookingInfo && (
        <div className="bg-blue-50 border-b border-blue-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-blue-800 flex items-center gap-2">
              <Info size={16} />
              Booking Draft
            </h3>
            <button
              onClick={() => setShowBookingInfo(false)}
              className="text-blue-600 hover:text-blue-800"
            >
              <ChevronUp size={20} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {bookingDraft.checkIn && (
              <div className="flex items-center gap-2 text-blue-700">
                <Calendar size={16} />
                <span>{new Date(bookingDraft.checkIn).toLocaleDateString()}</span>
              </div>
            )}
            {bookingDraft.guests && (
              <div className="flex items-center gap-2 text-blue-700">
                <Users size={16} />
                <span>{bookingDraft.guests} guests</span>
              </div>
            )}
            {bookingDraft.roomType && (
              <div className="flex items-center gap-2 text-blue-700">
                <span>🏠</span>
                <span>{bookingDraft.roomType}</span>
              </div>
            )}
            {bookingDraft.estimatedPrice && (
              <div className="flex items-center gap-2 text-blue-700">
                <IndianRupee size={16} />
                <span>{bookingDraft.estimatedPrice}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 whatsapp-bg chat-scrollbar"
      >
        <div className="max-w-3xl mx-auto space-y-4">
          {chat.messages.map((message, index) => {
            const isSystemMarker = message.text?.includes('--- New Conversation Started ---');
            
            if (isSystemMarker) {
              return (
                <div key={index} className="text-center py-4">
                  <span className="text-xs text-gray-500 bg-gray-200 px-3 py-1 rounded-full">
                    {message.text}
                  </span>
                </div>
              );
            }

            const isFromBot = message.sender === 'bot' || message.sender === 'staff';
            
            return (
              <div
                key={index}
                className={`flex ${isFromBot ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 shadow-sm ${
                    isFromBot
                      ? 'bg-whatsapp-bubbleOut text-gray-800'
                      : 'bg-whatsapp-bubbleIn text-gray-800'
                  }`}
                >
                  <p className="text-sm">{message.text}</p>
                  <div className="flex items-center justify-end gap-1 mt-1">
                    <span className="text-xs text-gray-500">
                      {message.timestamp && formatRelativeTime(message.timestamp)}
                    </span>
                    {isFromBot && (
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        {message.sender === 'staff' ? '👤' : '🤖'}
                        {message.deliveryStatus === 'failed' && (
                          <span className="text-red-600 font-bold text-xs flex items-center gap-0.5" title="Failed to deliver on WhatsApp">
                            ⚠️ Failed
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Scroll to bottom indicator */}
      {isUserScrolledUp && (
        <button
          onClick={() => {
            setIsUserScrolledUp(false);
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }}
          className="absolute bottom-20 right-4 bg-whatsapp text-white p-2 rounded-full shadow-lg hover:bg-whatsapp-light transition-colors"
        >
          <ChevronDown size={20} />
        </button>
      )}

      {/* Message Input */}
      <div className="bg-white p-4 border-t border-gray-200">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="flex-1 relative">
            <input
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={isAI ? 'Send as staff...' : 'Type a message...'}
              className="w-full px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-whatsapp focus:border-transparent"
              disabled={isSending}
            />
          </div>
          <button
            onClick={handleSendMessage}
            disabled={!messageText.trim() || isSending}
            className="bg-whatsapp text-white p-2 rounded-full hover:bg-whatsapp-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? (
              <RefreshCw size={20} className="animate-spin" />
            ) : (
              <Send size={20} />
            )}
          </button>
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <RotateCcw className="text-whatsapp" size={24} />
              <h3 className="text-lg font-semibold">Reset Conversation?</h3>
            </div>
            <p className="text-gray-600 mb-6">
              This will reset the conversation state, clearing booking progress. Message history will be preserved for reference.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetConversation}
                className="flex-1 px-4 py-2 bg-whatsapp text-white rounded-lg hover:bg-whatsapp-light transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
