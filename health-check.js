// Health monitoring for Render deployment
const os = require('os');

function getHealthStats() {
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB (total allocated)
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      system: {
        total: Math.round(totalMem / 1024 / 1024), // MB
        used: Math.round(usedMem / 1024 / 1024), // MB
        free: Math.round(freeMem / 1024 / 1024), // MB
      }
    },
    uptime: Math.round(process.uptime()), // seconds
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
  };
}

function checkMemoryHealth() {
  const stats = getHealthStats();
  const memoryUsagePercent = (stats.memory.rss / 512); // 512 MB Render limit

  // Warn if using more than 70% of available memory
  if (memoryUsagePercent > 0.7) {
    console.warn(`⚠️  High memory usage: ${stats.memory.rss} MB / 512 MB (${Math.round(memoryUsagePercent * 100)}%)`);
    return false;
  }

  return true;
}

// Log memory stats periodically (every 5 minutes)
function startHealthMonitoring() {
  setInterval(() => {
    const stats = getHealthStats();
    console.log(`📊 Health: RSS=${stats.memory.rss}MB, Heap=${stats.memory.heapUsed}MB, Uptime=${stats.uptime}s`);
    checkMemoryHealth();
  }, 5 * 60 * 1000); // 5 minutes
}

module.exports = {
  getHealthStats,
  checkMemoryHealth,
  startHealthMonitoring
};
