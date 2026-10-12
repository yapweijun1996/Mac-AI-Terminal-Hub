import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export interface AccessConfig {
  teamDomain: string;
  audience: string;
  allowedEmail: string;
}

export function accessConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AccessConfig | null {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN;
  const audience = env.CF_ACCESS_AUD;
  const allowedEmail = env.CF_ACCESS_ALLOWED_EMAIL;
  if (!teamDomain || !audience?.trim() || !allowedEmail?.trim()) return null;
  try {
    const url = new URL(teamDomain);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) return null;
    return { teamDomain: url.origin, audience: audience.trim(), allowedEmail: allowedEmail.trim().toLowerCase() };
  } catch {
    return null;
  }
}

export function createAccessVerifier(config: AccessConfig, keySet?: JWTVerifyGetKey) {
  const issuer = config.teamDomain;
  const jwks = keySet ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 3000 });
  return async (token: string): Promise<JWTPayload> => {
    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      issuer,
      audience: config.audience,
      algorithms: ['RS256'],
      clockTolerance: 5
    });
    if (typeof payload.exp !== 'number') throw new Error('Token expiry is required');
    if (protectedHeader.typ && protectedHeader.typ !== 'JWT') throw new Error('Invalid token type');
    if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== config.allowedEmail) {
      throw new Error('Identity is not allowlisted');
    }
    if (payload.type !== 'app') throw new Error('Invalid Access token type');
    return payload;
  };
}

export type AccessVerifier = (token: string) => Promise<JWTPayload>;
