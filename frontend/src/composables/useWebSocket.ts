import { ref } from 'vue';
import { io, Socket } from 'socket.io-client';
import type { CallbackEntry } from '@/types';

// Singleton socket instance
let socket: Socket | null = null;
let callbackHandler: ((entry: CallbackEntry) => void) | null = null;

const connected = ref(false);
const currentSessionId = ref<string | null>(null);

export function useWebSocket() {
  function connect(): void {
    if (socket?.connected) return;

    // Disconnect existing socket if any
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }

    const wsUrl = window.location.origin;

    socket = io(wsUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      autoConnect: true,
    });

    socket.on('connect', () => {
      connected.value = true;
      console.log('[WS] Connected:', socket?.id);

      // Re-join session after reconnection
      if (currentSessionId.value) {
        socket?.emit('join-session', {
          sessionId: currentSessionId.value,
        });
      }
    });

    socket.on('disconnect', (reason: string) => {
      connected.value = false;
      console.log('[WS] Disconnected:', reason);
    });

    socket.on('connect_error', (error: Error) => {
      connected.value = false;
      console.warn('[WS] Connection error:', error.message);
    });

    socket.on('joined-session', (data: { sessionId: string }) => {
      console.log('[WS] Joined session:', data.sessionId);
    });

    socket.on('callback-received', (entry: CallbackEntry) => {
      console.log('[WS] Callback received:', entry.id);
      if (callbackHandler) {
        callbackHandler(entry);
      }
    });

    socket.on('error', (data: { message: string }) => {
      console.error('[WS] Server error:', data.message);
    });
  }

  function joinSession(sessionId: string): void {
    // Leave previous
    if (currentSessionId.value && currentSessionId.value !== sessionId) {
      socket?.emit('leave-session', {
        sessionId: currentSessionId.value,
      });
    }

    currentSessionId.value = sessionId;

    if (socket?.connected) {
      socket.emit('join-session', { sessionId });
    }
    // If not connected yet, the 'connect' handler will auto-join
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
