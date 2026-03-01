/**
 * PULSE WebSocket Client
 */

const MAX_QUEUE_SIZE = 500;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL = 5000;

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.serverUrl = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.shouldReconnect = false;
    this.destroyed = false; // FIX: prevents stale onclose from reconnecting

    this.queue = [];
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;

    this.onConnected = null;
    this.onDisconnected = null;
    this.onSegmentComplete = null;
    this.onError = null;
    this.onQueueDrain = null;
  }

  connect(host, sessionId) {
    if (this.isConnecting || this.isConnected) return;

    this.destroyed = false; // FIX: reset on new connect
    // Auto-detect wss:// for HTTPS hosts
    const protocol = host.startsWith('https') ? 'wss' : 'ws';
    const cleanHost = host.replace(/^https?:\/\//, '');
    this.serverUrl = `${protocol}://${cleanHost}/ws/${sessionId}`;
    this.sessionId = sessionId;
    this.shouldReconnect = true;
    this._connect();
  }

  _connect() {
    if (this.isConnecting || this.destroyed) return;
    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        if (this.destroyed) { this.ws.close(); return; } // FIX
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        console.log('[WS] Connected to', this.serverUrl);
        this._startHeartbeat();
        this._drainQueue();

        if (this.onConnected) this.onConnected();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (e) {
          console.warn('[WS] Parse error:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.warn('[WS] Error:', error);
        if (this.onError) this.onError(error);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        this._stopHeartbeat();

        console.log('[WS] Disconnected');
        if (this.onDisconnected) this.onDisconnected();

        // FIX: check destroyed flag — prevents reconnect after explicit disconnect()
        if (this.shouldReconnect && !this.destroyed) {
          this._scheduleReconnect();
        }
      };
    } catch (e) {
      this.isConnecting = false;
      console.error('[WS] Connection failed:', e);
      if (this.shouldReconnect && !this.destroyed) this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts++;

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) this._connect(); // FIX
    }, delay);
  }

  _handleMessage(data) {
    if (data.type === 'SEGMENT_COMPLETE') {
      if (this.onSegmentComplete) this.onSegmentComplete(data.segment);
    } else if (data.type === 'PONG') {
      // Heartbeat acknowledged
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this._rawSend(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
      }
    }, HEARTBEAT_INTERVAL);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  send(packet) {
    const json = JSON.stringify(packet);
    if (this.isConnected) {
      this._rawSend(json);
    } else {
      if (this.queue.length < MAX_QUEUE_SIZE) {
        this.queue.push(json);
      }
    }
  }

  _rawSend(json) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(json);
      }
    } catch (e) {
      console.warn('[WS] Send failed:', e);
    }
  }

  _drainQueue() {
    if (this.queue.length === 0) return;
    console.log(`[WS] Draining ${this.queue.length} queued packets`);
    const toSend = [...this.queue];
    this.queue = [];
    for (const json of toSend) this._rawSend(json);
    if (this.onQueueDrain) this.onQueueDrain(toSend.length);
  }

  disconnect() {
    this.shouldReconnect = false;
    this._stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Drain any remaining queued packets before closing
    if (this.isConnected && this.queue.length > 0) {
      this._drainQueue();
    }

    this.destroyed = true;      // FIX: set AFTER drain so _rawSend still works

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.queue = [];
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      queueSize: this.queue.length,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

export const wsClient = new WebSocketClient();
export default wsClient;
