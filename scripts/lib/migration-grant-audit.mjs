/**
 * Detect table grants that hand structural privileges to API client roles.
 * RLS constrains row-level CRUD; it does not protect TRUNCATE/REFERENCES.
 * TRIGGER is also a schema-management privilege and is not needed by clients.
 */

const STRUCTURAL_PRIVILEGES = /\b(?:TRUNCATE|REFERENCES|TRIGGER)\b/i;
const CLIENT_ROLES = /\b(?:PUBLIC|anon|authenticated)\b/i;

function stripSqlComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\r\n]*/g, "");
}

export function findUnsafePublicTableGrants(source) {
  const sql = stripSqlComments(source);
  const grantPattern =
    /\bGRANT\s+([A-Z\s,]+)\s+ON\s+(?:ALL\s+TABLES\s+IN\s+SCHEMA\s+public|(?:TABLE\s+)?public\.[A-Z_][A-Z0-9_]*)\s+TO\s+([^;]+);/gi;
  const findings = [];

  for (const match of sql.matchAll(grantPattern)) {
    const privileges = match[1].replace(/\s+/g, " ").trim();
    const grantees = match[2].replace(/\s+/g, " ").trim();
    const grantsAll = /\bALL(?:\s+PRIVILEGES)?\b/i.test(privileges);

    if (CLIENT_ROLES.test(grantees) && (grantsAll || STRUCTURAL_PRIVILEGES.test(privileges))) {
      findings.push({
        statement: match[0].replace(/\s+/g, " ").trim(),
        privileges,
        grantees,
      });
    }
  }

  return findings;
}

/**
 * Default ACL grants affect objects created after the migration runs. Unlike
 * explicit table ACLs, any default grant to PostgREST client roles can expose
 * future public tables, sequences, or RPC functions before an owner-scoped
 * policy/explicit grant has been reviewed. The repo's policy is REVOKE-by-default
 * for PUBLIC, anon and authenticated; only service_role receives server ACLs.
 */
export function findUnsafePublicDefaultPrivileges(source) {
  const sql = stripSqlComments(source);
  const grantPattern =
    /\bALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*?\bGRANT\s+([A-Z\s,]+?)\s+ON\s+(TABLES|SEQUENCES|FUNCTIONS|ROUTINES)\s+TO\s+([^;]+);/gi;
  const findings = [];

  for (const match of sql.matchAll(grantPattern)) {
    const privileges = match[1].replace(/\s+/g, " ").trim();
    const objectType = match[2].toUpperCase();
    const grantees = match[3].replace(/\s+/g, " ").trim();

    if (CLIENT_ROLES.test(grantees)) {
      findings.push({
        statement: match[0].replace(/\s+/g, " ").trim(),
        privileges,
        objectType,
        grantees,
      });
    }
  }

  return findings;
}
