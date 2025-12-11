# Ticket Booking System (Node.js, Express, Postgres)

Concurrency-safe ticket booking API simulating platforms like RedBus / BookMyShow / Appointments.

- Handles high concurrency seat booking with row-level locks and SKIP LOCKED
- Pending booking holds with auto-expiry (default 2 minutes)
- Swagger API docs included

## Requirements
- Node.js 18+
- Postgres 13+

## Setup
1. Copy env and set values
   ```bash
   cp .env.example .env
   ```
2. Create database (example)
   ```sql
   CREATE DATABASE ticketdb;
   ```
3. Install deps
   ```bash
   npm install
   ```
4. Run migrations
   ```bash
   npm run migrate
   ```
5. Start server
   ```bash
   npm run start
   # or during development
   npm run dev
   ```

Server: http://localhost:3000
Docs: http://localhost:3000/docs

## Environment variables
- `PORT` (default 3000)
- Use either `DATABASE_URL` or the PG* variables:
  - `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
  - `PGSSL=false`
  - `PGPOOL_MAX=20`
- `HOLD_WINDOW_SECONDS` (default 120)
- `EXPIRY_JOB_INTERVAL_SECONDS` (default 15)

## API Quickstart
- Health: GET `/health`

- Admin
  - Create show: POST `/admin/shows`
    - body: `{ "name": "Bus A", "start_time": "2025-12-11T10:00:00Z", "total_seats": 40 }`
  - List shows: GET `/admin/shows`

- Public
  - List shows: GET `/shows`
  - Availability: GET `/shows/{id}/availability`
  - Create booking (hold seats): POST `/bookings`
    - body: `{ "show_id": 1, "quantity": 2 }`
  - Get booking: GET `/bookings/{id}`
  - Confirm booking: POST `/bookings/{id}/confirm`

See Swagger at `/docs` for schemas and responses.

## Concurrency & Overbooking Prevention
- Pending booking creates a hold on seats using transaction + `SELECT ... FOR UPDATE SKIP LOCKED` to avoid race conditions.
- If insufficient seats at lock time, booking is marked `FAILED`.
- Confirmation re-validates holds and atomically marks seats as `booked`.
- Background job marks bookings as `FAILED` after hold window and releases seat holds.

## Project Structure
```
src/
  db.js
  server.js
  routes/
    admin.js
    public.js
  services/
    bookingService.js
    expiryJob.js
  swagger.yaml
scripts/
  migrate.js
```

## Notes
- This is a single-instance app demo. In production, run multiple stateless app instances behind a load balancer with a managed Postgres cluster.
- See `docs/design.md` for scaling and architecture.
