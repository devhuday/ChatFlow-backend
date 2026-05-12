import prisma from '../services/prisma.js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

// ==========================================
// CREAR UN NUEVO BOT
// ==========================================
export const createBot = async (req, res) => {
    try {
        const userId = req.user.userId; // Obtenido del token gracias a verifyToken
        // Recibimos los datos con la nueva estructura del Frontend
        const { name, apiType, prompt, status, flows } = req.body; 

        if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
            return res.status(500).json({ error: 'La configuración de Evolution API no está completa en el servidor.' });
        }

        if (!name) {
            return res.status(400).json({ error: 'Debes proporcionar un nombre para el bot (name).' });
        }

        // Evolution API requiere que la instancia sea minúscula y sin espacios (ej: "Asistente de Ventas" -> "asistente-de-ventas")
        const instanceName = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

        // 1. Pedirle a Evolution API que cree la instancia
        const evResponse = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY
            },
            body: JSON.stringify({
                instanceName: instanceName,
                qrcode: true,
                integration: 'WHATSAPP-BAILEYS'
            })
        });
        const evData = await evResponse.json();

        // 2. Guardar la relación en nuestra base de datos (PostgreSQL)
        await prisma.session.create({
            data: {
                id: instanceName,
                name: name, // Guardamos el nombre bonito para tu frontend
                userId: userId,
                data: JSON.stringify(evData), // Guardamos la info de respuesta
                
                botConfig: {
                    create: {
                        aiProvider: apiType || "meta-llama/Llama-3.3-70B-Instruct-Turbo",
                        aiPrompt: prompt || "Eres un asistente útil.",
                        useAI: status === 'active', // Si es "active", será true.
                        responseTree: flows || [] // Prisma guarda arreglos JSON automáticamente
                    }
                }
            }
        });
        
        // 3. Configurar el Webhook automáticamente para que escuche los mensajes
        await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY
            },
            body: JSON.stringify({
                webhook: {
                    enabled: true,
                    url: "http://backend:3000/api/webhook",
                    webhookByEvents: false,
                    events: ["MESSAGES_UPSERT"]
                }
            })
        });

        res.status(201).json({ message: 'Instancia de bot creada con éxito', botName: instanceName, evolution: evData });

        // ==============================================================
        // 🧹 MECANISMO DE AUTODESTRUCCIÓN (ANTIFUGAS DE MEMORIA)
        // Si el usuario no escanea el QR en 5 minutos, borramos el bot
        // ==============================================================
        setTimeout(async () => {
            try {
                // 1. Preguntamos a Evolution en qué estado quedó el bot
                const stateRes = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
                    method: 'GET',
                    headers: { 'apikey': EVOLUTION_API_KEY }
                });
                const stateData = await stateRes.json();

                // 2. Si no está conectado ('open'), procedemos a destruirlo
                if (stateData?.instance?.state !== 'open') {
                    console.log(`⏳ El bot '${instanceName}' no fue escaneado a tiempo. Autodestruyendo...`);
                    
                    // A) Borramos de Evolution API para liberar RAM y CPU
                    await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
                        method: 'DELETE',
                        headers: { 'apikey': EVOLUTION_API_KEY }
                    });

                    // B) Borramos de tu base de datos PostgreSQL para mantenerla limpia
                    await prisma.session.delete({ where: { id: instanceName } });
                    
                    console.log(`🗑️ Bot '${instanceName}' eliminado con éxito por inactividad.`);
                }
            } catch (err) {
                console.error(`Error en autodestrucción del bot ${instanceName}:`, err);
            }
        }, 5 * 60 * 1000); // 5 * 60 * 1000 = 5 Minutos

    } catch (error) {
        console.error('Error en createBot:', error);
        res.status(500).json({ error: 'Error interno al crear el bot.' });
    }
};

export const getBotStatus = async (req, res) => {
    try {
        const { botName } = req.params;
        
        // Pedirle a Evolution API el estado de conexión o el código QR
        const evResponse = await fetch(`${EVOLUTION_API_URL}/instance/connect/${botName}`, {
            method: 'GET',
            headers: { 'apikey': EVOLUTION_API_KEY }
        });
        
        const evData = await evResponse.json();
        res.json(evData);
    } catch (error) {
        console.error('Error en getBotStatus:', error);
        res.status(500).json({ error: 'Error interno al obtener el estado.' });
    }
};

export const getUserBots = async (req, res) => {
    try {
        const userId = req.user.userId;

        // 1. Buscamos en la BD todos los bots que le pertenecen a este ID
        const dbBots = await prisma.session.findMany({
            where: { userId: userId },
            include: { botConfig: true }
        });

        // 2. Consultar Evolution API para obtener el estado en vivo y los números
        let evInstances = [];
        try {
            const evResponse = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
                method: 'GET',
                headers: { 'apikey': EVOLUTION_API_KEY }
            });
            evInstances = await evResponse.json();
        } catch (evError) {
            console.error('⚠️ No se pudo obtener la info en vivo de Evolution API', evError);
        }

        // 3. Combinar la información de la BD con la información en vivo
        const combinedBots = dbBots.map(dbBot => {
            // Buscar la instancia correspondiente (Compatible con Evolution v1 y v2)
            const evBot = evInstances.find(inst => (inst.name === dbBot.id) || (inst.instance?.instanceName === dbBot.id));

            let linkedPhone = null;
            let connectionStatus = 'offline';
            let profilePicUrl = null;

            if (evBot) {
                // Extraer el número del identificador de WhatsApp (ej. 573000000000@s.whatsapp.net)
                const ownerJid = evBot.ownerJid || evBot.instance?.owner;
                if (ownerJid) linkedPhone = ownerJid.split('@')[0]; 
                
                connectionStatus = evBot.connectionStatus || evBot.instance?.status || 'offline';
                profilePicUrl = evBot.profilePicUrl || evBot.instance?.profilePictureUrl || null;
            }

            return { ...dbBot, linkedPhone, connectionStatus, profilePicUrl };
        });

        // 4. Devolvemos la lista combinada al frontend
        res.json(combinedBots);
    } catch (error) {
        console.error('Error en getUserBots:', error);
        res.status(500).json({ error: 'Error interno al obtener la lista de bots.' });
    }
};

// ==========================================
// ACTUALIZAR LA CONFIGURACIÓN DE UN BOT
// ==========================================
export const updateBot = async (req, res) => {
    try {
        const { id } = req.params; // El ID de la instancia (ej. ventas-1)
        const userId = req.user.userId;
        const { name, apiType, prompt, status, flows } = req.body;

        // 1. Verificar que el bot exista y pertenezca a este usuario
        const existingBot = await prisma.session.findUnique({
            where: { id: id }
        });

        if (!existingBot || existingBot.userId !== userId) {
            return res.status(403).json({ error: 'No tienes permiso para editar este bot.' });
        }

        // 2. Actualizar los datos en PostgreSQL
        const updatedBot = await prisma.session.update({
            where: { id: id },
            data: {
                ...(name !== undefined && { name: name }),
                botConfig: {
                    update: {
                        ...(apiType !== undefined && { aiProvider: apiType }),
                        ...(prompt !== undefined && { aiPrompt: prompt }),
                        ...(status !== undefined && { useAI: status === 'active' }),
                        ...(flows !== undefined && { responseTree: flows })
                    }
                }
            },
            include: { botConfig: true }
        });

        res.json({ message: 'Bot actualizado con éxito', bot: updatedBot });
    } catch (error) {
        console.error('Error al actualizar el bot:', error);
        res.status(500).json({ error: 'Error interno al actualizar el bot.' });
    }
};

// ==========================================
// ELIMINAR UN BOT
// ==========================================
export const deleteBot = async (req, res) => {
    try {
        const { id } = req.params; // El ID de la instancia
        const userId = req.user.userId;

        // 1. Verificar que el bot exista y pertenezca a este usuario
        const existingBot = await prisma.session.findUnique({
            where: { id: id }
        });

        if (!existingBot || existingBot.userId !== userId) {
            return res.status(403).json({ error: 'No tienes permiso para eliminar este bot o no existe.' });
        }

        // 2. Eliminar la instancia de Evolution API (Libera recursos del servidor)
        try {
            await fetch(`${EVOLUTION_API_URL}/instance/delete/${id}`, {
                method: 'DELETE',
                headers: { 'apikey': EVOLUTION_API_KEY }
            });
        } catch (evError) {
            console.error(`⚠️ Error al eliminar instancia de Evolution API:`, evError);
        }

        // 3. Eliminar de la base de datos PostgreSQL
        await prisma.session.delete({ where: { id: id } });

        res.json({ message: 'Bot eliminado con éxito.' });
    } catch (error) {
        console.error('Error al eliminar el bot:', error);
        res.status(500).json({ error: 'Error interno al eliminar el bot.' });
    }
};

// ==========================================
// NOTA: Las funciones de estadísticas, chat y evolution
// han sido movidas a sus respaldos controladores:
// - statsController.js (estadísticas)
// - chatController.js (gestión de chats)
// - evolutionController.js (Evolution API y debug)
// ==========================================