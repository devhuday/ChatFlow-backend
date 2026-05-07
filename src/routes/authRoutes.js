import express from 'express';
import { register, login } from '../controllers/authController.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// Ruta para registrar un usuario: POST /api/auth/register
router.post('/register', register);
// Ruta para iniciar sesión: POST /api/auth/login
router.post('/login', login);

// Ruta protegida de prueba: GET /api/auth/me
router.get('/me', verifyToken, (req, res) => {
    res.json({
        message: '¡Tienes acceso a esta ruta protegida!',
        user: req.user // Esta info viene del token decodificado
    });
});

export default router;