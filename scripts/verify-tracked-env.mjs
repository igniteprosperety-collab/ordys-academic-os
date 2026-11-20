import { existsSync, readFileSync } from "node:fs";

const allowedPublicVariables = new Set([
  "SUPABASE_PROJECT_ID",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "VITE_SUPABASE_PROJECT_ID",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
]);

const envPath = ".env";
const gitignorePath = ".gitignore";
const failures = [];

if (existsSync(envPath)) {
  const seen = new Set();
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.replace(/^export\s+/, "");
    const separator = normalized.indexOf("=");
    if (separator <= 0) {
      failures.push(`.env line ${index + 1}: malformed variable declaration`);
      continue;
    }

    const name = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      failures.push(`.env line ${index + 1}: invalid variable name`);
      continue;
    }
    if (!allowedPublicVariables.has(name)) {
      failures.push(`.env line ${index + 1}: non-allowlisted variable ${name}`);
    }
    if (seen.has(name)) {
      failures.push(`.env line ${index + 1}: duplicate variable ${name}`);
    }
    seen.add(name);
  }
}

const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
if (!gitignore.split(/\r?\n/).some((line) => line.trim() === ".env")) {
  failures.push(".gitignore must ignore the local .env file");
}

if (failures.length) {
  console.error("Tracked environment-file safety check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Environment-file safety check passed (variable names only; values were not inspected or printed).");
