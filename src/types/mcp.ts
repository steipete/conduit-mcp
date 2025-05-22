export interface MCPRequest {
  requestId?: string; // Optional, but good practice
  toolName: string;
  parameters: Record<string, any>; // Or a more specific union of all possible tool params
}

export interface MCPResponse {
  requestId?: string; // Should mirror the request's ID if provided
  response: any; // This will be specific to the tool's response structure
  // e.g., ReadTool.Response, PutTool.Response etc.
  // Or an MCPErrorStatus object.
}
