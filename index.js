import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import statusRoutes from './src/routes/status.js';
import authRoutes from './src/routes/authRoutes.js';
import botRoutes from './src/routes/botRoutes.js';
import webhookRoutes from './src/routes/webhookRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Habilitar CORS para permitir peticiones desde tu frontend
app.use(cors());

// Middleware para leer los JSON que enviemos desde el frontend o Postman
app.use(express.json());
app.use(express.static('public'));

// Rutas
app.use('/api', statusRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/webhook', webhookRoutes);

// Manejo global de errores (debe ir después de todas las rutas)
app.use((err, _req, res, _next) => {
    console.error('[Error no controlado]', err);
    res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor.' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor web corriendo en el puerto ${PORT}`);
});