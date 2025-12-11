const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const bookingService = require('../services/bookingService');

// List all shows (public)
router.get('/shows', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shows ORDER BY start_time ASC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch shows' });
  }
});

// Show availability summary
router.get('/shows/:id/availability', async (req, res) => {
  const showId = Number(req.params.id);
  if (!showId) return res.status(400).json({ error: 'Invalid show id' });
  try {
    const { rows: showRows } = await pool.query('SELECT * FROM shows WHERE id=$1', [showId]);
    if (showRows.length === 0) return res.status(404).json({ error: 'Show not found' });

    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE s.is_booked = false AND (s.hold_expires_at IS NULL OR s.hold_expires_at < NOW())) AS available,
         COUNT(*) FILTER (WHERE s.is_booked = true) AS booked,
         COUNT(*) FILTER (WHERE s.is_booked = false AND s.hold_expires_at IS NOT NULL AND s.hold_expires_at > NOW()) AS held
       FROM seats s WHERE s.show_id = $1`,
      [showId]
    );
    res.json({
      show: showRows[0],
      availability: {
        available: Number(rows[0].available),
        booked: Number(rows[0].booked),
        held: Number(rows[0].held),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

// Create booking (PENDING with seat holds)
router.post('/bookings', async (req, res) => {
  const { show_id, quantity } = req.body;
  if (!show_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'show_id and positive quantity are required' });
  }
  try {
    const booking = await bookingService.createPendingBooking(show_id, quantity);
    res.status(201).json(booking);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || 'Failed to create booking' });
  }
});

// Confirm booking
router.post('/bookings/:id/confirm', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid booking id' });
  try {
    const booking = await bookingService.confirmBooking(id);
    res.json(booking);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message || 'Failed to confirm booking' });
  }
});

// Get booking
router.get('/bookings/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid booking id' });
  try {
    const booking = await bookingService.getBooking(id);
    if (!booking) return res.status(404).json({ error: 'Not found' });
    res.json(booking);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

module.exports = router;
