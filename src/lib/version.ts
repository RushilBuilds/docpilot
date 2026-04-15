import { readFileSync } from 'fs';
import { join } from 'path';

function readVersion(): string {
  try {
    // __dirname is available in CJS (Node16 module output without "type":"module")
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export const VERSION = readVersion();
export const USER_AGENT = `docpilot/${VERSION} (MCP documentation server)`;
