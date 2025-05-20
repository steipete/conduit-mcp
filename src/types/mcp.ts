/**
 * Represents the base structure for an incoming MCP request.
 */
export interface MCPRequest {
  requestId?: string; // Optional request ID from the client
  toolName: string;    // The name of the tool being called (e.g., "read", "write")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: Record<string, any>; // Tool-specific parameters
}

/**
 * Represents the base structure for an MCP response from the server.
 * The actual content will be tool-specific.
 */
export interface MCPResponse {
  requestId?: string; // Echoed from the request if provided
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  response: any;      // The tool's specific response payload
} 