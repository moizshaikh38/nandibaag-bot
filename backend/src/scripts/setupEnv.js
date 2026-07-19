#!/usr/bin/env node

const readline = require('readline');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to prompt user
const question = (prompt) => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

// Generate secure random password
const generatePassword = (length = 12) => {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  const randomValues = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += charset[randomValues[i] % charset.length];
  }
  return password;
};

// Generate JWT secret
const generateJWTSecret = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Check if file exists
const fileExists = (filePath) => {
  return fs.existsSync(filePath);
};

// Write .env file
const writeEnvFile = (filePath, content) => {
  fs.writeFileSync(filePath, content, 'utf8');
};

console.log('\n🔧 Nandibaag Bot Environment Setup\n');
console.log('This script will create backend/.env and frontend/.env files for you.\n');

async function setup() {
  try {
    // Prompt for MongoDB URI
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('MongoDB Connection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const mongoUri = await question(
      'Paste your MongoDB connection string (e.g., mongodb://localhost:27017/nandibaag-bot or MongoDB Atlas URL):\n> '
    );

    // Prompt for OpenRouter API Key
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('OpenRouter API Key');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Get your free API key from https://openrouter.ai/ (starts with sk-or-)');
    const openRouterKey = await question('Paste your OpenRouter API key:\n> ');

    // Prompt for Frontend URL (with default)
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Frontend URL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const frontendUrl = await question('Frontend URL (default: http://localhost:7001):\n> ') || 'http://localhost:7001';

    // Prompt for Backend URL (with default)
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Backend URL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const backendUrl = await question('Backend URL (default: http://localhost:7000):\n> ') || 'http://localhost:7000';

    // Generate auto values
    const jwtSecret = generateJWTSecret();
    const adminPassword = generatePassword(12);

    // Backend .env content
    const backendEnv = `# MongoDB Connection
MONGO_URI=${mongoUri}

# Server Configuration
PORT=7000
NODE_ENV=development

# JWT Configuration
JWT_SECRET=${jwtSecret}
JWT_EXPIRES_IN=1d

# OpenRouter AI Configuration
OPENROUTER_API_KEY=${openRouterKey}
OPENROUTER_MODEL_PRIMARY=meta-llama/llama-3.3-70b-instruct:free
OPENROUTER_MODEL_FALLBACK_1=openai/gpt-oss-20b:free
OPENROUTER_MODEL_FALLBACK_2=google/gemma-4-31b-it:free
# NOTE: Free model slugs change over time. Verify these at https://openrouter.ai/models

# Resort Contact Numbers
RESORT_CONTACT_1=9257657665
RESORT_CONTACT_2=9257657664
RESORT_CONTACT_3=9257657663

# Default Admin Credentials
ADMIN_DEFAULT_EMAIL=admin@nandibaag.com
ADMIN_DEFAULT_PASSWORD=${adminPassword}

# CORS Configuration
FRONTEND_URL=${frontendUrl}
`;

    // Frontend .env content
    const frontendEnv = `VITE_API_URL=${backendUrl}/api
VITE_SOCKET_URL=${backendUrl}
`;

    // Backend .env path
    const backendEnvPath = path.join(__dirname, '../../.env');
    
    // Check if backend .env exists
    if (fileExists(backendEnvPath)) {
      const overwrite = await question('\n⚠️  backend/.env already exists. Overwrite? (y/n): ');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('\n❌ Setup cancelled. backend/.env was not modified.');
        rl.close();
        return;
      }
    }

    // Write backend .env
    writeEnvFile(backendEnvPath, backendEnv);
    console.log('\n✅ backend/.env created successfully');

    // Frontend .env path
    const frontendEnvPath = path.join(__dirname, '../../../frontend/.env');
    
    // Check if frontend .env exists
    if (fileExists(frontendEnvPath)) {
      const overwrite = await question('⚠️  frontend/.env already exists. Overwrite? (y/n): ');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('❌ Setup cancelled. frontend/.env was not modified.');
        rl.close();
        return;
      }
    }

    // Write frontend .env
    writeEnvFile(frontendEnvPath, frontendEnv);
    console.log('✅ frontend/.env created successfully');

    // Print summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Setup Complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n✅ MongoDB URI saved');
    console.log('✅ OpenRouter API key saved');
    console.log('✅ Frontend URL configured');
    console.log('✅ Backend URL configured');
    console.log('✅ JWT secret generated');
    console.log('✅ Admin credentials generated');
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 ADMIN CREDENTIALS (SAVE THESE!)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\nEmail:    admin@nandibaag.com`);
    console.log(`Password: ${adminPassword}`);
    console.log('\n⚠️  WARNING: Change this password after your first login!');
    console.log('   It will not be shown again.\n');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Next Steps');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n1. Verify OpenRouter model slugs at https://openrouter.ai/models');
    console.log('   (Free model names change over time)');
    console.log('\n2. Start the backend server:');
    console.log('   cd backend && npm run dev');
    console.log('\n3. In another terminal, start the frontend:');
    console.log('   cd frontend && npm run dev');
    console.log('\n4. Login at http://localhost:7001/login with the credentials above\n');

    rl.close();
  } catch (error) {
    console.error('\n❌ Error during setup:', error.message);
    rl.close();
    process.exit(1);
  }
}

setup();
