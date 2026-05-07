// ==========================================
// CONFIGURACIÓN TEMPORAL (HARDCODED)
// En el futuro, esta data vendrá de PostgreSQL dependiendo del usuario/bot
// ==========================================

const BOT_CONFIG = {
    useAI: false, // Cambiar a true para desviar el flujo hacia la IA
    aiConfig: {
        provider: 'openai', // 'openai', 'gemini', 'deepseek', etc.
        apiKey: 'sk-mock-key-12345',
        prompt: 'Eres un asistente virtual de ventas experto...'
    },
    responseTree: {
        'hola': '¡Hola! Bienvenido a Greenglo. Elige una opción:\n1. Servicios\n2. Soporte',
        '1': 'Nuestros servicios incluyen:\n- Bots con IA\n- Árboles de respuesta automatizados',
        '2': 'En un momento un agente humano te atenderá. ¡Gracias por esperar!'
    }
};

// ==========================================
// LÓGICA PRINCIPAL DE PROCESAMIENTO
// ==========================================

export async function handleIncomingMessage(sock, msg) {
    // Ignorar mensajes sin contenido o mensajes enviados por el propio bot
    if (!msg.message || msg.key.fromMe) return;

    const remoteJid = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    const lowerText = text.toLowerCase().trim();

    // Marcar el mensaje como leído (los dos checks azules)
    await sock.readMessages([msg.key]);

    if (BOT_CONFIG.useAI) {
        // LÓGICA DE IA (Futura implementación)
        console.log(`[IA - ${BOT_CONFIG.aiConfig.provider}] Procesando mensaje: ${lowerText}`);
        await sock.sendMessage(remoteJid, { text: '🤖 Respuestas con IA en construcción...' });
    } else {
        // LÓGICA DE ÁRBOL DE DECISIONES
        const response = BOT_CONFIG.responseTree[lowerText];
        
        if (response) {
            await sock.sendMessage(remoteJid, { text: response });
        } else if (lowerText === 'ping') {
            await sock.sendMessage(remoteJid, { text: 'pong' });
        }
    }
}