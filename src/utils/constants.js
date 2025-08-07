import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// API endpoint configuration
export const API_BASE_URL = process.env.API_BASE_URL || 'https://api.claudecount.com';

// Get CLI version from package.json dynamically
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packagePath = join(__dirname, '..', '..', 'package.json');
const packageData = JSON.parse(readFileSync(packagePath, 'utf-8'));

// CLI version - automatically read from package.json
export const CLI_VERSION = packageData.version;
export const MINIMUM_CLI_VERSION = '0.2.3';