import express from 'express';
import { handleWebhook, handleExternalReply } from '../controllers/webhookController.js';

const router = express.Router();

// Ruta abierta para recibir webhooks de Evolution API: POST /api/webhook
// OJO: Esta ruta NO usa verifyToken, porque quien la llama es Evolution API, no el usuario final.
router.post('/', handleWebhook);

// Ruta para que los servicios externos (n8n) envíen su respuesta.
// Se protege con un secreto único por bot.
router.post('/reply/:botName', handleExternalReply);

export default router;