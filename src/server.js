require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const startExpiryJob = require('./services/expiryJob');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const app = express();
app.use(cors());
app.use(express.json());

// Health
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Swagger
try {
  const swaggerDocument = YAML.load(__dirname + '/swagger.yaml');
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
} catch (e) {
  console.warn('Swagger not loaded:', e.message);
}

// Routes
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  startExpiryJob();
});

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
