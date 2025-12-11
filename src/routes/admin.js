const express = require('express');
const router = express.Router();
const { pool, withTransaction } = require('../db');

// Create a show and generate seats 1..total_seats
router.post('/shows', async (req, res) => {
  const { name, start_time, total_seats } = req.body;
  if (!name || !start_time || !total_seats || total_seats <= 0) {
    return res.status(400).json({ error: 'name, start_time, total_seats are required' });
  }
  try {
    const result = await withTransaction(async (client) => {
      const showRes = await client.query(
        'INSERT INTO shows (name, start_time, total_seats) VALUES ($1,$2,$3) RETURNING *',
        [name, new Date(start_time), total_seats]
      );
      const show = showRes.rows[1 - 1];
      const seatValues = [];
      for (let i = 1; i <= total_seats; i++) {
        seatValues.push(`(${show.id}, ${i})`);
      }
      if (seatValues.length) {
        await client.query(
          `INSERT INTO seats (show_id, seat_number) VALUES ${seatValues.join(',')}`
        );
      }
      return show;
    });
    res.status(201).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create show' });
  }
});

// List all shows
router.get('/shows', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM shows ORDER BY start_time ASC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch shows' });
  }
});

module.exports = router;
