import { describe, expect, it } from 'vitest';

import { hostInstallationArtifacts, type SessionHost } from '../src/index.js';

const cliCommand = [
  'npm',
  'exec',
  '--yes',
  '--package=telesarch@0.1.0',
  '--',
  'telesarch',
] as const;

describe('session host installation', () => {
  it.each<SessionHost>(['codex', 'claude'])(
    'installs project-neutral %s roles and entry skill',
    (host) => {
      const artifacts = hostInstallationArtifacts(host, cliCommand);
      const paths = artifacts.map((artifact) => artifact.relativePath);

      expect(paths).toContain('skills/telesarch-workflow/SKILL.md');
      const skill = artifacts.find(
        (artifact) =>
          artifact.relativePath === 'skills/telesarch-workflow/SKILL.md',
      );
      expect(skill?.content).toContain(
        'Never use inside a Telesarch role agent.',
      );
      expect(skill?.content).toContain(
        '`{"nodeId":"<assignment.subjectNodeId>"}`',
      );
      expect(skill?.content).toContain('Never pass the delivery ID.');
      expect(skill?.content).toContain('`fork_turns: "none"` in Codex');
      expect(skill?.content).toContain(
        'wait with the longest supported timeout',
      );
      expect(skill?.content).toContain(
        'A role message or a wait result with no completed role means the role is still running',
      );
      expect(skill?.content).toContain(
        'Call `next_action` only after that role returns `FINAL_ANSWER`',
      );
      expect(
        paths.some((path) => path.includes('telesarch-decomposition')),
      ).toBe(true);
      expect(paths.every((path) => !path.includes('config'))).toBe(true);
      expect(
        artifacts.every(
          (artifact) =>
            !artifact.content.includes('## Call:') &&
            !artifact.content.includes('## Guidance:'),
        ),
      ).toBe(true);
    },
  );

  it('gives role agents only the role MCP and fixed host restrictions', () => {
    const implementation = hostInstallationArtifacts('codex', cliCommand).find(
      (artifact) =>
        artifact.relativePath === 'agents/telesarch-implementation.toml',
    );
    const decomposition = hostInstallationArtifacts('codex', cliCommand).find(
      (artifact) =>
        artifact.relativePath === 'agents/telesarch-decomposition.toml',
    );

    expect(implementation?.content).toContain(
      'sandbox_mode = "workspace-write"',
    );
    expect(implementation?.content).not.toContain('project_doc_max_bytes');
    expect(decomposition?.content).toContain('sandbox_mode = "read-only"');
    expect(decomposition?.content).toContain('[mcp_servers.telesarch-role]');
    expect(decomposition?.content).toContain('command = "npm"');
    expect(decomposition?.content).toContain(
      'args = ["exec", "--yes", "--package=telesarch@0.1.0", "--", "telesarch", "mcp", "role"]',
    );
    expect(decomposition?.content).toContain('source_context');
    expect(decomposition?.content).toContain('delivery_revision_impact');
    expect(decomposition?.content).toContain(
      'Do not use the telesarch-workflow skill',
    );
    expect(decomposition?.content).toContain(
      'tools.mcp__telesarch_role__pull_assignment',
    );
    expect(decomposition?.content).toContain(
      'tools.mcp__telesarch_role__submit_result',
    );
    expect(decomposition?.content).toContain(
      '[mcp_servers.telesarch-storybook]',
    );
    expect(decomposition?.content).toContain(
      'args = ["exec", "--yes", "--package=telesarch@0.1.0", "--", "telesarch", "mcp", "storybook"]\nenabled = false',
    );
    const storybook = hostInstallationArtifacts('codex', cliCommand).find(
      (artifact) =>
        artifact.relativePath === 'agents/telesarch-storybook-composition.toml',
    );
    expect(storybook?.content).toContain(
      'args = ["exec", "--yes", "--package=telesarch@0.1.0", "--", "telesarch", "mcp", "storybook"]\nenabled = true',
    );
    expect(storybook?.content).toContain('preview_stories');

    const claudeStorybook = hostInstallationArtifacts(
      'claude',
      cliCommand,
    ).find(
      (artifact) =>
        artifact.relativePath === 'agents/telesarch-storybook-composition.md',
    );
    expect(claudeStorybook?.content).toContain(
      'mcp__telesarch-storybook__preview_stories',
    );
  });
});
