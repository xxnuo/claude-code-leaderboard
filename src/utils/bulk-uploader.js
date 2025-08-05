import { createGzip } from 'zlib';
import { Readable } from 'stream';
import http from 'http';
import https from 'https';
import { getValidAccessToken } from '../auth/tokens.js';
import { loadConfig } from './config.js';

const AGENTS = {
  http: new http.Agent({ 
    keepAlive: true, 
    maxSockets: 25,  // Increased to support 5 parallel batches
    maxFreeSockets: 10,
    timeout: 60000,
    scheduling: 'fifo'
  }),
  https: new https.Agent({ 
    keepAlive: true, 
    maxSockets: 25,  // Increased to support 5 parallel batches
    maxFreeSockets: 10,
    timeout: 60000
  })
};

async function uploadBatch({ batch, url, lib, agent, authTokens, batchNumber, totalBatches, retryCount = 0 }) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000; // Start with 1 second
  
  try {
    // Upload batch
    
    const body = JSON.stringify({ entries: batch });
    const gzip = createGzip({ level: 6 });
    
    const result = await new Promise((resolve, reject) => {
      const req = lib.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'X-OAuth-Token': authTokens.oauth_token,
          'X-OAuth-Token-Secret': authTokens.oauth_token_secret
        },
        agent,
        timeout: 120000  // 2 minutes per batch
      });
      
      req.on('response', (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const result = JSON.parse(body);
              resolve({ 
                processed: result.processed || batch.length, 
                failed: result.failed || 0,
                batchNumber
              });
            } catch (e) {
              resolve({ processed: batch.length, failed: 0, batchNumber });
            }
          } else {
            reject(new Error(`Upload failed: ${res.statusCode} ${body}`));
          }
        });
      });
      
      req.on('error', reject);
      
      // Stream the compressed data
      const readable = Readable.from(body);
      readable.pipe(gzip).pipe(req);
    });
    
    return result;
    
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY * Math.pow(2, retryCount); // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
      return uploadBatch({ batch, url, lib, agent, authTokens, batchNumber, totalBatches, retryCount: retryCount + 1 });
    }
    
    // Failed after all retries
    return { processed: 0, failed: batch.length, batchNumber, error: error.message };
  }
}

export async function uploadShardedNdjson({ lines, tokens = null }) {
  const config = await loadConfig();
  const base = process.env.API_BASE_URL || config.endpoint || 'https://api.claudecount.com';
  const url = new URL('/api/usage/bulk-import-optimized', base);
  const lib = url.protocol === 'https:' ? https : http;
  const agent = url.protocol === 'https:' ? AGENTS.https : AGENTS.http;
  
  // Use provided tokens or get from storage
  const authTokens = tokens || await getValidAccessToken();
  
  if (!authTokens) {
    throw new Error('No authentication tokens available');
  }
  
  // Convert lines to entries format
  const entries = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch (e) {
      console.error('Failed to parse line:', e);
      return null;
    }
  }).filter(Boolean);
  
  // Group entries by date to avoid conflicts
  const entriesByDate = {};
  for (const entry of entries) {
    if (!entry.timestamp) continue;
    // Extract date from timestamp (YYYY-MM-DD)
    const date = entry.timestamp.substring(0, 10);
    if (!entriesByDate[date]) {
      entriesByDate[date] = [];
    }
    entriesByDate[date].push(entry);
  }
  
  // Group entries across dates
  
  // Create date-based batches (each batch contains complete days)
  const BATCH_SIZE = 5000; // Max entries per batch
  const MAX_CONCURRENT = 3; // Reduced concurrency to avoid database overload
  const batches = [];
  let currentBatch = [];
  let batchNumber = 1;
  
  // Sort dates to process in chronological order
  const sortedDates = Object.keys(entriesByDate).sort();
  
  for (const date of sortedDates) {
    const dateEntries = entriesByDate[date];
    
    // If adding this date would exceed batch size, create a new batch
    if (currentBatch.length > 0 && currentBatch.length + dateEntries.length > BATCH_SIZE) {
      batches.push({
        batch: currentBatch,
        batchNumber: batchNumber++,
        dates: [...new Set(currentBatch.map(e => e.timestamp.substring(0, 10)))]
      });
      currentBatch = [];
    }
    
    // Add all entries for this date to current batch
    currentBatch.push(...dateEntries);
    
    // If batch is getting large, close it
    if (currentBatch.length >= BATCH_SIZE) {
      batches.push({
        batch: currentBatch,
        batchNumber: batchNumber++,
        dates: [...new Set(currentBatch.map(e => e.timestamp.substring(0, 10)))]
      });
      currentBatch = [];
    }
  }
  
  // Add remaining entries as final batch
  if (currentBatch.length > 0) {
    batches.push({
      batch: currentBatch,
      batchNumber: batchNumber++,
      dates: [...new Set(currentBatch.map(e => e.timestamp.substring(0, 10)))]
    });
  }
  
  const totalBatches = batches.length;
  
  // Process batches with controlled concurrency
  const results = [];
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const concurrentBatches = batches.slice(i, i + MAX_CONCURRENT);
    
    // Process batches silently
    
    // Upload multiple batches in parallel
    const batchPromises = concurrentBatches.map(({ batch, batchNumber }) =>
      uploadBatch({ batch, url, lib, agent, authTokens, batchNumber, totalBatches })
    );
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    // Process results
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        // This shouldn't happen since uploadBatch handles its own errors
        // Unexpected batch failure
        results.push({ processed: 0, failed: BATCH_SIZE, error: result.reason });
      }
    }
    
    // Continue processing
  }
  
  // Calculate totals
  let totalProcessed = 0;
  let totalFailed = 0;
  
  for (const result of results) {
    totalProcessed += result.processed || 0;
    totalFailed += result.failed || 0;
  }
  
  // Upload complete
  
  return { processed: totalProcessed, failed: totalFailed };
}