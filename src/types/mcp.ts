export interface MCPRequest {
  requestId?: string; // Optional, but good practice
  toolName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic MCP parameter structure
  parameters: Record<string, any>; // Or a more specific union of all possible tool params
}

export interface MCPResponse {
  requestId?: string; // Should mirror the request's ID if provided
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic MCP response structure
  response: any; // This will be specific to the tool's response structure
  // e.g., ReadTool.Response, PutTool.Response etc.
  // Or an MCPErrorStatus object.
}
