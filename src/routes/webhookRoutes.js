import express from 'express';
import { handleWebhook } from '../controllers/webhookController.js';

const router = express.Router();

// Ruta abierta para recibir webhooks de Evolution API: POST /api/webhook
// OJO: Esta ruta NO usa verifyToken, porque quien la llama es Evolution API, no el usuario final.
router.post('/', handleWebhook);

export default router;