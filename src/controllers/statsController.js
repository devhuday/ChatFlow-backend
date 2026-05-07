import prisma from '../services/prisma.js';

// ==========================================
// OBTENER ESTADÍSTICAS DEL DASHBOARD
// ==========================================
export const getDashboardStats = async (req, res) => {
    try {
        const userId = req.user.userId;

        // 1. Obtener todos los bots del usuario y sus contadores
        const userBots = await prisma.session.findMany({
            where: { userId: userId },
            select: { id: true, messagesSent: true, messagesReceived: true }
        });

        // 2. Sumar los totales
        let totalSent = 0;
        let totalReceived = 0;
        userBots.forEach(bot => {
            totalSent += bot.messagesSent || 0;
            totalReceived += bot.messagesReceived || 0;
        });

        // 3. Contar conversaciones activas
        const activeConversations = await prisma.chat.count({
            where: { session: { userId: userId } }
        });

        res.json({
            botsOperativos: userBots.length,
            conversacionesActivas: activeConversations,
            mensajesRecibidos: totalReceived,
            mensajesEnviados: totalSent,
            totalMensajes: totalSent + totalReceived
        });
    } catch (error) {
        console.error('Error al obtener estadísticas del dashboard:', error);
        res.status(500).json({ error: 'Error interno al cargar el dashboard.' });
    }
};

// ==========================================
// OBTENER ESTADÍSTICAS DIARIAS DE MENSAJES
// ==========================================
export const getDailyMessageStats = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { start, end, botName } = req.query;

        const endDate = end ? new Date(end) : new Date();
        const startDate = start ? new Date(start) : new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return res.status(400).json({ error: 'Fechas inválidas. Usa YYYY-MM-DD.' });
        }

        if (startDate > endDate) {
            return res.status(400).json({ error: 'La fecha de inicio debe ser anterior o igual a la fecha de fin.' });
        }

        if (endDate.getTime() - startDate.getTime() > 90 * 24 * 60 * 60 * 1000) {
            return res.status(400).json({ error: 'El rango máximo es de 90 días.' });
        }

        endDate.setHours(23, 59, 59, 999);

        const whereClause = {
            chat: {
                session: {
                    userId: userId
                }
            },
            timestamp: {
                gte: startDate,
                lte: endDate
            }
        };

        if (botName) {
            whereClause.chat.sessionId = botName;
        }

        const messages = await prisma.message_History.findMany({
            where: whereClause,
            select: {
                role: true,
                timestamp: true
            }
        });

        const formatDay = (date) => date.toISOString().slice(0, 10);
        const dailyMap = new Map();

        for (const message of messages) {
            const day = formatDay(message.timestamp);
            if (!dailyMap.has(day)) {
                dailyMap.set(day, { date: day, sent: 0, received: 0 });
            }
            const current = dailyMap.get(day);
            if (message.role === 'assistant' || message.role === 'bot') {
                current.sent += 1;
            } else if (message.role === 'user') {
                current.received += 1;
            } else {
                // Para datos históricos o roles inesperados, asumimos que el mensaje fue recibido
                current.received += 1;
            }
        }

        const results = [];
        for (let current = new Date(startDate); current <= endDate; current.setDate(current.getDate() + 1)) {
            const day = formatDay(current);
            results.push(dailyMap.get(day) || { date: day, sent: 0, received: 0 });
        }

        res.json({
            startDate: formatDay(startDate),
            endDate: formatDay(endDate),
            botName: botName || null,
            data: results
        });
    } catch (error) {
        console.error('Error al obtener estadísticas diarias de mensajes:', error);
        res.status(500).json({ error: 'Error interno al obtener estadísticas diarias.' });
    }
};
