import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const addLog = (message: string) => {
    const timestamp = new Date().toISOString().substring(11, 23);
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const connectSSE = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    addLog('Connecting to SSE...');
    const eventSource = new EventSource('/sse');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnected(true);
      addLog('SSE connection established');
    };

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'connected') {
        setSessionId(data.sessionId);
        addLog(`Received session ID: ${data.sessionId}`);
      } else if (data.type === 'message') {
        addLog(`Received: ${data.content}`);
      }
    };

    eventSource.onerror = (error) => {
      addLog('SSE connection error');
      setConnected(false);
      eventSource.close();
      eventSourceRef.current = null;
    };
  };

  const disconnectSSE = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setConnected(false);
      setSessionId(null);
      addLog('Disconnected from SSE');
    }
  };

  const sendMessage = async () => {
    if (!sessionId) {
      addLog('No active session');
      return;
    }

    const message = 'Hello from the client';
    addLog(`Sending: ${message}`);

    try {
      const response = await fetch('/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ message })
      });

      if (!response.ok) {
        const responseText = await response.text();
        
        // If it's a 410 Gone status, the connection was lost and we need to reconnect
        if (response.status === 410) {
          addLog('Connection lost, reconnecting...');
          disconnectSSE();
          setTimeout(connectSSE, 1000); // Reconnect after a short delay
          return;
        }
        
        throw new Error(`HTTP error ${response.status}: ${responseText}`);
      }

      addLog('Message sent successfully');
    } catch (error) {
      addLog(`Failed to send message: ${error}`);
    }
  };

  return (
    <div className="container">
      <h1>WebSockets/SSE Demo</h1>
      
      <div>
        <button onClick={connectSSE} disabled={connected}>
          Connect SSE
        </button>
        
        <button onClick={disconnectSSE} disabled={!connected}>
          Disconnect
        </button>
        
        <button onClick={sendMessage} disabled={!sessionId}>
          Send Message
        </button>
      </div>
      
      {sessionId && (
        <div className="session-info">
          Session ID: {sessionId}
        </div>
      )}
      
      <div className="logs">
        {logs.map((log, index) => (
          <div key={index}>{log}</div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);