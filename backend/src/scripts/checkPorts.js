#!/usr/bin/env node

const net = require('net');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Helper to check if port is in use
const isPortInUse = (port) => {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    
    server.listen(port);
  });
};

// Helper to get process using port (cross-platform)
const getProcessUsingPort = (port) => {
  try {
    const platform = process.platform;
    
    if (platform === 'darwin' || platform === 'linux') {
      // Mac/Linux
      const result = execSync(`lsof -i :${port}`, { encoding: 'utf8' });
      return result;
    } else if (platform === 'win32') {
      // Windows
      const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      return result;
    }
    
    return null;
  } catch (error) {
    // Command failed (likely no process found)
    return null;
  }
};

// Parse URL to get port
const getPortFromUrl = (url) => {
  try {
    const urlObj = new URL(url);
    return parseInt(urlObj.port) || (urlObj.protocol === 'https:' ? 443 : 80);
  } catch {
    return null;
  }
};

// Read .env file
const readEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  
  content.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && !key.startsWith('#') && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  });
  
  return env;
};

// Extract PID from process info
const extractPid = (processInfo, platform) => {
  if (platform === 'darwin' || platform === 'linux') {
    // lsof output format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const lines = processInfo.split('\n');
    if (lines.length > 1) {
      const parts = lines[1].trim().split(/\s+/);
      return parts[1]; // PID is second column
    }
  } else if (platform === 'win32') {
    // netstat output format: TCP 0.0.0.0:5000 0.0.0.0:0 LISTENING 12345
    const match = processInfo.match(/LISTENING\s+(\d+)/);
    return match ? match[1] : null;
  }
  return null;
};

// Extract process name from process info
const extractProcessName = (processInfo, platform) => {
  if (platform === 'darwin' || platform === 'linux') {
    const lines = processInfo.split('\n');
    if (lines.length > 1) {
      const parts = lines[1].trim().split(/\s+/);
      return parts[0]; // COMMAND is first column
    }
  } else if (platform === 'win32') {
    // Windows doesn't show process name in netstat, need tasklist
    try {
      const pid = extractPid(processInfo, platform);
      if (pid) {
        const taskInfo = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
        const parts = taskInfo.split(',');
        return parts[0]?.replace(/"/g, '') || 'Unknown';
      }
    } catch {
      return 'Unknown';
    }
  }
  return 'Unknown';
};

async function checkPorts() {
  console.log('\n🔍 Port Availability Check\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const platform = process.platform;
  const backendEnvPath = path.join(__dirname, '../../.env');
  const frontendEnvPath = path.join(__dirname, '../../../frontend/.env');

  const backendEnv = readEnvFile(backendEnvPath);
  const frontendEnv = readEnvFile(frontendEnvPath);

  const checks = [];

  // Check backend port
  if (backendEnv?.PORT) {
    const backendPort = parseInt(backendEnv.PORT);
    checks.push({
      name: 'Backend',
      port: backendPort,
      source: 'backend/.env PORT'
    });
  } else {
    console.log('⚠️  Backend PORT not found in backend/.env\n');
  }

  // Check frontend ports
  if (frontendEnv?.VITE_API_URL) {
    const apiPort = getPortFromUrl(frontendEnv.VITE_API_URL);
    if (apiPort) {
      checks.push({
        name: 'Frontend API',
        port: apiPort,
        source: 'frontend/.env VITE_API_URL'
      });
    }
  }

  if (frontendEnv?.VITE_SOCKET_URL) {
    const socketPort = getPortFromUrl(frontendEnv.VITE_SOCKET_URL);
    if (socketPort && !checks.find(c => c.port === socketPort)) {
      checks.push({
        name: 'Frontend Socket',
        port: socketPort,
        source: 'frontend/.env VITE_SOCKET_URL'
      });
    }
  }

  // Also check default Vite port (7001)
  checks.push({
    name: 'Frontend Dev Server (Vite)',
    port: 7001,
    source: 'Vite default'
  });

  let allClear = true;

  for (const check of checks) {
    const inUse = await isPortInUse(check.port);
    
    if (inUse) {
      allClear = false;
      console.log(`❌ Port ${check.port} (${check.name}) is IN USE`);
      console.log(`   Source: ${check.source}`);
      
      const processInfo = getProcessUsingPort(check.port);
      if (processInfo) {
        const pid = extractPid(processInfo, platform);
        const processName = extractProcessName(processInfo, platform);
        
        console.log(`   Process: ${processName} (PID: ${pid})`);
        console.log(`   Details:\n${processInfo.split('\n').map(line => '     ' + line).join('\n')}`);
        
        if (pid) {
          console.log(`\n   📋 To kill this process:`);
          if (platform === 'darwin' || platform === 'linux') {
            console.log(`      kill -9 ${pid}`);
          } else if (platform === 'win32') {
            console.log(`      taskkill /PID ${pid} /F`);
          }
        }
      } else {
        console.log(`   Could not determine process using this port`);
      }
      console.log('');
    } else {
      console.log(`✅ Port ${check.port} (${check.name}) is FREE`);
      console.log(`   Source: ${check.source}\n`);
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (allClear) {
    console.log('🎉 All ports are available! You can start the servers.\n');
  } else {
    console.log('⚠️  Some ports are in use. Free them before starting the servers.\n');
  }
}

checkPorts().catch(error => {
  console.error('Error checking ports:', error.message);
  process.exit(1);
});
