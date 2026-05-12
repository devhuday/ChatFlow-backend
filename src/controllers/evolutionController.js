import prisma from '../services/prisma.js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

// ==========================================
// OBTENER TODAS LAS INSTANCIAS DE EVOLUTION API (DEBUG)
// ==========================================
export const getEvolutionInstances = async (req, res) => {
    try {
        if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
            return res.status(500).json({ error: 'La configuración de Evolution API no está completa en el servidor.' });
        }

        const evResponse = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
            method: 'GET',
            headers: { 'apikey': EVOLUTION_API_KEY }
        });
        
        const evData = await evResponse.json();
        res.json(evData);
    } catch (error) {
        console.error('Error al obtener instancias de Evolution:', error);
        res.status(500).json({ error: 'Error interno al conectar con Evolution API.' });
    }
};

// ==========================================
// LIMPIAR BOTS FANTASMAS (Sincronizar Evolution con PostgreSQL)
// ==========================================
export const cleanupGhostBots = async (req, res) => {
    try {
        if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
            return res.status(500).json({ error: 'La configuración de Evolution API no está completa en el servidor.' });
        }

        // 1. Obtener todas las instancias de Evolution API
        const evResponse = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
            method: 'GET',
            headers: { 'apikey': EVOLUTION_API_KEY }
        });
        const evInstances = await evResponse.json();

        // 2. Obtener los bots válidos desde nuestra base de datos (PostgreSQL)
        const dbSessions = await prisma.session.findMany({ select: { id: true } });
        const validBotNames = dbSessions.map(session => session.id);

        const deletedNames = [];

        // 3. Comparar y eliminar los "fantasmas"
        for (const evBot of evInstances) {
            const evBotName = evBot.name || evBot.instance?.instanceName; // Compatible con v1 y v2

            // Si el bot de Evolution NO está en nuestra base de datos, lo destruimos
            if (evBotName && !validBotNames.includes(evBotName)) {
                console.log(`🗑️ Eliminando bot fantasma de Evolution API: ${evBotName}`);
                await fetch(`${EVOLUTION_API_URL}/instance/delete/${evBotName}`, {
                    method: 'DELETE',
                    headers: { 'apikey': EVOLUTION_API_KEY }
                });
                deletedNames.push(evBotName);
            }
        }

        res.json({ message: `Se eliminaron ${deletedNames.length} bots fantasmas.`, deletedBots: deletedNames });
    } catch (error) {
        console.error('Error al limpiar instancias de Evolution:', error);
        res.status(500).json({ error: 'Error interno al limpiar Evolution API.' });
    }
};
