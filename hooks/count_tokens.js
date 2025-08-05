#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { homedir } from 'node:os';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';

// Version constant - must match CLI_VERSION in constants.js
const CLI_VERSION = '0.2.0';

const USER_HOME_DIR = homedir();
const XDG_CONFIG_DIR = process.env.XDG_CONFIG_HOME ?? `${USER_HOME_DIR}/.config`;
const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';
const CLAUDE_PROJECTS_DIR = 'projects';

// Get Claude configuration paths
function getClaudePaths() {
  const envPaths = process.env[CLAUDE_CONFIG_DIR_ENV];
  const paths = envPaths 
    ? envPaths.split(',')
    : [`${XDG_CONFIG_DIR}/claude`, `${USER_HOME_DIR}/.claude`];
  
  return paths.filter(p => existsSync(path.join(p, CLAUDE_PROJECTS_DIR)));
}

// Parse usage data from JSONL line
function parseUsageFromLine(line) {
  try {
    const data = JSON.parse(line.trim());
    
    // Validate required fields
    if (!data?.timestamp || !data?.message?.usage) return null;
    
    const usage = data.message.usage;
    if (typeof usage.input_tokens !== 'number' || 
        typeof usage.output_tokens !== 'number') return null;
    
    // Generate interaction hash for deduplication
    const hashInput = `${data.timestamp}${data.message?.id || ''}${data.requestId || ''}`;
    const interactionHash = crypto.createHash('sha256').update(hashInput).digest('hex');
    
    return {
      timestamp: data.timestamp,
      tokens: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cache_creation: usage.cache_creation_input_tokens || 0,
        cache_read: usage.cache_read_input_tokens || 0
      },
      model: data.message.model || 'unknown',
      interaction_hash: interactionHash
    };
  } catch {
    return null;
  }
}

// Get the most recent usage entry from JSONL files
async function getLatestUsageEntry() {
  const claudePaths = getClaudePaths();
  if (claudePaths.length === 0) return null;
  
  let latestEntry = null;
  let latestTime = 0;
  
  for (const claudePath of claudePaths) {
    const projectsDir = path.join(claudePath, CLAUDE_PROJECTS_DIR);
    
    try {
      // Find all JSONL files recursively
      const files = await findJsonlFiles(projectsDir);
      
      for (const file of files) {
        const content = await readFile(file, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line.length > 0);
        
        // Check last line (most recent)
        if (lines.length > 0) {
          const entry = parseUsageFromLine(lines[lines.length - 1]);
          if (entry) {
            const entryTime = new Date(entry.timestamp).getTime();
            if (entryTime > latestTime) {
              latestTime = entryTime;
              latestEntry = entry;
            }
          }
        }
      }
    } catch {
      // Skip on error
    }
  }
  
  return latestEntry;
}

// Recursively find JSONL files
async function findJsonlFiles(dir) {
  const files = [];
  
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        files.push(...await findJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip on error
  }
  
  return files;
}

// Load configuration
async function loadConfig() {
  const configPath = path.join(USER_HOME_DIR, '.claude', 'leaderboard.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Send usage data to API
async function sendToAPI(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const data = JSON.stringify(payload);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-CLI-Version': CLI_VERSION  // Add version header for backend validation
      },
      timeout: 10000 // 10 second timeout
    };
    
    const lib = url.protocol === 'https:' ? https : http;
    
    const req = lib.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        // Accept any 2xx status as success
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(responseData));
          } catch {
            resolve({ success: true });
          }
        } else if (res.statusCode === 426) {
          // Version upgrade required - show error and exit with code 2
          try {
            const error = JSON.parse(responseData);
            console.error(`\n❌ ${error.detail?.message || error.message || 'CLI version outdated'}`);
            process.exit(2); // Exit code 2 blocks Claude
          } catch {
            console.error('\n❌ CLI version outdated. Run: npx claude-code-leaderboard@latest');
            process.exit(2); // Exit code 2 blocks Claude
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    
    req.write(data);
    req.end();
  });
}

// Main function
async function main() {
  try {
    // Load configuration
    const config = await loadConfig();
    if (!config || config.twitterUrl === "@your_handle") {
      // Not authenticated - exit silently
      process.exit(0);
    }
    
    // Get latest usage entry
    const usageEntry = await getLatestUsageEntry();
    if (!usageEntry) {
      // No usage data - exit silently
      process.exit(0);
    }
    
    // Prepare API payload
    const payload = {
      twitter_handle: config.twitterUrl,
      twitter_user_id: config.twitterUserId || config.twitterUrl,
      timestamp: usageEntry.timestamp,
      tokens: usageEntry.tokens,
      model: usageEntry.model,
      interaction_id: usageEntry.interaction_hash,
      interaction_hash: usageEntry.interaction_hash
    };
    
    // Send to API endpoint
    try {
      const baseEndpoint = config.endpoint || 'https://api.claudecount.com';
      const endpoint = `${baseEndpoint}/api/usage/hook`;
      
      await sendToAPI(endpoint, payload);
    } catch (apiError) {
      console.error(`[ERROR] Failed to submit to API: ${apiError.message}`);
      // Don't save to tracking on failure - will retry next time
    }
    
    process.exit(0);
  } catch (error) {
    console.error(`[ERROR] Hook failed: ${error.message}`);
    process.exit(1);
  }
}

main();