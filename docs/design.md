# Technical Design: Ticket Booking System

## High-Level Architecture
- **API Layer (Express.js)**: Stateless application servers behind a load balancer.
- **Database (PostgreSQL)**: Single source of truth for shows, seats, bookings.
- **Background Worker**: Periodic job to expire PENDING bookings and release seat holds.
- **(Optional) Message Broker**: For decoupling slow operations (notifications, analytics).
- **(Optional) Cache (Redis)**: Read-through caching for read-heavy endpoints.

```
[Client]
   |
[Load Balancer]
   |
[Express API]  <---->  [Postgres]
     |   \----> [Redis Cache] (optional)
     \--------> [Message Queue] (optional)
                 \----> [Worker(s)]
```

## Data Model
- `shows(id, name, start_time, total_seats, created_at)`
- `seats(id, show_id, seat_number, is_booked, hold_booking_id, hold_expires_at)`
- `bookings(id, show_id, status[PENDING|CONFIRMED|FAILED], quantity, created_at, updated_at)`
- `booking_seats(id, booking_id, seat_id)`

Rationale:
- Seats are pre-generated per show for deterministic seat selection and locking.
- Holds tracked on `seats` allow SKIP LOCKED and simple expiry release.

## Concurrency Control
- All booking mutations happen inside DB transactions.
- Acquire seats with `SELECT ... FOR UPDATE SKIP LOCKED` on available seats:
  - Conditions: `is_booked=false` and `(hold_expires_at IS NULL OR hold_expires_at < NOW())`.
  - Prevents double selection under high concurrency.
- Create booking as `PENDING`; mark held seats with `hold_booking_id` and `hold_expires_at`.
- Confirm booking transaction locks booking row and related seats and verifies:
  - Seats are not booked, held by this booking, not expired.
  - Then atomically sets `is_booked=true` and clears holds; set booking to `CONFIRMED`.
- If insufficient seats or validation fails, set `FAILED`.

## Booking Expiry
- Background job runs every 15s (configurable).
- Finds `PENDING` bookings older than `HOLD_WINDOW_SECONDS` and:
  - Clears seat holds (`hold_booking_id`, `hold_expires_at`),
  - Marks booking as `FAILED`.
- Idempotent and safe across multiple workers due to `FOR UPDATE SKIP LOCKED`.

## Scaling Considerations
- **API**: Horizontal scaling. Stateless; share nothing. Sticky sessions not required.
- **Database**:
  - Start with a single primary and read replicas.
  - Route writes to primary; reads (list shows/availability) may use replicas with read-your-writes considerations.
  - Partition seats by `show_id` if very large. Consider sharding by `show_id` hash when dataset grows.
  - Use connection pooling (pg Pool, pgbouncer).
- **Caching**:
  - Cache read-heavy endpoints: show listing and availability snapshots.
  - Invalidate on show creation or seat state changes; or cache with short TTL (e.g., 5–15s) to reduce load.
- **Message Queue** (optional):
  - Publish events: `booking.created`, `booking.confirmed`, `booking.failed`.
  - Consumers handle emails, SMS, analytics, ledger updates.
- **Idempotency**:
  - Add `Idempotency-Key` headers for client-initiated POSTs to prevent duplicate bookings under retries.
  - Store request key with booking reference.
- **Observability**:
  - Structured logs, metrics (booking attempts, success/fail, lock wait time), and traces.
- **Security**:
  - Add authentication/authorization for admin endpoints.
  - Input validation, rate limiting, OWASP best practices.

## Availability Computation
- Current endpoint computes counts via SQL filters.
- For scale, maintain a materialized view or cached counters updated via triggers or background task.

## Failure Modes
- App crash: Holds persist until expiry job releases.
- DB failover: Transactions rollback; clients retry.
- Thundering herd: SKIP LOCKED prevents blocking; pool size tuned; backoff/retry policy recommended.

## Future Enhancements
- Seat selection by specific numbers (pass seat_numbers array).
- Payments integration with two-phase commit (reserve -> pay -> confirm/fail).
- Webhooks for booking events.
- Multi-tenant shows/trips with different seat maps.
