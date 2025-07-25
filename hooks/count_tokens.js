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

async function getAllUnsubmittedUsage(trackingData = {}, limit = 10) {
  const claudePaths = getClaudePaths();
  if (claudePaths.length === 0) {
    return [];
  }
  
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
    return [];
  }
  
  const sortedFiles = await sortFilesByTimestamp(allFiles);
  const unsubmittedEntries = [];
  const processedHashes = new Set();
  
  // Check recent files for unsubmitted entries
  for (const file of sortedFiles.slice(0, 50)) { // Check up to 50 files
    if (unsubmittedEntries.length >= limit) break;
    
    try {
      const content = await readFile(file, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      
      // Process lines in chronological order (oldest first)
      for (const line of lines) {
        if (unsubmittedEntries.length >= limit) break;
        
        const usageData = parseUsageFromLine(line);
        if (!usageData) continue;
        
        const uniqueHash = usageData.interaction_id;
        
        // Skip if no ID, already processed in this scan, or already submitted
        if (!uniqueHash || processedHashes.has(uniqueHash) || trackingData[uniqueHash]) {
          continue;
        }
        
        processedHashes.add(uniqueHash);
        unsubmittedEntries.push(usageData);
      }
    } catch (error) {
      continue;
    }
  }
  
  console.error(`[DEBUG] Found ${unsubmittedEntries.length} unsubmitted entries`);
  return unsubmittedEntries;
}

async function getLatestTokenUsage() {
  const claudePaths = getClaudePaths();
  console.error(`Claude paths found: ${claudePaths.join(', ')}`);
  if (claudePaths.length === 0) {
    console.error('No Claude paths found');
    return null;
  }
  
  
  const allFiles = [];
  for (const claudePath of claudePaths) {
    const claudeDir = path.join(claudePath, CLAUDE_PROJECTS_DIR_NAME);
    console.error(`[DEBUG] Searching for JSONL files in: ${claudeDir}`);
    try {
      const files = await findJsonlFiles(claudeDir);
      console.error(`[DEBUG] Found ${files.length} files in ${claudeDir}`);
      if (files.length > 0) {
        console.error(`[DEBUG] Sample files: ${files.slice(0, 3).join(', ')}`);
      }
      allFiles.push(...files);
    } catch (error) {
      console.error(`[DEBUG] Error searching in ${claudeDir}: ${error.message}`);
      continue;
    }
  }
  
  if (allFiles.length === 0) {
    console.error(`No JSONL files found in paths: ${claudePaths.join(', ')}`);
    return null;
  }
  
  console.error(`Found ${allFiles.length} JSONL files`);
  console.error(`First few files: ${allFiles.slice(0, 3).join(', ')}`);
  
  
  const sortedFiles = await sortFilesByTimestamp(allFiles);
  
  
  const processedHashes = new Set();
  const maxFilesToCheck = 20; // Check more files
  const filesToCheck = sortedFiles.slice(0, maxFilesToCheck);
  
  console.error(`[DEBUG] Checking ${filesToCheck.length} most recent files out of ${sortedFiles.length} total`);
  
  for (const file of filesToCheck) {
    try {
      const content = await readFile(file, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      
      console.error(`[DEBUG] File ${path.basename(file)} has ${lines.length} lines`);
      
      // Process lines in reverse order (newest first)
      for (const line of lines.reverse()) {
        const usageData = parseUsageFromLine(line);
        if (!usageData) continue;
        
        const uniqueHash = usageData.interaction_id;
        if (uniqueHash && processedHashes.has(uniqueHash)) {
          continue;
        }
        
        if (uniqueHash) {
          processedHashes.add(uniqueHash);
        }
        
        // Return the first valid, non-duplicate usage found
        console.error(`[DEBUG] Found valid usage data in file ${path.basename(file)}`);
        return usageData;
      }
    } catch (error) {
      console.error(`[DEBUG] Error reading/parsing file ${file}: ${error.message}`);
      continue;
    }
  }
  
  console.error(`[DEBUG] No valid usage data found after checking ${filesToCheck.length} files`);
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
    console.error(`[DEBUG] ====== Hook execution started ======`);
    console.error(`[DEBUG] Script path: ${process.argv[1]}`);
    console.error(`[DEBUG] Process ID: ${process.pid}`);
    console.error(`[DEBUG] Node version: ${process.version}`);
    
    // Also log to file to verify hook is running
    const logFile = path.join(USER_HOME_DIR, '.claude', 'hook_debug.log');
    const logEntry = `[${new Date().toISOString()}] Hook started - PID: ${process.pid} CWD: ${process.cwd()}\n`;
    await readFile(logFile, 'utf-8').catch(() => '').then(async (content) => {
      await writeFile(logFile, content + logEntry);
    });
    

    // Read hook data from stdin (Claude passes data via stdin)
    let hookData = null;
    let usageData = null;
    
    try {
      const stdin = process.stdin;
      stdin.setEncoding('utf-8');
      let data = '';
      for await (const chunk of stdin) {
        data += chunk;
      }
      if (data.trim()) {
        hookData = JSON.parse(data);
        console.error(`[DEBUG] Received hook data from stdin: ${JSON.stringify(hookData)}`);
        
        // Parse usage data from stdin if available
        if (hookData && hookData.message && hookData.message.usage) {
          const usage = hookData.message.usage;
          const interactionId = hookData.requestId || hookData.message?.id || null;
          
          usageData = {
            timestamp: hookData.timestamp || new Date().toISOString(),
            tokens: {
              input: usage.input_tokens || 0,
              output: usage.output_tokens || 0,
              cache_creation: usage.cache_creation_input_tokens || 0,
              cache_read: usage.cache_read_input_tokens || 0
            },
            model: hookData.message.model || 'unknown',
            interaction_id: interactionId,
            source: 'stdin'
          };
          console.error(`[DEBUG] Parsed usage data from stdin: ${JSON.stringify(usageData)}`);
        }
      } else {
        console.error(`[DEBUG] No hook data received from stdin`);
      }
    } catch (error) {
      console.error(`[DEBUG] Error reading stdin: ${error.message}`);
    }
    
    // If no stdin data, fall back to JSONL scanning
    if (!usageData) {
      console.error(`[DEBUG] No stdin usage data, falling back to JSONL scanning...`);
      usageData = await getLatestTokenUsage();
    }
    
    if (!usageData) {
      console.error('[DEBUG] No token usage data found - exiting gracefully');
      console.error(`[DEBUG] ====== Hook execution ended (no data) ======`);
      process.exit(0);
    }
    
    console.error(`[DEBUG] Found usage data: ${JSON.stringify(usageData)}`)
    
    
    const tokens = usageData.tokens;
    const totalTokens = tokens.input + tokens.output + tokens.cache_creation + tokens.cache_read;
    
    
    const config = await loadConfig();
    
    // Skip submission if not authenticated (using default handle)
    if (config.twitterUrl === "@your_handle") {
      console.error(`[DEBUG] User not authenticated - skipping API submission`);
      console.error(`[DEBUG] ====== Hook execution ended (not authenticated) ======`);
      process.exit(0);
    }
    
    // Load tracking data
    const trackingData = await loadTracking();
    
    // Check if this interaction was already submitted
    if (usageData.interaction_id && trackingData[usageData.interaction_id]) {
      console.error(`[DEBUG] Interaction ${usageData.interaction_id} already submitted at ${trackingData[usageData.interaction_id]}`);
      console.error(`[DEBUG] ====== Hook execution ended (duplicate) ======`);
      process.exit(0);
    }
    
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
      console.error(`[DEBUG] Adding authenticated user ID: ${config.twitterUserId}`);
    }
    
    // Log to console instead of file
    console.error(
      `[${usageData.timestamp}] ` +
      `Total: ${totalTokens} tokens ` +
      `(Input: ${tokens.input}, Output: ${tokens.output}, ` +
      `Cache Create: ${tokens.cache_creation}, Cache Read: ${tokens.cache_read}) ` +
      `Model: ${usageData.model} ID: ${usageData.interaction_id}`
    );
    
    // Send to API endpoint
    try {
      const baseEndpoint = config.endpoint || "http://localhost:8000";
      const endpoint = `${baseEndpoint}/api/usage/hook`;
      console.error(`Sending to API: ${endpoint}`);
      
      const result = await sendToAPI(endpoint, apiPayload);
      console.error(`API Response: ${JSON.stringify(result)}`);
      
      // Log successful submission
      console.error(`[${new Date().toISOString()}] Successfully sent to API: ${totalTokens} tokens`);
      
      // Save to tracking data if interaction_id exists
      if (usageData.interaction_id) {
        trackingData[usageData.interaction_id] = usageData.timestamp || new Date().toISOString();
        await saveTracking(trackingData);
        console.error(`[DEBUG] Saved interaction ${usageData.interaction_id} to tracking`);
      }
    } catch (apiError) {
      console.error(`Failed to send to API: ${apiError.message}`);
      // Log API failure but don't fail the hook
      console.error(`[${new Date().toISOString()}] API submission failed: ${apiError.message}`);
      // Don't save to tracking on failure - will retry next time
    }
    
    // After processing stdin data, check for any backlog of unsubmitted entries
    if (usageData.source === 'stdin') {
      console.error(`[DEBUG] Checking for backlog of unsubmitted entries...`);
      const unsubmittedEntries = await getAllUnsubmittedUsage(trackingData, 5); // Process up to 5 backlog entries
      
      if (unsubmittedEntries.length > 0) {
        console.error(`[DEBUG] Processing ${unsubmittedEntries.length} backlog entries...`);
        
        for (const backlogEntry of unsubmittedEntries) {
          try {
            const backlogPayload = {
              twitter_handle: config.twitterUrl,
              timestamp: backlogEntry.timestamp,
              tokens: backlogEntry.tokens,
              model: backlogEntry.model,
              interaction_id: backlogEntry.interaction_id
            };
            
            if (config.twitterUserId) {
              backlogPayload.twitter_user_id = config.twitterUserId;
            }
            
            const result = await sendToAPI(`${config.endpoint || "https://api.claudecount.com"}/api/usage/hook`, backlogPayload);
            console.error(`[DEBUG] Backlog entry ${backlogEntry.interaction_id} submitted successfully`);
            
            // Save to tracking
            if (backlogEntry.interaction_id) {
              trackingData[backlogEntry.interaction_id] = backlogEntry.timestamp || new Date().toISOString();
            }
          } catch (error) {
            console.error(`[DEBUG] Failed to submit backlog entry: ${error.message}`);
            // Continue with next entry
          }
        }
        
        // Save updated tracking data
        await saveTracking(trackingData);
      }
    }
    
    console.error(`[DEBUG] ====== Hook execution completed successfully ======`);
    process.exit(0);
  } catch (error) {
    console.error(`[DEBUG] Hook error: ${error.message}`);
    console.error(`[DEBUG] Stack trace: ${error.stack}`);
    console.error(`[DEBUG] ====== Hook execution ended (error) ======`);
    process.exit(0); 
  }
}

main();