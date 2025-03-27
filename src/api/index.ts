import { DurableObject } from "cloudflare:workers";

export interface Env {
  DO_OBJECT: DurableObjectNamespace<WebSocketDO>;
  ASSETS: Fetcher;
}

// Durable Object that handles WebSocket connections
export class WebSocketDO extends DurableObject<Env> {
  // Store WebSocket connections by session ID
  webSocketConnections = new Map<string, WebSocket>();

  // Get the storage for this Durable Object
  storage: DurableObjectStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    console.log("DO received request:", url.pathname);

    // Handle WebSocket connections for any path
    // Extract session ID from the URL
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      return new Response("Missing sessionId", { status: 400 });
    }

    console.log("WebSocket connection for session:", sessionId);

    // Create a new WebSocket pair
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    // Accept the WebSocket with hibernation support
    this.ctx.acceptWebSocket(server);

    // Store the connection for later use
    this.webSocketConnections.set(sessionId, server);

    // Store the session ID in storage to survive hibernation
    await this.storage.put(`session:${sessionId}`, true);

    // Send initial connection message
    server.send(JSON.stringify({ type: "connected", sessionId }));

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // RPC endpoint for sending messages
  async postMessage(data: {
    sessionId: string;
    message: string;
  }): Promise<Response> {
    const { sessionId, message } = data;

    console.log(
      "RPC postMessage for session:",
      sessionId,
      "with message:",
      message
    );

    if (!sessionId) {
      return new Response("Missing sessionId", { status: 400 });
    }

    // Check if we have this session in storage
    const sessionExists = await this.storage.get(`session:${sessionId}`);
    if (!sessionExists) {
      console.error(`Session ${sessionId} not found in storage`);
      return new Response("Session not found", { status: 404 });
    }

    const webSocket = this.webSocketConnections.get(sessionId);
    if (!webSocket) {
      console.error(
        `WebSocket for session ${sessionId} not found in memory, but exists in storage`
      );
      // This can happen if the DO was hibernated and restored
      return new Response("WebSocket connection lost, please reconnect", {
        status: 410,
      });
    }

    try {
      // Echo the message back through the WebSocket
      webSocket.send(
        JSON.stringify({
          type: "message",
          content: message,
        })
      );

      return new Response("Message relayed", { status: 200 });
    } catch (error) {
      console.error(`Error sending message to WebSocket: ${error}`);
      // Clean up the failed connection
      this.webSocketConnections.delete(sessionId);
      return new Response(`Error relaying message: ${error}`, { status: 500 });
    }
  }

  // WebSocket event handlers for hibernation support
  webSocketMessage(ws: WebSocket, message: string) {
    try {
      // Parse the incoming message
      const data = JSON.parse(message);

      // Echo back the message
      ws.send(
        JSON.stringify({
          type: "message",
          content: data.message || "Echo: " + message,
        })
      );
    } catch {
      // If parsing fails, send error message
      ws.send(
        JSON.stringify({
          type: "error",
          content: "Failed to process message",
        })
      );
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ) {
    // Find and remove the closed connection
    for (const [sessionId, storedWs] of this.webSocketConnections.entries()) {
      if (storedWs === ws) {
        console.log(
          `WebSocket closed for session ${sessionId}: code=${code}, reason=${reason}, wasClean=${wasClean}`
        );
        this.webSocketConnections.delete(sessionId);

        // Remove from persistent storage too
        await this.storage.delete(`session:${sessionId}`);
        break;
      }
    }
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    console.error("WebSocket error:", error);

    // Clean up on error too
    for (const [sessionId, storedWs] of this.webSocketConnections.entries()) {
      if (storedWs === ws) {
        console.log(`Removing session ${sessionId} due to WebSocket error`);
        this.webSocketConnections.delete(sessionId);
        await this.storage.delete(`session:${sessionId}`);
        break;
      }
    }
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const durableObjectId = "12345";

    // Handle SSE connections
    if (url.pathname.startsWith("/sse")) {
      // Generate a unique session ID
      const sessionId = crypto.randomUUID();

      // Create a Transform Stream for SSE
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Send initial connection message with session ID
      const initialData = JSON.stringify({ type: "connected", sessionId });
      writer.write(encoder.encode(`data: ${initialData}\n\n`));

      // Open a WebSocket connection to the Durable Object
      const id = env.DO_OBJECT.idFromName(durableObjectId);
      const doStub = env.DO_OBJECT.get(id);

      // Create WebSocket connection to the Durable Object
      // Pass sessionId as query param but use any path with WebSocket upgrade header
      const doUrl = new URL(request.url);
      doUrl.searchParams.set("sessionId", sessionId);

      // Connect to the Durable Object via WebSocket
      const response = await doStub.fetch(doUrl.toString(), {
        headers: {
          Upgrade: "websocket",
        },
      });

      const ws = response.webSocket;
      if (!ws) {
        return new Response(
          "Failed to establish WebSocket connection to the Durable Object",
          { status: 500 }
        );
      }

      // Accept the WebSocket connection
      ws.accept();

      // Handle messages from the Durable Object
      ws.addEventListener("message", async (event) => {
        try {
          // Forward the message to the SSE client
          await writer.write(encoder.encode(`data: ${event.data}\n\n`));
        } catch (error) {
          console.error("Error sending SSE message:", error);
        }
      });

      // Handle WebSocket closure
      ws.addEventListener("close", async () => {
        try {
          // Close the SSE connection when the WebSocket closes
          await writer.close();
        } catch (error) {
          console.error("Error closing SSE connection:", error);
        }
      });

      // Handle worker unload by closing the connection
      ctx.waitUntil(
        (async () => {
          // Keep the worker alive for the duration of the SSE connection
        })()
      );

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
    // Handle message route
    else if (url.pathname.startsWith("/message") && request.method === "POST") {
      // Get session ID from headers
      const sessionId = request.headers.get("X-Session-ID");
      if (!sessionId) {
        return new Response("Missing session ID", { status: 400 });
      }

      console.log("Worker received message request for session:", sessionId);

      try {
        // Get the message content from the request body
        const data = await request.json();
        const message = data.message;

        if (!message) {
          return new Response("Missing message content", { status: 400 });
        }

        // Get a stub for the Durable Object
        const id = env.DO_OBJECT.idFromName(durableObjectId);
        const doStub = env.DO_OBJECT.get(id);

        // Call the RPC endpoint on the Durable Object
        console.log("Calling RPC postMessage method for session:", sessionId);

        const doResponse = await doStub.postMessage({
          sessionId,
          message,
        });

        if (!doResponse.ok) {
          const errorText = await doResponse.text();
          console.error(
            `DO returned error: ${doResponse.status} - ${errorText}`
          );

          if (doResponse.status === 410) {
            // Connection lost, client should reconnect
            return new Response("Connection lost, please reconnect", {
              status: 410,
            });
          }

          return new Response(`Failed to relay message: ${errorText}`, {
            status: 500,
          });
        }

        return new Response("Message sent", { status: 200 });
      } catch (error) {
        console.error("Error processing message:", error);
        return new Response(`Error processing message: ${error}`, {
          status: 500,
        });
      }
    }
    // Serve static assets for everything else
    else {
      return env.ASSETS.fetch(request);
    }
  },
} satisfies ExportedHandler<Env>;
