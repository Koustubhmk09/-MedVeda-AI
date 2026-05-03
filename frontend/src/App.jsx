import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User, PlusCircle, MessageSquare, Menu, X, HeartPulse, Trash2, MoreHorizontal, LogOut, LogIn } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGoogleLogin } from '@react-oauth/google';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import './App.css';


const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const App = () => {
  // State Management for Chats
  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem('medveda_chats');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error('Failed to parse chats', e); }
    }
    return [{ id: Date.now().toString(), title: 'New chat', messages: [] }];
  });

  const [activeChatId, setActiveChatId] = useState(() => {
    const saved = localStorage.getItem('medveda_active_chat');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return null;
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [backendStatus, setBackendStatus] = useState('offline'); // online, offline, initializing
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('medveda_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoginVisible, setIsLoginVisible] = useState(false);
  const [isLogoutVisible, setIsLogoutVisible] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const messagesEndRef = useRef(null);

  // Sync user to localStorage
  useEffect(() => {
    if (user) {
      localStorage.setItem('medveda_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('medveda_user');
    }
  }, [user]);

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      // Show loading sequence immediately for responsiveness
      setIsLoginVisible(false);
      setIsLoggingIn(true);
      
      try {
        const res = await axios.post(`${API_URL}/auth/google`, {
          token: tokenResponse.access_token,
        });
        
        // Premium 2-second delay as requested, but we start it AFTER the backend responds
        // or we could start it immediately and wait for both. 
        // Let's ensure at least 1.5s of animation for the premium feel.
        setTimeout(() => {
          setUser(res.data.user);
          localStorage.setItem('medveda_token', res.data.access_token);
          setIsLoggingIn(false);
        }, 1500);
      } catch (err) {
        console.error('Login failed', err);
        setIsLoggingIn(false);
        alert('Login failed. The backend might be offline or CORS might be blocking the request. Please check the backend URL and origins.');
      }
    },
    onError: () => {
      console.log('Login Failed');
      setIsLoginVisible(false);
    },
  });

  const handleLogout = () => {
    setIsLogoutVisible(true);
  };

  const confirmLogout = () => {
    setUser(null);
    localStorage.removeItem('medveda_token');
    localStorage.removeItem('medveda_user');
    setChats([{ id: Date.now().toString(), title: 'New chat', messages: [] }]);
    setActiveChatId(null);
    setIsLogoutVisible(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setOpenDropdownId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Sync state to localStorage (Only for logged in users)
  useEffect(() => {
    if (user) {
      localStorage.setItem('medveda_chats', JSON.stringify(chats));
      localStorage.setItem('medveda_active_chat', JSON.stringify(activeChatId));
    } else {
      // Guest mode is ephemeral: don't persist to localStorage
      localStorage.removeItem('medveda_chats');
      localStorage.removeItem('medveda_active_chat');
    }
  }, [chats, user, activeChatId]);

  // Derived current chat
  const activeChat = activeChatId ? (chats.find(c => c.id === activeChatId) || {}) : {};
  const messages = activeChat.messages || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const checkHealth = async () => {
    try {
      const res = await axios.get(`${API_URL}/health`);
      setBackendStatus(res.data.status);
      return res.data.status === 'online';
    } catch (err) {
      setBackendStatus('offline');
      return false;
    }
  };

  // Poll for health if offline (Handles Render cold start)
  useEffect(() => {
    checkHealth();
    const interval = setInterval(() => {
      if (backendStatus !== 'online') {
        checkHealth();
      }
    }, 5000); // Check every 5 seconds if not online
    return () => clearInterval(interval);
  }, [backendStatus]);

  // Fetch chats from backend if user is logged in
  useEffect(() => {
    const fetchChats = async () => {
      const token = localStorage.getItem('medveda_token');
      if (user && token) {
        try {
          const res = await axios.get(`${API_URL}/chats`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.data.length > 0) {
            setChats(res.data.map(c => ({ 
              ...c, 
              messages: c.messages ? c.messages.map(m => ({ role: m.role, text: m.content })) : [] 
            })));
          } else {
            // Reset to default if no chats found (e.g. after table drop)
            setChats([{ id: Date.now().toString(), title: 'New chat', messages: [] }]);
          }
          setActiveChatId(null); // Always show Hero page on login
        } catch (err) {
          console.error('Failed to fetch chats', err);
        }
      }
    };
    fetchChats();
  }, [user]);

  // Fetch messages for active chat if not loaded
  useEffect(() => {
    const fetchMessages = async () => {
      const token = localStorage.getItem('medveda_token');
      if (user && token && activeChatId) {
        const currentChat = chats.find(c => c.id === activeChatId);
        if (currentChat && (!currentChat.messages || currentChat.messages.length === 0)) {
          try {
            const res = await axios.get(`${API_URL}/chats/${activeChatId}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            setChats(prev => prev.map(c => 
              c.id === activeChatId ? { ...c, messages: res.data.messages.map(m => ({ role: m.role, text: m.content })) } : c
            ));
          } catch (err) {
            console.error('Failed to fetch messages', err);
          }
        }
      }
    };
    fetchMessages();
  }, [activeChatId, user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);


  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleDropdown = (e, id) => {
    e.stopPropagation();
    setOpenDropdownId(prev => prev === id ? null : id);
  };

  const createNewChat = () => {
    setActiveChatId(null);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
  };

  const deleteChat = async (e, id) => {
    e.stopPropagation();
    const token = localStorage.getItem('medveda_token');
    if (user && token) {
      try {
        await axios.delete(`${API_URL}/chats/${id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (err) {
        console.error('Failed to delete chat on backend', err);
      }
    }
    
    const updatedChats = chats.filter(c => c.id !== id);
    if (updatedChats.length === 0) {
      const newChat = { id: Date.now().toString(), title: 'New chat', messages: [] };
      setChats([newChat]);
      setActiveChatId(newChat.id);
    } else {
      setChats(updatedChats);
      if (activeChatId === id) {
        setActiveChatId(null);
      }
    }
  };

  const handleSend = async () => {
    if (!input.trim() || backendStatus !== 'online') return;

    const userInputText = input.trim();
    const userMessage = { role: 'user', text: userInputText };
    
    // Detect if we're starting a brand new chat session
    const isNewChat = !activeChatId;
    const tempChatId = isNewChat ? Date.now().toString() : activeChatId;

    if (isNewChat) {
      // For a new chat, we prepend a fresh chat object immediately
      const newChat = {
        id: tempChatId,
        title: userInputText.length > 25 ? userInputText.substring(0, 25) + '...' : userInputText,
        messages: [userMessage]
      };
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(tempChatId);
    } else {
      // For existing chat, we just append the message to current chat
      setChats(prevChats => prevChats.map(chat => {
        if (chat.id === activeChatId) {
          return {
            ...chat,
            messages: [...chat.messages, userMessage]
          };
        }
        return chat;
      }));
    }
    
    setInput('');
    setIsLoading(true);

    try {
      const token = localStorage.getItem('medveda_token');
      const response = await axios.post(`${API_URL}/chat`, {
        message: userInputText,
        chat_id: isNewChat ? null : String(activeChatId)
      }, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      
      const botMessage = { role: 'assistant', text: response.data.answer };
      const newTitle = response.data.title;
      // Handle missing chat_id for guests (don't set to "undefined")
      const newChatIdFromBackend = response.data.chat_id ? String(response.data.chat_id) : null;
      
      setChats(prevChats => prevChats.map(chat => {
        if (chat.id === tempChatId) {
          return {
            ...chat,
            id: newChatIdFromBackend || chat.id,
            title: newTitle || chat.title,
            messages: [...chat.messages, botMessage]
          };
        }
        return chat;
      }));
      
      // Only update activeChatId if the backend actually provided a persistent ID
      if (newChatIdFromBackend) {
        setActiveChatId(newChatIdFromBackend);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorDetail = error.response?.data?.detail;
      const errorMessageText = typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : (errorDetail || error.message);
      const errorMessage = { 
        role: 'assistant', 
        text: `Error: ${errorMessageText}. Please make sure the backend terminal shows "AI components initialized successfully".` 
      };
      
      setChats(prevChats => prevChats.map(chat => {
        if (chat.id === tempChatId) {
          return {
            ...chat,
            messages: [...chat.messages, errorMessage]
          };
        }
        return chat;
      }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Mobile Sidebar Toggle */}
      <button 
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-md shadow-md"
      >
        {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out
        lg:translate-x-0 lg:static lg:inset-0 flex flex-col
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full p-4">
          <div className="flex items-center gap-2 px-2 py-4 mb-4">
            <div className="p-2 bg-medical-500 rounded-lg text-white">
              <HeartPulse size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">MedVeda AI</h1>
          </div>

          <button 
            onClick={createNewChat}
            className="flex items-center gap-2 w-full p-3 mb-6 text-sm font-medium text-white bg-medical-600 rounded-xl hover:bg-medical-700 transition-colors shadow-sm"
          >
            <PlusCircle size={18} />
            New chat
          </button>

          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">History</div>
            {chats.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 px-4 text-center">
                <MessageSquare size={24} className="text-slate-200 mb-2" />
                <p className="text-xs text-slate-300">New conversations will appear here.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {chats
                  .filter(chat => chat.title !== 'New chat' || (chat.messages && chat.messages.length > 0))
                  .map(chat => (
                  <div 
                    key={chat.id}
                    onClick={() => {
                      setActiveChatId(chat.id);
                      if (window.innerWidth < 1024) setIsSidebarOpen(false);
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-colors group ${
                      activeChatId === chat.id ? 'bg-medical-50 text-medical-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <MessageSquare size={16} className={activeChatId === chat.id ? 'text-medical-500' : 'text-slate-400'} />
                      <span className="text-sm truncate w-36">{chat.title}</span>
                    </div>
                    <div className="relative">
                      <button 
                        onClick={(e) => toggleDropdown(e, chat.id)}
                        className={`p-1.5 rounded transition-opacity text-slate-400 hover:bg-slate-200 ${
                          activeChatId === chat.id || openDropdownId === chat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                        title="More options"
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      
                      <AnimatePresence>
                        {openDropdownId === chat.id && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.1 }}
                            className="absolute right-0 top-full mt-1 w-40 bg-white border border-slate-100 shadow-xl rounded-xl z-50 overflow-hidden text-sm"
                          >
                            <button 
                              onClick={(e) => { e.stopPropagation(); deleteChat(e, chat.id); setOpenDropdownId(null); }}
                              className="flex items-center gap-2 w-full p-2.5 text-left text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={14} /> Delete
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-auto pt-4 border-t border-slate-100">
            {user ? (
              <div className="flex items-center justify-between gap-3 px-2">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-9 h-9 rounded-full bg-medical-500 flex items-center justify-center text-white font-bold shrink-0 shadow-sm">
                    {user.full_name?.charAt(0) || user.email?.charAt(0)}
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-sm font-semibold text-slate-800 truncate">{user.full_name}</span>
                    <span className="text-[11px] text-slate-400 truncate">{user.email}</span>
                  </div>
                </div>
                <button 
                  onClick={handleLogout}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  title="Logout"
                >
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setIsLoginVisible(true)}
                className="flex items-center gap-3 w-full p-2 text-sm font-medium text-slate-700 hover:bg-medical-50 rounded-xl transition-all border border-slate-100 hover:border-medical-200 group"
              >
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-medical-100 group-hover:text-medical-600 transition-colors shrink-0">
                  <User size={20} />
                </div>
                <div className="flex flex-col items-start overflow-hidden">
                  <span className="font-bold text-slate-800">Log in</span>
                  <span className="text-[10px] text-slate-400 truncate">Sync your history</span>
                </div>
                <LogIn size={16} className="ml-auto text-slate-300 group-hover:text-medical-500 group-hover:translate-x-0.5 transition-all" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-full bg-slate-50 relative">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-8 bg-white/80 backdrop-blur-md border-b border-slate-200 z-10 lg:pl-8 pl-16">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full animate-pulse ${
              backendStatus === 'online' ? 'bg-green-500' : 
              backendStatus === 'initializing' ? 'bg-yellow-500' : 'bg-red-500'
            }`}></span>
            <span className="text-sm font-medium text-slate-600">
              {backendStatus === 'online' ? 'MedVeda Online' : 
               backendStatus === 'initializing' ? 'AI Initializing...' : 'AI Offline'}
            </span>
          </div>
        </header>

        {/* Messages or Hero */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 custom-scrollbar">
          {!activeChatId || messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center max-w-3xl mx-auto text-center px-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-8"
              >
                <div className="w-20 h-20 bg-medical-500 rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-medical-200 mx-auto mb-6">
                  <HeartPulse size={40} />
                </div>
                <h2 className="text-5xl font-bold text-slate-900 mb-6 tracking-tight">What can I help you with?</h2>
                <p className="text-slate-500 text-xl max-w-2xl mx-auto leading-relaxed">
                  Your personal AI medical assistant for health guidance.
                </p>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="w-full max-w-2xl mt-8"
              >
                <div className="relative group shadow-2xl shadow-medical-100 rounded-3xl border border-slate-200 bg-white p-2 transition-all hover:border-medical-300">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={backendStatus !== 'online'}
                    placeholder="Describe your health concern or ask a question..."
                    rows={1}
                    className="w-full py-4 px-6 bg-transparent focus:outline-none text-lg placeholder:text-slate-400 chat-input custom-scrollbar"
                  />
                  <button
                    onClick={handleSend}
                    disabled={isLoading || !input.trim() || backendStatus !== 'online'}
                    className={`
                      absolute right-3 top-3 bottom-3 px-6 rounded-2xl flex items-center justify-center transition-all
                      ${isLoading || !input.trim() 
                        ? 'bg-slate-100 text-slate-300 pointer-events-none' 
                        : 'bg-medical-600 text-white hover:bg-medical-700 shadow-md active:scale-95'}
                    `}
                  >
                    <Send size={20} />
                  </button>
                </div>
              </motion.div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6 pb-24">
              <AnimatePresence initial={false}>
                {messages.map((msg, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`flex gap-3 max-w-[85%] lg:max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div className={`
                        w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center
                        ${msg.role === 'user' ? 'bg-medical-100 text-medical-600' : 'bg-medical-500 text-white shadow-md'}
                      `}>
                        {msg.role === 'user' ? <User size={18} /> : <HeartPulse size={18} />}
                      </div>
                      <div className={`
                        p-4 rounded-2xl text-sm leading-relaxed
                        ${msg.role === 'user' 
                          ? 'bg-medical-600 text-white rounded-tr-none shadow-md whitespace-pre-wrap' 
                          : 'bg-white text-slate-800 rounded-tl-none border border-slate-100 shadow-md markdown-body'}
                      `}>
                        {msg.role === 'user' ? (
                          msg.text
                        ) : (
                          <ReactMarkdown>{msg.text}</ReactMarkdown>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex justify-start"
                  >
                    <div className="flex gap-3 items-center ml-11">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-medical-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-1.5 h-1.5 bg-medical-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-1.5 h-1.5 bg-medical-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area (Only visible when chatting) */}
        {activeChatId && messages.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 p-4 lg:p-8 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent">
            <div className="max-w-3xl mx-auto">
              <div className="relative group shadow-xl rounded-2xl border border-slate-200 bg-white overflow-hidden transition-all focus-within:border-medical-300 focus-within:shadow-medical-100">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={backendStatus !== 'online'}
                  rows={1}
                  placeholder={
                    backendStatus === 'online' ? "Ask anything about your health..." : 
                    backendStatus === 'initializing' ? "AI is waking up, please wait..." : 
                    "AI is offline. Check your backend terminal."
                  }
                  className={`w-full p-4 pr-16 bg-transparent focus:outline-none rounded-2xl transition-all placeholder:text-slate-400 chat-input custom-scrollbar ${
                    backendStatus !== 'online' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                />
                <button
                  onClick={handleSend}
                  disabled={isLoading || !input.trim() || backendStatus !== 'online'}
                  className={`
                    absolute right-2 top-2 bottom-2 px-4 rounded-xl flex items-center justify-center transition-all
                    ${isLoading || !input.trim() 
                      ? 'bg-slate-100 text-slate-300 pointer-events-none' 
                      : 'bg-medical-600 text-white hover:bg-medical-700 shadow-sm active:scale-95'}
                  `}
                >
                  <Send size={18} />
                </button>
              </div>
              <p className="text-[10px] text-center mt-3 text-slate-400 font-medium uppercase tracking-widest">
                Powered by MedVeda AI • Professional Guidance Required
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Login Dialog */}
      <Dialog 
        visible={isLoginVisible} 
        style={{ width: '440px' }} 
        onHide={() => setIsLoginVisible(false)}
        draggable={false}
        resizable={false}
        className="login-dialog"
        maskClassName="glass-mask"
        showHeader={false}
        dismissableMask={true}
      >
        <div className="relative flex flex-col items-center py-10 px-6">
          <button 
            onClick={() => setIsLoginVisible(false)}
            className="absolute top-2 right-2 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all"
            title="Close"
          >
            <X size={20} />
          </button>
          <div className="w-12 h-12 bg-medical-500 text-white rounded-xl flex items-center justify-center mb-6 shadow-lg shadow-medical-100">
            <HeartPulse size={28} />
          </div>
          
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Welcome back</h2>
          <p className="text-slate-500 text-center mb-10 px-4">
            Sign in to MedVeda AI to save your conversations and access them anywhere.
          </p>
          
          <div className="w-full space-y-4">
            <button 
              onClick={() => googleLogin()}
              className="w-full py-4 bg-white border border-slate-200 text-slate-700 font-bold rounded-2xl flex items-center justify-center gap-3 hover:bg-slate-50 hover:border-medical-300 hover:shadow-lg hover:shadow-medical-50 transition-all active:scale-[0.98] group"
              aria-label="Continue with Google"
            >
              <svg width="20" height="20" viewBox="0 0 18 18">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.347 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          </div>
          
          <div className="mt-10 flex items-center gap-1.5">
            <span className="text-sm text-slate-500">Don't have an account?</span>
            <button className="text-sm font-semibold text-medical-600 hover:text-medical-700 underline decoration-2 underline-offset-4">Sign up</button>
          </div>
        </div>
      </Dialog>
      {/* Logout Confirmation Dialog */}
      <Dialog 
        visible={isLogoutVisible} 
        style={{ width: '400px' }} 
        onHide={() => setIsLogoutVisible(false)}
        draggable={false}
        resizable={false}
        className="login-dialog"
        maskClassName="glass-mask"
        showHeader={false}
        dismissableMask={true}
      >
        <div className="relative flex flex-col items-center py-10 px-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-4 text-center">Are you sure you want to log out?</h2>
          <p className="text-slate-500 text-center mb-8 px-4">
            Log out of MedVeda AI as {user?.email}?
          </p>
          
          <div className="w-full space-y-3">
            <button 
              onClick={confirmLogout}
              className="w-full py-3 bg-slate-900 text-white font-bold rounded-full hover:bg-slate-800 transition-all active:scale-[0.98]"
            >
              Log out
            </button>
            <button 
              onClick={() => setIsLogoutVisible(false)}
              className="w-full py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-full hover:bg-slate-50 transition-all active:scale-[0.98]"
            >
              Cancel
            </button>
          </div>
        </div>
      </Dialog>

      {/* Login Loading Sequence */}
      <AnimatePresence>
        {isLoggingIn && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/60 backdrop-blur-xl"
          >
            <div className="relative">
              <div className="w-24 h-24 border-4 border-medical-100 border-t-medical-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center text-medical-600">
                <HeartPulse size={32} className="animate-pulse" />
              </div>
            </div>
            <motion.p 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mt-6 text-xl font-bold premium-text-gradient"
            >
              Setting up your workspace...
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
