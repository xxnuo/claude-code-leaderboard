import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { API_BASE_URL } from './constants.js';

export const CLAUDE_DIR = join(homedir(), '.claude');
const CONFIG_FILE = join(CLAUDE_DIR, 'leaderboard.json');
const HOOK_SCRIPT_PATH = join(CLAUDE_DIR, 'count_tokens.js');
const SETTINGS_JSON_PATH = join(CLAUDE_DIR, 'settings.json');
const ENCRYPTION_KEY_PATH = join(CLAUDE_DIR, '.encryption_key');
const SUBMITTED_FILE = join(CLAUDE_DIR, 'leaderboard_submitted.json');

export async function ensureConfigDir() {
  if (!existsSync(CLAUDE_DIR)) {
    await mkdir(CLAUDE_DIR, { recursive: true });
  }
}

export async function loadConfig() {
  try {
    const content = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // maybe we should throw an error here instead??
    return {
      twitterUrl: "@your_handle",
      endpoint: API_BASE_URL
    };
  }
}

export async function saveConfig(config) {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function checkAuthStatus() {
  try {
    const config = await loadConfig();
    
    // Check for OAuth 1.0a authentication
    const isAuthenticated = 
      config.twitterUserId && 
      config.oauth_token && 
      config.oauth_token_secret &&
      config.twitterUrl !== "@your_handle";
    
    return {
      isAuthenticated,
      twitterHandle: config.twitterUrl || "@your_handle",
      twitterUserId: config.twitterUserId,
      lastAuthenticated: config.lastAuthenticated,
      oauthVersion: '1.0a'
    };
  } catch (error) {
    return {
      isAuthenticated: false,
      twitterHandle: "@your_handle",
      twitterUserId: null,
      lastAuthenticated: null,
      oauthVersion: null
    };
  }
}

export async function clearAuthData() {
  const config = await loadConfig();
  
  // Remove OAuth 1.0a fields
  delete config.oauth_token;
  delete config.oauth_token_secret;
  
  // Remove common fields
  delete config.twitterUserId;
  delete config.lastAuthenticated;
  delete config.oauthVersion;
  
  // Reset to placeholder
  config.twitterUrl = "@your_handle";
  
  await saveConfig(config);
}


export async function removeHookFromJson() {
  if (!existsSync(SETTINGS_JSON_PATH)) {
    return false;
  }
  
  try {
    const content = await readFile(SETTINGS_JSON_PATH, 'utf-8');
    const settings = JSON.parse(content);
    
    if (!settings.hooks?.Stop || !Array.isArray(settings.hooks.Stop)) {
      return false;
    }
    
    // Remove our hook entry
    const initialLength = settings.hooks.Stop.length;
    settings.hooks.Stop = settings.hooks.Stop.filter(stopHook => 
      !stopHook.hooks?.some(hook => 
        hook.type === 'command' && hook.command === HOOK_SCRIPT_PATH
      )
    );
    
    if (settings.hooks.Stop.length < initialLength) {
      // Clean up empty structures
      if (settings.hooks.Stop.length === 0) {
        delete settings.hooks.Stop;
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
      }
      
      // Write back the updated settings
      await writeFile(SETTINGS_JSON_PATH, JSON.stringify(settings, null, 2), 'utf-8');
      return true;
    }
  } catch (error) {
    console.error('Error removing hook from JSON:', error);
  }
  
  return false;
}

export async function removeAllClaudeCountFiles() {
  const results = {
    leaderboardConfig: false,
    hookScript: false,
    settingsJson: false,
    encryptionKey: false,
    submittedFile: false
  };
  
  // Remove leaderboard.json
  if (existsSync(CONFIG_FILE)) {
    try {
      await unlink(CONFIG_FILE);
      results.leaderboardConfig = true;
    } catch (error) {
      console.error('Error removing leaderboard.json:', error);
    }
  }
  
  // Remove count_tokens.js
  if (existsSync(HOOK_SCRIPT_PATH)) {
    try {
      await unlink(HOOK_SCRIPT_PATH);
      results.hookScript = true;
    } catch (error) {
      console.error('Error removing count_tokens.js:', error);
    }
  }
  
  // Remove hook from settings.json
  results.settingsJson = await removeHookFromJson();
  
  // Remove encryption key
  if (existsSync(ENCRYPTION_KEY_PATH)) {
    try {
      await unlink(ENCRYPTION_KEY_PATH);
      results.encryptionKey = true;
    } catch (error) {
      console.error('Error removing .encryption_key:', error);
    }
  }
  
  // Remove leaderboard_submitted.json
  if (existsSync(SUBMITTED_FILE)) {
    try {
      await unlink(SUBMITTED_FILE);
      results.submittedFile = true;
    } catch (error) {
      console.error('Error removing leaderboard_submitted.json:', error);
    }
  }
  
  return results;
}