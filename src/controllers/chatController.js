import prisma from '../services/prisma.js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'Jerplakey_0903';

// ==========================================
// OBTENER CHATS DE UN BOT (BANDEJA DE ENTRADA)
// ==========================================
export const getBotChats = async (req, res) => {
    try {
        const { botName } = req.params;
        const userId = req.user.userId;

        // 1. Validar que el bot le pertenezca al usuario
        const bot = await prisma.session.findUnique({ where: { id: botName } });
        if (!bot || bot.userId !== userId) {
            return res.status(403).json({ error: 'No tienes permiso para ver estos chats.' });
        }

        // 2. Obtener los chats ordenados por fecha (más recientes primero)
        const chats = await prisma.chat.findMany({
            where: { sessionId: botName },
            orderBy: { updatedAt: 'desc' },
            include: {
                messages: {
                    orderBy: { timestamp: 'desc' },
                    take: 20 // Traer solo los últimos 20 mensajes para la vista previa
                }
            }
        });

        res.json(chats);
    } catch (error) {
        console.error('Error al obtener los chats del bot:', error);
        res.status(500).json({ error: 'Error interno al cargar los chats.' });
    }
};

// ==========================================
// ENVIAR MENSAJE DESDE LA UI A UN CHAT
// ==========================================
export const sendBotChatMessage = async (req, res) => {
    try {
        const { botName, chatId } = req.params;
        const { text } = req.body;
        const userId = req.user.userId;

        if (!text || typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ error: 'Debes proporcionar el texto del mensaje.' });
        }

        const bot = await prisma.session.findUnique({ where: { id: botName } });
        if (!bot || bot.userId !== userId) {
            return res.status(403).json({ error: 'No tienes permiso para enviar mensajes en este bot.' });
        }

        const chat = await prisma.chat.findUnique({ where: { id: chatId } });
        if (!chat || chat.sessionId !== botName) {
            return res.status(404).json({ error: 'Chat no encontrado para este bot.' });
        }

        const evResponse = await fetch(`${EVOLUTION_API_URL}/message/sendText/${botName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY
            },
            body: JSON.stringify({
                number: chat.customerPhone,
                text: text.trim(),
                delay: 1500
            })
        });

        let evData;
        try {
            evData = await evResponse.json();
        } catch (parseError) {
            evData = { raw: await evResponse.text() };
        }

        if (!evResponse.ok) {
            return res.status(502).json({ error: 'Error al enviar el mensaje a Evolution API.', details: evData });
        }

        await prisma.message_History.create({
            data: {
                chatId: chat.id,
                role: 'bot',
                content: text.trim()
            }
        });

        await prisma.session.update({
            where: { id: botName },
            data: { messagesSent: { increment: 1 } }
        });

        await prisma.chat.update({
            where: { id: chat.id },
            data: { updatedAt: new Date() }
        });

        res.json({ message: 'Mensaje enviado con éxito.', evolution: evData });
    } catch (error) {
        console.error('Error al enviar mensaje desde la UI:', error);
        res.status(500).json({ error: 'Error interno al enviar el mensaje.' });
    }
};

// ==========================================
// OBTENER ESTADO DE UN CHAT (Pausado o Activo)
// ==========================================
export const getChatStatus = async (req, res) => {
    try {
        const { botName, chatId } = req.params;
        const userId = req.user.userId;

        const bot = await prisma.session.findUnique({ where: { id: botName } });
        if (!bot || bot.userId !== userId) {
            return res.status(403).json({ error: 'No tienes permiso para ver este chat.' });
        }

        const chat = await prisma.chat.findUnique({ where: { id: chatId } });
        if (!chat || chat.sessionId !== botName) {
            return res.status(404).json({ error: 'Chat no encontrado.' });
        }

        res.json({
            chatId: chat.id,
            sessionId: chat.sessionId,
            customerPhone: chat.customerPhone,
            isPaused: chat.isPaused,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt
        });
    } catch (error) {
        console.error('Error al obtener estado del chat:', error);
        res.status(500).json({ error: 'Error interno al obtener el estado del chat.' });
    }
};

// ==========================================
// PAUSAR UN CHAT (Bot no responde automáticamente)
// ==========================================
export const pauseChat = async (req, res) => {
    try {
        const { botName, chatId } = req.params;
        const userId = req.user.userId;

        const bot = await prisma.session.findUnique({ where: { id: botName } });
        if (!bot || bot.userId !== userId) {
            return res.status(403).json({ error: 'No tienes permiso para pausar chats en este bot.' });
        }

        const chat = await prisma.chat.findUnique({ where: { id: chatId } });
        if (!chat || chat.sessionId !== botName) {
            return res.status(404).json({ error: 'Chat no encontrado.' });
        }

        if (chat.isPaused) {
            return res.status(400).json({ message: 'El chat ya está pausado.' });
        }

        await prisma.chat.update({
            where: { id: chatId },
            data: { isPaused: true }
        });

        res.json({ message: 'Chat pausado. El bot no responderá automáticamente.' });
    } catch (error) {
        console.error('Error al pausar el chat:', error);
        res.status(500).json({ error: 'Error interno al pausar el chat.' });
    }
};

// ==========================================
// REANUDAR UN CHAT (Bot vuelve a responder)
// ==========================================
export const resumeChat = async (req, res) => {
    try {
        const { botName, chatId } = req.params;
        const userId = req.user.userId;

        const bot = await prisma.session.findUnique({ where: { id: botName } });
        if (!bot || bot.userId !== userId) {
            return res.status(403).json({ error: 'No tienes permiso para reanudar chats en este bot.' });
        }

        const chat = await prisma.chat.findUnique({ where: { id: chatId } });
        if (!chat || chat.sessionId !== botName) {
            return res.status(404).json({ error: 'Chat no encontrado.' });
        }

        if (!chat.isPaused) {
            return res.status(400).json({ message: 'El chat no está pausado.' });
        }

        await prisma.chat.update({
            where: { id: chatId },
            data: { isPaused: false }
        });

        res.json({ message: 'Chat reanudado. El bot volverá a responder automáticamente.' });
    } catch (error) {
        console.error('Error al reanudar el chat:', error);
        res.status(500).json({ error: 'Error interno al reanudar el chat.' });
    }
};
