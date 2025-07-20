#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { homedir } from 'node:os';
import { glob } from 'tinyglobby';


const USER_HOME_DIR = homedir();
const XDG_CONFIG_DIR = process.env.XDG_CONFIG_HOME ?? `${USER_HOME_DIR}/.config`;
const DEFAULT_CLAUDE_CODE_PATH = '.claude';
const DEFAULT_CLAUDE_CONFIG_PATH = `${XDG_CONFIG_DIR}/claude`;
const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';
const CLAUDE_PROJECTS_DIR_NAME = 'projects';
const USAGE_DATA_GLOB_PATTERN = '**/*.jsonl';


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
      const files = await glob([USAGE_DATA_GLOB_PATTERN], {
        cwd: claudeDir,
        absolute: true
      });
      console.error(`[DEBUG] Found ${files.length} files in ${claudeDir}`);
      if (files.length > 0) {
        console.error(`[DEBUG] Sample files: ${files.slice(0, 3).join(', ')}`);
      }
      allFiles.push(...files);
    } catch (error) {
      console.error(`[DEBUG] Error globbing in ${claudeDir}: ${error.message}`);
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
  
  
  for (const file of sortedFiles.slice(0, 5)) { 
    try {
      const content = await readFile(file, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      
      
      console.error(`File ${path.basename(file)} has ${lines.length} lines`);
      
      // Debug: Sample first few lines
      if (lines.length > 0) {
        console.error(`Sample line from file:`, lines[0].substring(0, 200));
      }
      
      for (const line of lines.reverse()) {
        // Try to parse the line for debugging
        try {
          const data = JSON.parse(line.trim());
          
          // Debug: Log what we found
          if (data.message && data.message.usage) {
            console.error(`Found usage data:`, JSON.stringify(data.message.usage));
          }
        } catch (e) {
          // Skip invalid JSON
        }
        
        const usageData = parseUsageFromLine(line);
        if (!usageData) continue;
        
        
        const uniqueHash = usageData.interaction_id;
        if (uniqueHash && processedHashes.has(uniqueHash)) {
          continue;
        }
        
        if (uniqueHash) {
          processedHashes.add(uniqueHash);
        }
        
        
        return usageData;
      }
    } catch (error) {
      console.error(`[DEBUG] Error reading/parsing file ${file}: ${error.message}`);
      continue;
    }
  }
  
  console.error(`[DEBUG] No valid usage data found after checking ${sortedFiles.length} files`);
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
      endpoint: "http://localhost:8000"
    };
  }
}


async function sendToAPI(endpoint, payload) {
  try {
    console.error(`[DEBUG] Sending payload to API: ${JSON.stringify(payload)}`);
    console.error(`[DEBUG] API endpoint: ${endpoint}`);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    console.error(`[DEBUG] API response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DEBUG] API error response: ${errorText}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.error(`[DEBUG] API success response: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    console.error(`[DEBUG] Failed to send to API: ${error.message}`);
    console.error(`[DEBUG] Error type: ${error.constructor.name}`);
    throw error;
  }
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
      await import('fs/promises').then(fs => fs.writeFile(logFile, content + logEntry));
    });
    

    // Read hook data from stdin (Claude passes data via stdin)
    
    let hookData = {};
    try {
      const stdin = process.stdin;
      stdin.setEncoding('utf-8');
      let data = '';
      for await (const chunk of stdin) {
        data += chunk;
      }
      if (data.trim()) {
        hookData = JSON.parse(data);
        console.error(`[DEBUG] Received hook data from stdin`);
      } else {
        console.error(`[DEBUG] No hook data received from stdin`);
      }
    } catch (error) {
      console.error(`[DEBUG] Error reading stdin: ${error.message}`);
    }
    
    
    console.error(`[DEBUG] Starting token usage search...`);
    const usageData = await getLatestTokenUsage();
    
    if (!usageData) {
      console.error('[DEBUG] No token usage data found - exiting gracefully');
      console.error(`[DEBUG] ====== Hook execution ended (no data) ======`);
      process.exit(0);
    }
    
    console.error(`[DEBUG] Found usage data: ${JSON.stringify(usageData)}`)
    
    
    const tokens = usageData.tokens;
    const totalTokens = tokens.input + tokens.output + tokens.cache_creation + tokens.cache_read;
    
    
    const config = await loadConfig();
    
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
    } catch (apiError) {
      console.error(`Failed to send to API: ${apiError.message}`);
      // Log API failure but don't fail the hook
      console.error(`[${new Date().toISOString()}] API submission failed: ${apiError.message}`);
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