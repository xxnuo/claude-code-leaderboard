#!/usr/bin/env node

// Set dev environment
process.env.API_BASE_URL = 'http://localhost:8000';

// Run the CLI
import('./cli.js');