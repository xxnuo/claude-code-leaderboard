import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { homedir } from 'node:os';
import { glob } from 'tinyglobby';
import ora from 'ora';
import chalk from 'chalk';

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
  
  const envPaths = process.env[CLAUDE_CONFIG_DIR_ENV];
  if (envPaths) {
    paths.push(...envPaths.split(','));
  } else {
    paths.push(DEFAULT_CLAUDE_CONFIG_PATH, `${USER_HOME_DIR}/${DEFAULT_CLAUDE_CODE_PATH}`);
  }
  
  const validPaths = paths.filter(p => {
    try {
      const projectsPath = path.join(p, CLAUDE_PROJECTS_DIR_NAME);
      return existsSync(projectsPath);
    } catch {
      return false;
    }
  });
  
  return validPaths;
}

function createUniqueHash(data) {
  const requestId = data.requestId;
  const messageId = data.message?.id;
  
  // Match ccusage behavior: require BOTH messageId AND requestId
  if (requestId && messageId) {
    return `${messageId}:${requestId}`;
  }
  
  // Return null if either is missing - these entries won't be deduplicated
  return null;
}

function parseUsageFromLine(line) {
  try {
    const data = JSON.parse(line.trim());
    
    // Validate the data structure matches ccusage schema
    if (!validateUsageData(data)) {
      return null;
    }
    
    const usage = data.message.usage;
    const interactionId = createUniqueHash(data);
    
    return {
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
  } catch {
    return null;
  }
}

async function scanJsonlFile(filePath, seenInteractions) {
  const usageEntries = [];
  
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);
    
    for (const line of lines) {
      const usageData = parseUsageFromLine(line);
      if (!usageData) continue;
      
      // Match ccusage: only deduplicate if we have a valid hash (both IDs present)
      const uniqueHash = usageData.interaction_id;
      if (uniqueHash) {
        // We have both messageId and requestId - check for duplicates
        if (seenInteractions.has(uniqueHash)) {
          continue; // Skip duplicate
        }
        seenInteractions.add(uniqueHash);
      }
      // If no hash (missing messageId or requestId), always include the entry
      
      usageEntries.push(usageData);
    }
  } catch (error) {
    // Silently skip files that can't be read
  }
  
  return usageEntries;
}

export async function scanAllHistoricalUsage(showProgress = true) {
  const spinner = showProgress ? ora('Scanning for historical Claude usage...').start() : null;
  
  try {
    // Get Claude paths
    const claudePaths = getClaudePaths();
    if (claudePaths.length === 0) {
      if (spinner) spinner.warn('No Claude configuration found');
      return { entries: [], totals: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 } };
    }
    
    if (spinner) spinner.text = 'Finding usage files...';
    
    // Find all JSONL files
    const allFiles = [];
    for (const claudePath of claudePaths) {
      const claudeDir = path.join(claudePath, CLAUDE_PROJECTS_DIR_NAME);
      try {
        const files = await glob([USAGE_DATA_GLOB_PATTERN], {
          cwd: claudeDir,
          absolute: true
        });
        allFiles.push(...files);
      } catch {
        // Skip paths that can't be accessed
      }
    }
    
    if (allFiles.length === 0) {
      if (spinner) spinner.info('No usage history found');
      return { entries: [], totals: { input: 0, output: 0, cache_creation: 0, cache_read: 0, total: 0 } };
    }
    
    if (spinner) spinner.text = `Processing ${allFiles.length} usage files...`;
    
    // Process all files
    const allUsageEntries = [];
    const seenInteractions = new Set();
    let processedFiles = 0;
    
    for (const file of allFiles) {
      const entries = await scanJsonlFile(file, seenInteractions);
      allUsageEntries.push(...entries);
      
      processedFiles++;
      if (spinner && processedFiles % 10 === 0) {
        spinner.text = `Processing usage files... (${processedFiles}/${allFiles.length})`;
      }
    }
    
    // Calculate totals
    const totals = {
      input: 0,
      output: 0,
      cache_creation: 0,
      cache_read: 0,
      total: 0
    };
    
    for (const entry of allUsageEntries) {
      totals.input += entry.tokens.input;
      totals.output += entry.tokens.output;
      totals.cache_creation += entry.tokens.cache_creation;
      totals.cache_read += entry.tokens.cache_read;
    }
    
    totals.total = totals.input + totals.output + totals.cache_creation + totals.cache_read;
    
    if (spinner) {
      spinner.succeed(`Found ${chalk.cyan(allUsageEntries.length.toLocaleString())} usage entries with ${chalk.cyan(totals.total.toLocaleString())} total tokens`);
    }
    
    return { entries: allUsageEntries, totals };
    
  } catch (error) {
    if (spinner) spinner.fail(`Error scanning usage: ${error.message}`);
    throw error;
  }
}

// Export individual functions for testing or reuse
export { getClaudePaths, parseUsageFromLine, validateUsageData };