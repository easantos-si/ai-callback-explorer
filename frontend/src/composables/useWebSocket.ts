import { ref } from 'vue';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth';
import type { CallbackEntry } from '@/types';

const debug = (...args: unknown[]): void => {
  if (import.meta.env.DEV) console.log(...args);
};

let socket: Socket | null = null;
let callbackHandler: ((entry: CallbackEntry) => void) | null = null;

const connected = ref(false);
const currentSessionId = ref<string | null>(null);

export function useWebSocket() {
  function connect(): void {
    if (socket?.connected) return;

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    const wsUrl = window.location.origin;
    const auth = useAuthStore();

    socket = io(wsUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      autoConnect: true,
      // Reads on every (re)connection attempt, so a freshly refreshed
      // token is picked up automatically. Empty when auth is disabled.
      auth: (cb) => cb({ token: auth.token }),
    });

    socket.on('connect', () => {
      connected.value = true;
      debug('[WS] Connected:', socket?.id);

      if (currentSessionId.value) {
        socket?.emit('join-session', {
          sessionId: currentSessionId.value,
        });
      }
    });

    socket.on('disconnect', (reason: string) => {
      connected.value = false;
      debug('[WS] Disconnected:', reason);
    });

    socket.on('connect_error', (error: Error) => {
      connected.value = false;
      if (import.meta.env.DEV) console.warn('[WS] Connection error:', error.message);
    });

    socket.on('joined-session', () => {
      debug('[WS] Joined session');
    });

    socket.on('callback-received', (entry: CallbackEntry) => {
      debug('[WS] Callback received:', entry.id);
      if (callbackHandler) {
        callbackHandler(entry);
      }
    });

    socket.on('error', (data: { message: string }) => {
      if (import.meta.env.DEV) console.error('[WS] Server error:', data.message);
    });
  }

  function joinSession(sessionId: string): void {
    if (currentSessionId.value && currentSessionId.value !== sessionId) {
      socket?.emit('leave-session', {
        sessionId: currentSessionId.value,
      });
    }

    currentSessionId.value = sessionId;

    if (socket?.connected) {
      socket.emit('join-session', { sessionId });
    }
  }

  function leaveSession(): void {
    if (currentSessionId.value && socket?.connected) {
      socket.emit('leave-session', {
        sessionId: currentSessionId.value,
      });
    }
    currentSessionId.value = null;
  }

  function onCallback(handler: (entry: CallbackEntry) => void): void {
    callbackHandler = handler;
  }

  function disconnect(): void {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    connected.value = false;
    currentSessionId.value = null;
    callbackHandler = null;
  }

  return {
    connected,
    currentSessionId,
    connect,
    joinSession,
    leaveSession,
    onCallback,
    disconnect,
  };
}
