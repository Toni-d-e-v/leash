// stdout carries the MCP protocol, so anything a library logs goes to stderr instead.
// Imported first by server.ts, before modules that might log on load.
console.log = console.info = console.debug = (...args: unknown[]) => console.error(...args);
