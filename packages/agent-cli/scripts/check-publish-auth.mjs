// Verify the token npm publish will use, even when the current version is
// already published. Never print or persist the token.
// npm trusted publishing is not available on self-hosted runners:
// https://docs.npmjs.com/trusted-publishers/
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function readPublishToken(env = process.env) {
  const token = env.NODE_AUTH_TOKEN || env.NPM_TOKEN;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(
      'NPM_TOKEN is missing. Set the organization NPM_TOKEN secret with permission to publish @bloxwap/agent-cli.',
    );
  }
  return token;
}

export function assertCollaboratorWrite(name, username, access) {
  const permission = access?.[username];
  if (
    permission !== 'write' &&
    permission !== 'read-write' &&
    permission !== true
  ) {
    throw new Error(`npm token for ${username} cannot publish ${name}.`);
  }
}

export async function verifyPublishAuth({
  token = readPublishToken(),
  name,
  fetchImpl = fetch,
} = {}) {
  const whoami = await fetchImpl('https://registry.npmjs.org/-/whoami', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!whoami.ok) {
    throw new Error(
      `npm token authentication failed (HTTP ${whoami.status}). Check the organization NPM_TOKEN secret.`,
    );
  }
  const identity = await whoami.json();
  if (typeof identity.username !== 'string' || !identity.username) {
    throw new Error('npm whoami did not return a username.');
  }

  const escapedName = name.replace('/', '%2f');
  const collaborators = await fetchImpl(
    `https://registry.npmjs.org/-/package/${escapedName}/collaborators`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (collaborators.status === 404) {
    return {
      username: identity.username,
      unpublished: true,
      message: `npm accepted the organization NPM_TOKEN for ${name} as ${identity.username}; the package is not on the registry yet.`,
    };
  }
  if (!collaborators.ok) {
    throw new Error(
      `npm collaborator check failed (HTTP ${collaborators.status}). The NPM_TOKEN secret must be able to publish ${name}.`,
    );
  }
  const access = await collaborators.json();
  assertCollaboratorWrite(name, identity.username, access);
  return {
    username: identity.username,
    unpublished: false,
    message: `npm accepted the organization NPM_TOKEN for ${name} as ${identity.username}.`,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { name } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const result = await verifyPublishAuth({ name });
  console.log(result.message);
}
