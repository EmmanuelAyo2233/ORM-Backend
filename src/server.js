const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Initialize database pool
const db = require('./db');

// Import routes
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*', // For development. Can be restricted to React app address later.
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Mount API routes
app.use('/api', apiRoutes);

// Basic Health Check Route
app.get('/api/health', async (req, res) => {
  try {
    // Perform simple query to verify db connectivity
    const [rows] = await db.query('SELECT 1 as connection_status');
    res.status(200).json({
      status: 'OK',
      message: 'Server is healthy and database is connected.',
      db_status: rows[0].connection_status === 1 ? 'Connected' : 'Error'
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Server is running, but database connection failed.',
      error: error.message
    });
  }
});

// Root route
app.get('/', (req, res) => {
  res.send('Online Students Result Management System API is running.');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`[Server] Express API server running on port ${PORT}`);
  console.log(`[Server] Health check available at http://localhost:${PORT}/api/health`);
});
