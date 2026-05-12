import express from 'express';
import { register, login, syncUser } from '../controllers/authController.js';

const router = express.Router();

// Rutas de autenticación tradicional
router.post('/register', register);
router.post('/login', login);

// Ruta para sincronizar el usuario de Clerk
router.post('/sync', syncUser);

export default router;