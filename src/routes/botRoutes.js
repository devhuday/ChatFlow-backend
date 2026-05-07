import express from 'express';
// CRUD de bots
import { createBot, getBotStatus, getUserBots, updateBot, deleteBot } from '../controllers/botController.js';
// Estadísticas
import { getDashboardStats, getDailyMessageStats } from '../controllers/statsController.js';
// Gestión de chats
import { getBotChats, sendBotChatMessage, getChatStatus, pauseChat, resumeChat } from '../controllers/chatController.js';
// Evolution API y debug
import { getEvolutionInstances, cleanupGhostBots } from '../controllers/evolutionController.js';
import { verifyToken } from '../middleware/auth.js';

const router = express.Router();

// Aplicamos el middleware a TODAS las rutas de este router
router.use(verifyToken);

// Ruta para crear un nuevo bot: POST /api/bot/create
router.post('/create', createBot);
// Ruta para obtener todos los bots del usuario logueado: GET /api/bot/list
router.get('/list', getUserBots);

// Ruta para las estadísticas del dashboard: GET /api/bot/dashboard/stats
router.get('/dashboard/stats', getDashboardStats);

// Ruta para las estadísticas diarias por día: GET /api/bot/dashboard/daily-stats
// Query opcionales: ?start=YYYY-MM-DD&end=YYYY-MM-DD&botName=mi-bot
router.get('/dashboard/daily-stats', getDailyMessageStats);

// Ruta para ver todas las instancias directamente en Evolution API (Debug)
router.get('/evolution/instances', getEvolutionInstances);
// Ruta para eliminar bots fantasma en Evolution API
router.delete('/evolution/cleanup', cleanupGhostBots);

// Ruta para obtener el QR/estado: GET /api/bot/:botName/status
router.get('/:botName/status', getBotStatus);
// Ruta para obtener los chats de un bot: GET /api/bot/:botName/chats
router.get('/:botName/chats', getBotChats);
// Ruta para obtener estado de un chat: GET /api/bot/:botName/chats/:chatId/status
router.get('/:botName/chats/:chatId/status', getChatStatus);
// Ruta para enviar un mensaje desde la UI: POST /api/bot/:botName/chats/:chatId/send
router.post('/:botName/chats/:chatId/send', sendBotChatMessage);
// Ruta para pausar un chat (bot no responde): POST /api/bot/:botName/chats/:chatId/pause
router.post('/:botName/chats/:chatId/pause', pauseChat);
// Ruta para reanudar un chat (bot responde de nuevo): POST /api/bot/:botName/chats/:chatId/resume
router.post('/:botName/chats/:chatId/resume', resumeChat);
// Ruta para actualizar la configuración de un bot: PUT /api/bot/update/:id
router.put('/update/:id', updateBot);
// Ruta para eliminar un bot: DELETE /api/bot/delete/:id
router.delete('/delete/:id', deleteBot);

export default router;