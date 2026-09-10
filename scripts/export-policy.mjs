// Local working records stay in the development repository. This policy only
// controls clean exports; it never deletes or rewrites the original files.
const localFiles = new Set([
  'AGENTS.md', 'APPROVED_PLAN.md', 'HANDOFF.md', 'DESIGN.md', 'TRASH-FILES.md',
  'docs/private-github.md', 'docs/refactoring-20260909.md',
  'scripts/publish-private.mjs',
  'Restore Codex Connection.command',
]);
const localDirectories = [
  'TRASH/', 'specs/', 'docs/evidence/', 'docs/research/', 'docs/research-v2/',
  'docs/verification/', 'docs/design/', 'docs/superpowers/', 'docs/presentation/',
];

export function excludeFromSourceExport(path) {
  if (localFiles.has(path) || localDirectories.some(prefix => path.startsWith(prefix))) return true;
  if (/^packages\/desktop\/[^/]+\.md$/.test(path)) return true;
  return /^packages\/desktop\/(?:verify-[^/]+\.ts|[^/]+-evidence\.json)$/.test(path);
}
