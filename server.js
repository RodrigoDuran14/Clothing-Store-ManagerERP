require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const connectDB = require('./src/config/database');
const { errorHandler, notFound } = require('./src/middleware/errorHandler');

const app = express();

/* ======================================================
 *  Conexión a base de datos
 * ======================================================= */
connectDB();

/* ======================================================
 *  Middlewares globales
 * ======================================================= */
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

/* ========================================================
 *  Endpoints base
 * ======================================================= */
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: null,
    message: 'Servidor funcionando',
  });
});

app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      name: 'Clothing Store Manager API',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      endpoints: {
        health: '/health',
        api: '/api',
        auth: '/api/auth',
        users: '/api/users',
      },
    },
    message: 'Bienvenido a la API de Clothing Store Manager',
  });
});

/* =========================================================
 *  Rutas de la aplicación
 * ========================================================= */
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

/* =========================================================
 *  Middleware 404 y manejo centralizado de errores
 * ========================================================= */
app.use(notFound);
app.use(errorHandler);

/* =======================================================
 *  Arranque del servidor
 * ======================================================= */
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT} (${process.env.NODE_ENV})`);
});

/* =======================================================
 *  Errores no capturados
 * ======================================================= */
process.on('unhandledRejection', (err) => {
  console.error(`❌ UnhandledRejection: ${err.message}`);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  console.error(`❌ UncaughtException: ${err.message}`);
  process.exit(1);
});

module.exports = app;