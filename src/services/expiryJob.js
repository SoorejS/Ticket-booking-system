const { withTransaction } = require('../db');
const { expirePendingBookings } = require('./bookingService');

function startExpiryJob() {
  const intervalMs = (parseInt(process.env.EXPIRY_JOB_INTERVAL_SECONDS || '15', 10)) * 1000;
  setInterval(async () => {
    try {
      await withTransaction(async (client) => {
        const expired = await expirePendingBookings(client);
        if (expired > 0) {
          console.log(`[expiryJob] Marked ${expired} pending bookings as FAILED`);
        }
      });
    } catch (e) {
      console.error('[expiryJob] Error:', e.message);
    }
  }, intervalMs);
}

module.exports = startExpiryJob;
