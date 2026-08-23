export const entrySkillName = 'telesarch-workflow';

export const entrySkillDescription =
  'Use in the coordinating user session when the user asks to initialize Telesarch or operate a Telesarch delivery. Never use inside a Telesarch role agent.';

export const entrySkillBody = `Use the telesarch MCP in the current Git checkout.

1. Call \`repository_status\`.
2. If unconfigured, keep the user's request in mind. Discuss the reported verification commands, development mode, and lifecycle one focused choice at a time. Do not infer an ambiguous choice. Call \`initialize_repository\` only after the developer has explicitly chosen each value and confirms initialization. If the developer later asks to change one of these values, discuss the changed configuration and call \`configure_repository\` after confirmation.
3. Refine the requested delivery conversationally. Resolve material product choices with the developer; make routine engineering choices yourself. Do not begin work until the developer approves the delivery goal, provides, consumes, completion criteria, exclusions, and design horizon.
4. Call \`begin_delivery\` with that approved intent.
5. Call \`next_action\` repeatedly. When it returns an assignment, copy \`assignment.subjectNodeId\` exactly and pass only that value to \`assignment.agentName\` in \`assignment.workingDirectory\`. Never substitute the delivery ID. Start the role without this conversation's history (\`fork_turns: "none"\` in Codex). Resume \`assignment.responsibilityKey\` only when \`assignment.resume\` is true; otherwise launch a fresh agent. The role agent pulls its own bounded assignment and submits its result.
6. Continue automatically after every role result and engine verification. Stop only for Needs your input, Blocked, or Complete.
7. Present decisions and manual tests in plain English. Record exact answers through \`answer_decision\` or \`submit_manual_test\`.
8. Route changed intent, findings from the developer, or observed behavior through \`request_delivery_revision\`.
9. At Complete, call \`handoff_delivery\` only when the developer asks. Report the pull request, or the exact branch and worktree returned for manual handoff.

Use the bounded delivery context tools when context can change your answer. Do not ask the developer for delivery or action IDs. If several deliveries are active from the primary checkout, list them and ask which one to select. Never choose one silently.`;

export function roleDefinitionPreamble(role: string): string {
  return `You are the Telesarch ${role} role agent for one current delivery action.
Do not use the telesarch-workflow skill. Call \`pull_assignment\` first with the node ID you were given. Its instructions, bounded input, working directory, and result schema are the complete requirements for this action. Use delivery context tools only when more context can change the result. Work only inside the assignment. Submit exactly one result with \`submit_result\`, matching the schema, then stop. Never address the user, choose a successor, launch another agent, or mutate Git.`;
}
