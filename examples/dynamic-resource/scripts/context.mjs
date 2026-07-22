const input = JSON.parse(process.env.AGENT_GRAPH_INPUT ?? "null");
process.stdout.write(`${JSON.stringify({
  workspace: process.env.AGENT_GRAPH_WORKSPACE,
  revision: process.env.AGENT_GRAPH_REVISION,
  input,
})}\n`);
