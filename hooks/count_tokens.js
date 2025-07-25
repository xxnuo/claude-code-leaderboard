#!/usr/bin/env node

import { readFile, stat, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { homedir } from 'node:os';
import https from 'node:https';
import http from 'node:http';


const USER_HOME_DIR = homedir();
const XDG_CONFIG_DIR = process.env.XDG_CONFIG_HOME ?? `${USER_HOME_DIR}/.config`;
const DEFAULT_CLAUDE_CODE_PATH = '.claude';
const DEFAULT_CLAUDE_CONFIG_PATH = `${XDG_CONFIG_DIR}/claude`;
const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';
const CLAUDE_PROJECTS_DIR_NAME = 'projects';
const USAGE_DATA_GLOB_PATTERN = '**/*.jsonl';
const TRACKING_FILE = path.join(USER_HOME_DIR, '.claude', 'leaderboard_submitted.json');
const TRACKING_RETENTION_DAYS = 30;


function validateUsageData(data) {
  try {
    if (!data || typeof data !== 'object') return false;
    if (!data.timestamp) return false;
    if (!data.message || typeof data.message !== 'object') return false;
    if (!data.message.usage || typeof data.message.usage !== 'object') return false;
    
    const usage = data.message.usage;
    // Must have both input_tokens and output_tokens as numbers
    return typeof usage.input_tokens === 'number' && 
           typeof usage.output_tokens === 'number';
  } catch {
    return false;
  }
}


function getClaudePaths() {
  const paths = [];
  
  console.error(`[DEBUG] Getting Claude paths...`);
  console.error(`[DEBUG] Current working directory: ${process.cwd()}`);
  console.error(`[DEBUG] User home directory: ${USER_HOME_DIR}`);
  console.error(`[DEBUG] XDG_CONFIG_HOME: ${process.env.XDG_CONFIG_HOME || 'not set'}`);
  
  const envPaths = process.env[CLAUDE_CONFIG_DIR_ENV];
  if (envPaths) {
    console.error(`[DEBUG] Using CLAUDE_CONFIG_DIR from env: ${envPaths}`);
    paths.push(...envPaths.split(','));
  } else {
    console.error(`[DEBUG] Using default paths:`);
    console.error(`[DEBUG]   - ${DEFAULT_CLAUDE_CONFIG_PATH}`);
    console.error(`[DEBUG]   - ${USER_HOME_DIR}/${DEFAULT_CLAUDE_CODE_PATH}`);
    paths.push(DEFAULT_CLAUDE_CONFIG_PATH, `${USER_HOME_DIR}/${DEFAULT_CLAUDE_CODE_PATH}`);
  }
  
  const validPaths = paths.filter(p => {
    try {
      const projectsPath = path.join(p, CLAUDE_PROJECTS_DIR_NAME);
      const exists = existsSync(projectsPath);
      console.error(`[DEBUG] Checking path: ${p}`);
      console.error(`[DEBUG]   Projects dir: ${projectsPath}`);
      console.error(`[DEBUG]   Exists: ${exists}`);
      return exists;
    } catch (error) {
      console.error(`[DEBUG] Error checking path ${p}: ${error.message}`);
      return false;
    }
  });
  
  console.error(`[DEBUG] Valid Claude paths found: ${validPaths.length}`);
  return validPaths;
}


async function sortFilesByTimestamp(files) {
  const filesWithStats = await Promise.all(
    files.map(async (file) => {
      try {
        const stats = await stat(file);
        return { file, mtime: stats.mtime };
      } catch {
        return { file, mtime: new Date(0) };
      }
    })
  );
  
  return filesWithStats
    .sort((a, b) => b.mtime - a.mtime)
    .map(item => item.file);
}


function createUniqueHash(data) {
  const requestId = data.requestId;
  const messageId = data.message?.id;
  return requestId || messageId || null;
}


function parseUsageFromLine(line) {
  try {
    const data = JSON.parse(line.trim());
    
    // Validate the data structure matches ccusage schema
    if (!validateUsageData(data)) {
      console.error(`[DEBUG] Line failed validation:`, JSON.stringify(data).substring(0, 100));
      return null;
    }
    
    const usage = data.message.usage;
    const interactionId = createUniqueHash(data);
    
    const result = {
      timestamp: data.timestamp,
      tokens: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cache_creation: usage.cache_creation_input_tokens || 0,
        cache_read: usage.cache_read_input_tokens || 0
      },
      model: data.message.model || 'unknown',
      interaction_id: interactionId
    };
    
    console.error(`[DEBUG] Successfully parsed usage data: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    console.error(`[DEBUG] Error parsing line: ${error.message}`);
    return null;
  }
}


async function findJsonlFiles(dir) {
  const files = [];
  
  async function walkDir(currentPath) {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`[DEBUG] Error reading directory ${currentPath}: ${error.message}`);
    }
  }
  
  await walkDir(dir);
  return files;
}

async function getLatestTokenUsage() {
  const claudePaths = getClaudePaths();
  console.error(`[DEBUG] Claude paths found: ${claudePaths.join(', ')}`);
  if (claudePaths.length === 0) {
    console.error('[DEBUG] No Claude paths found');
    return null;
  }
  
  // Load tracking data to check what's already submitted
  const trackingData = await loadTracking();
  
  const allFiles = [];
  for (const claudePath of claudePaths) {
    const claudeDir = path.join(claudePath, CLAUDE_PROJECTS_DIR_NAME);
    try {
      const files = await findJsonlFiles(claudeDir);
      allFiles.push(...files);
    } catch (error) {
      continue;
    }
  }
  
  if (allFiles.length === 0) {
    console.error(`[DEBUG] No JSONL files found`);
    return null;
  }
  
  console.error(`[DEBUG] Found ${allFiles.length} JSONL files`);
  
  // Sort files by timestamp (newest first)
  const sortedFiles = await sortFilesByTimestamp(allFiles);
  
  // Look for the latest unsubmitted entry
  for (const file of sortedFiles) {
    try {
      const content = await readFile(file, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      
      // Process lines in reverse order (newest first)
      for (const line of lines.reverse()) {
        const usageData = parseUsageFromLine(line);
        if (!usageData || !usageData.interaction_id) continue;
        
        // Check if already submitted
        if (trackingData[usageData.interaction_id]) {
          continue; // Skip already submitted entries
        }
        
        // Found an unsubmitted entry
        console.error(`[DEBUG] Found unsubmitted entry: ${usageData.interaction_id} in ${path.basename(file)}`);
        return usageData;
      }
    } catch (error) {
      console.error(`[DEBUG] Error reading file ${file}: ${error.message}`);
      continue;
    }
  }
  
  console.error(`[DEBUG] No unsubmitted usage data found`);
  return null;
}


async function loadConfig() {
  const configPath = path.join(USER_HOME_DIR, '.claude', 'leaderboard.json');
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    
    return {
      twitterUrl: "@your_handle", 
      endpoint: "https://api.claudecount.com"
    };
  }
}


async function loadTracking() {
  try {
    const content = await readFile(TRACKING_FILE, 'utf-8');
    const data = JSON.parse(content);
    
    // Clean up old entries
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - TRACKING_RETENTION_DAYS);
    const cutoffTimestamp = cutoffDate.toISOString();
    
    const cleanedData = {};
    for (const [id, timestamp] of Object.entries(data)) {
      if (timestamp > cutoffTimestamp) {
        cleanedData[id] = timestamp;
      }
    }
    
    return cleanedData;
  } catch {
    // File doesn't exist or is invalid
    return {};
  }
}


async function saveTracking(trackingData) {
  try {
    // Ensure directory exists
    const dir = path.dirname(TRACKING_FILE);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    
    await writeFile(TRACKING_FILE, JSON.stringify(trackingData, null, 2));
    console.error(`[DEBUG] Saved tracking data with ${Object.keys(trackingData).length} entries`);
  } catch (error) {
    console.error(`[DEBUG] Failed to save tracking data: ${error.message}`);
  }
}


async function sendToAPI(endpoint, payload, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      const delay = Math.pow(2, attempt - 1) * 1000;
      console.error(`[DEBUG] Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    try {
      const result = await new Promise((resolve, reject) => {
        try {
          console.error(`[DEBUG] Sending payload to API: ${JSON.stringify(payload)}`);
          console.error(`[DEBUG] API endpoint: ${endpoint}`);
          
          const url = new URL(endpoint);
          const data = JSON.stringify(payload);
          
          const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data)
            },
            timeout: 30000 // 30 second timeout
          };
          
          const lib = url.protocol === 'https:' ? https : http;
          
          const req = lib.request(options, (res) => {
            let responseData = '';
            
            res.on('data', (chunk) => {
              responseData += chunk;
            });
            
            res.on('end', () => {
              console.error(`[DEBUG] API response status: ${res.statusCode} ${res.statusMessage}`);
              
              if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                  const result = JSON.parse(responseData);
                  console.error(`[DEBUG] API success response: ${JSON.stringify(result)}`);
                  resolve(result);
                } catch (e) {
                  resolve({ status: 'ok', response: responseData });
                }
              } else if (res.statusCode === 409) {
                // Conflict - duplicate submission, treat as success
                console.error(`[DEBUG] 409 Conflict - duplicate submission (this is OK)`);
                resolve({ status: 'duplicate', response: responseData });
              } else if (res.statusCode >= 500) {
                // Server error - retry
                reject(new Error(`Server error: ${res.statusCode}`));
              } else {
                // Client error - don't retry
                console.error(`[DEBUG] API error response: ${responseData}`);
                reject(new Error(`HTTP error! status: ${res.statusCode}`));
              }
            });
          });
          
          req.on('error', (error) => {
            console.error(`[DEBUG] Failed to send to API: ${error.message}`);
            console.error(`[DEBUG] Error type: ${error.constructor.name}`);
            reject(error);
          });
          
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
          });
          
          req.write(data);
          req.end();
        } catch (error) {
          console.error(`[DEBUG] Failed to send to API: ${error.message}`);
          console.error(`[DEBUG] Error type: ${error.constructor.name}`);
          reject(error);
        }
      });
      
      // Success - return result
      return result;
      
    } catch (error) {
      lastError = error;
      
      // Don't retry on client errors (4xx)
      if (error.message.includes('HTTP error') && !error.message.includes('Server error')) {
        throw error;
      }
      
      // Continue to next retry for server errors and network issues
      console.error(`[DEBUG] Attempt ${attempt + 1} failed: ${error.message}`);
    }
  }
  
  // All retries failed
  throw lastError || new Error('All retry attempts failed');
}

async function main() {
  try {
    // SIMPLIFIED APPROACH: Only read from JSONL files (matching ccusage behavior)
    // - No stdin processing to avoid double-counting
    // - No backlog processing to keep it simple
    // - Only submit the latest unsubmitted entry
    // - Use tracking file to prevent re-submissions
    
    // Load configuration first
    const config = await loadConfig();
    
    // Skip if not authenticated
    if (config.twitterUrl === "@your_handle") {
      console.error(`[INFO] User not authenticated - skipping submission`);
      process.exit(0);
    }
    
    // Load tracking data to check what's already submitted
    const trackingData = await loadTracking();
    console.error(`[INFO] Loaded tracking data with ${Object.keys(trackingData).length} submitted entries`);
    
    // Get latest unsubmitted usage data
    const usageData = await getLatestTokenUsage(trackingData);
    
    if (!usageData) {
      // Silently exit if no new data - this is normal
      process.exit(0);
    }
    
    const tokens = usageData.tokens;
    const totalTokens = tokens.input + tokens.output + tokens.cache_creation + tokens.cache_read;
    
    // ENHANCEMENT: Check if we have authenticated user data
    const apiPayload = {
      twitter_handle: config.twitterUrl,
      timestamp: usageData.timestamp,
      tokens: tokens,
      model: usageData.model,
      interaction_id: usageData.interaction_id
    };
    
    // ENHANCEMENT: Add twitter_user_id if available
    if (config.twitterUserId) {
      apiPayload.twitter_user_id = config.twitterUserId;
    }
    
    // Send to API endpoint
    try {
      const baseEndpoint = config.endpoint || "http://localhost:8000";
      const endpoint = `${baseEndpoint}/api/usage/hook`;
      console.error(`[INFO] Submitting to API: ${endpoint}`);
      
      const result = await sendToAPI(endpoint, apiPayload);
      console.error(`[INFO] ✅ Successfully submitted ${totalTokens} tokens`);
      
      // Save to tracking data to prevent re-submission
      if (usageData.interaction_id) {
        trackingData[usageData.interaction_id] = usageData.timestamp || new Date().toISOString();
        await saveTracking(trackingData);
      }
    } catch (apiError) {
      console.error(`[ERROR] Failed to submit to API: ${apiError.message}`);
      // Don't save to tracking on failure - will retry next time
    }
    
    // No backlog processing - keep it simple like ccusage
    
    console.error(`[INFO] ====== Hook completed successfully ======`);
    process.exit(0);
  } catch (error) {
    console.error(`[ERROR] Hook failed: ${error.message}`);
    process.exit(0); 
  }
}

main();