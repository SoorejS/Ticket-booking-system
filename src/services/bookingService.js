const { pool, withTransaction } = require('../db');

const HOLD_WINDOW_SECONDS = parseInt(process.env.HOLD_WINDOW_SECONDS || '120', 10); // 2 minutes default

async function createPendingBooking(showId, quantity) {
  return withTransaction(async (client) => {
    const { rows: showRows } = await client.query('SELECT * FROM shows WHERE id=$1', [showId]);
    if (showRows.length === 0) throw new Error('Show not found');

    const bookingRes = await client.query(
      'INSERT INTO bookings (show_id, status, quantity) VALUES ($1,$2,$3) RETURNING *',
      [showId, 'PENDING', quantity]
    );
    const booking = bookingRes.rows[0];

    // Lock available seats, skip locked to handle concurrency
    const seatsRes = await client.query(
      `SELECT id FROM seats
       WHERE show_id = $1
         AND is_booked = false
         AND (hold_expires_at IS NULL OR hold_expires_at < NOW())
       ORDER BY seat_number ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [showId, quantity]
    );

    if (seatsRes.rows.length < quantity) {
      // Not enough seats available, mark booking failed
      await client.query('UPDATE bookings SET status=$1 WHERE id=$2', ['FAILED', booking.id]);
      throw new Error('Insufficient available seats');
    }

    const expiresAt = new Date(Date.now() + HOLD_WINDOW_SECONDS * 1000);

    // Hold seats and map to booking
    for (const row of seatsRes.rows) {
      await client.query(
        'UPDATE seats SET hold_booking_id=$1, hold_expires_at=$2 WHERE id=$3',
        [booking.id, expiresAt, row.id]
      );
      await client.query(
        'INSERT INTO booking_seats (booking_id, seat_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [booking.id, row.id]
      );
    }

    const { rows: full } = await client.query(
      `SELECT b.*, json_agg(s.seat_number ORDER BY s.seat_number) AS seats
       FROM bookings b
       LEFT JOIN booking_seats bs ON bs.booking_id = b.id
       LEFT JOIN seats s ON s.id = bs.seat_id
       WHERE b.id=$1
       GROUP BY b.id`,
      [booking.id]
    );
    return full[0];
  });
}

async function confirmBooking(bookingId) {
  return withTransaction(async (client) => {
    // Lock booking row first
    const { rows: bRows } = await client.query(
      'SELECT * FROM bookings WHERE id=$1 FOR UPDATE',
      [bookingId]
    );
    if (bRows.length === 0) throw new Error('Booking not found');
    const booking = bRows[0];

    if (booking.status === 'FAILED') throw new Error('Booking already failed');
    if (booking.status === 'CONFIRMED') return await getBooking(bookingId);

    // Fetch seats for this booking and lock them
    const { rows: seatRows } = await client.query(
      `SELECT s.* FROM seats s
       JOIN booking_seats bs ON bs.seat_id = s.id
       WHERE bs.booking_id = $1
       FOR UPDATE`,
      [bookingId]
    );

    if (seatRows.length !== booking.quantity) {
      // Not all seats are held
      await client.query('UPDATE bookings SET status=$1 WHERE id=$2', ['FAILED', bookingId]);
      throw new Error('Seat hold mismatch');
    }

    // Ensure holds are still valid
    const now = new Date();
    for (const s of seatRows) {
      if (s.is_booked) {
        await client.query('UPDATE bookings SET status=$1 WHERE id=$2', ['FAILED', bookingId]);
        throw new Error('Seat already booked');
      }
      if (!s.hold_booking_id || s.hold_booking_id !== bookingId) {
        await client.query('UPDATE bookings SET status=$1 WHERE id=$2', ['FAILED', bookingId]);
        throw new Error('Seat not held by this booking');
      }
      if (s.hold_expires_at && new Date(s.hold_expires_at) < now) {
        await client.query('UPDATE bookings SET status=$1 WHERE id=$2', ['FAILED', bookingId]);
        throw new Error('Hold expired');
      }
    }

    // Confirm seats
    for (const s of seatRows) {
      await client.query(
        'UPDATE seats SET is_booked=true, hold_booking_id=NULL, hold_expires_at=NULL WHERE id=$1',
        [s.id]
      );
    }

    await client.query('UPDATE bookings SET status=$1 WHERE id=$2', ['CONFIRMED', bookingId]);

    const { rows: full } = await client.query(
      `SELECT b.*, json_agg(s.seat_number ORDER BY s.seat_number) AS seats
       FROM bookings b
       LEFT JOIN booking_seats bs ON bs.booking_id = b.id
       LEFT JOIN seats s ON s.id = bs.seat_id
       WHERE b.id=$1
       GROUP BY b.id`,
      [bookingId]
    );
    return full[0];
  });
}

async function getBooking(bookingId) {
  const { rows } = await pool.query(
    `SELECT b.*, json_agg(s.seat_number ORDER BY s.seat_number) AS seats
     FROM bookings b
     LEFT JOIN booking_seats bs ON bs.booking_id = b.id
     LEFT JOIN seats s ON s.id = bs.seat_id
     WHERE b.id=$1
     GROUP BY b.id`,
    [bookingId]
  );
  return rows[0];
}

async function expirePendingBookings(clientExternal) {
  const run = async (client) => {
    // Find expired pending bookings
    const { rows: expired } = await client.query(
      `SELECT id FROM bookings
       WHERE status='PENDING' AND created_at < NOW() - INTERVAL '${HOLD_WINDOW_SECONDS} seconds'
       FOR UPDATE SKIP LOCKED`
    );

    for (const b of expired) {
      // Release holds
      await client.query(
        'UPDATE seats SET hold_booking_id=NULL, hold_expires_at=NULL WHERE hold_booking_id=$1',
        [b.id]
      );
      // Mark failed
      await client.query('UPDATE bookings SET status=$1 WHERE id=$2', ['FAILED', b.id]);
    }
    return expired.length;
  };

  if (clientExternal) {
    return run(clientExternal);
  } else {
    return withTransaction(run);
  }
}

module.exports = {
  createPendingBooking,
  confirmBooking,
  getBooking,
  expirePendingBookings,
};
