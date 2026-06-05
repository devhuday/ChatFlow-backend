import prisma from '../services/prisma.js';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
// Token de Together AI (A futuro te recomiendo pasarlo al archivo .env)
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;

export const handleWebhook = async (req, res) => {
    try {
        if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !TOGETHER_API_KEY) {
            console.error('Error de configuración: Una o más claves API (Evolution, Together) no están definidas en el servidor.');
            return res.status(500).json({ status: 'error', message: 'Error de configuración del servidor.' });
        }

        const event = req.body;
        
        // Evolution API envía el tipo de evento en la propiedad "event"
        if (event.event === 'messages.upsert') {/*  */
            console.log("📥 Webhook recibido: ", JSON.stringify(event, null, 2));
            const botName = event.instance;
            const messageData = event.data.message;
            const senderPhone = event.data.key.remoteJid; 

            // 🔍 MAGIA DE AUTENTICACIÓN Y PROPIEDAD:
            // Preguntamos a PostgreSQL: "¿Este bot existe en nuestro SaaS y a quién pertenece?"
            const sessionRecord = await prisma.session.findUnique({
                where: { id: botName },
                include: { user: true, botConfig: { include: { extension: true } } } // Traemos dueño, botConfig y SU EXTENSIÓN vinculada
            });

            if (!sessionRecord) {
                console.log(`⚠️ Mensaje ignorado: El bot '${botName}' no pertenece a ningún usuario registrado.`);
                return res.status(200).json({ status: 'ignored' });
            }

            // 1. Evitar que el bot se responda a sí mismo
            if (event.data.key.fromMe) {
                return res.status(200).json({ status: 'ignored' });
            }

            // 2. Identificar el tipo de mensaje y extraer el texto (o la descripción)
            let messageType = 'text';
            let text = messageData?.conversation || messageData?.extendedTextMessage?.text;

            if (messageData?.imageMessage) {
                messageType = 'image';
                text = messageData.imageMessage.caption || '[Imagen sin descripción]';
            } else if (messageData?.audioMessage) {
                messageType = 'audio';
                text = messageData.audioMessage.ptt ? '[Nota de voz]' : '[Archivo de Audio]';
            } else if (messageData?.videoMessage) {
                messageType = 'video';
                text = messageData.videoMessage.caption || '[Video sin descripción]';
            } else if (messageData?.documentMessage) {
                messageType = 'document';
                text = `[Documento: ${messageData.documentMessage.fileName || 'archivo'}]`;
            } else if (messageData?.stickerMessage) {
                messageType = 'sticker';
                text = '[Sticker]';
            }

            console.log(`\n💬 [NUEVO MENSAJE] Bot: ${botName}`);
            console.log(`📱 De: ${senderPhone}`);
            console.log(`🏷️  Tipo: ${messageType}`);
            console.log(`📄 Contenido:`, text || '[Desconocido]');
            console.log(`👤 Propietario del bot: ${sessionRecord.user.email}`);
            
            const botConfig = sessionRecord.botConfig;
            if (!botConfig) {
                console.log(`🤖 Configuración no encontrada para el bot '${botName}'. Mensaje ignorado.`);
                return res.status(200).json({ status: 'ignored' });
            }

            // 2.5 Guardar el historial de la conversación (Mensaje del Usuario)
            let chatRecord = null;
            try {
                // Busca la conversación o la crea si es la primera vez que escriben
                chatRecord = await prisma.chat.upsert({
                    where: {
                        sessionId_customerPhone: {
                            sessionId: botName,
                            customerPhone: senderPhone
                        }
                    },
                    update: { updatedAt: new Date() },
                    create: {
                        sessionId: botName,
                        customerPhone: senderPhone
                    }
                });

                // Registra el mensaje del usuario
                await prisma.message_History.create({
                    data: {
                        chatId: chatRecord.id,
                        role: 'user',
                        type: messageType,
                        content: text || `[${messageType}]`
                    }
                });

                // 📊 Incrementar el contador de mensajes recibidos de este bot
                await prisma.session.update({
                    where: { id: botName },
                    data: {
                        messagesReceived: { increment: 1 }
                    }
                });
            } catch (dbError) {
                console.error('⚠️ Error al guardar el mensaje del usuario en la BD:', dbError);
            }

            // 3. Marcar el mensaje como "leído" (enviar el doble check azul / visto)
            try {
                const readRes = await fetch(`${EVOLUTION_API_URL}/chat/markMessageAsRead/${botName}`, {
                    method: 'POST', // ⚠️ La mayoría de las versiones utilizan POST
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': EVOLUTION_API_KEY
                    },
                    body: JSON.stringify({
                        readMessages: [event.data.key] // Pasamos el objeto 'key' original completo
                    })
                });
                
                if (readRes.ok) {
                    console.log(`👀 Mensaje de ${senderPhone} marcado como leído.`);
                } else {
                    const errData = await readRes.text();
                    console.error(`❌ Evolution API rechazó el 'visto' (Status: ${readRes.status}):`, errData);
                }
            } catch (err) {
                console.error('❌ Error de red al intentar marcar el mensaje como leído:', err);
            }

            // 4. Evaluar flujos (Palabras clave) o Consultar a la IA
            // PERO: Si el chat está pausado por el usuario, omitir todo esto
            if (chatRecord && chatRecord.isPaused) {
                console.log(`⏸️  Chat pausado para ${senderPhone}. El bot NO responderá automáticamente.`);
            } else if (chatRecord) {
                try {
                    let replyText = null;
                    let actionTaken = false; // Bandera para saber si un flujo ya actuó

                    // Función auxiliar para guardar las respuestas interactivas/media del bot en la BD
                    const saveBotMediaMessage = async (msgType, msgContent, mediaUrl = null, fileName = null) => {
                        try {
                            await prisma.message_History.create({
                                data: {
                                    chatId: chatRecord.id,
                                    role: 'bot',
                                    type: msgType,
                                    content: msgContent || `[${msgType}]`,
                                    mediaUrl: mediaUrl,
                                    fileName: fileName
                                }
                            });
                            await prisma.session.update({
                                where: { id: botName },
                                data: { messagesSent: { increment: 1 } }
                            });
                            await prisma.chat.update({
                                where: { id: chatRecord.id },
                                data: { updatedAt: new Date() }
                            });
                        } catch (err) {
                            console.error('⚠️ Error al guardar historial del bot (media):', err);
                        }
                    };

                    // A. Revisar si el mensaje coincide con alguna palabra clave de los flujos (responseTree)
                    // El "trigger" puede ser texto o el ID de un botón/lista que el usuario presionó
                    const selectedButtonId = messageData?.interactiveResponseMessage?.buttonResponseMessage?.selectedButtonId;
                    const selectedListRowId = messageData?.interactiveResponseMessage?.listResponseMessage?.singleSelectReply?.selectedRowId;
                    const triggerText = selectedButtonId || selectedListRowId || text;

                    if (triggerText && botConfig.responseTree && Array.isArray(botConfig.responseTree)) {
                        const userMessage = triggerText.toLowerCase().trim();
                        
                        // Función para quitar acentos/tildes (ej: "camión" -> "camion")
                        const normalizeText = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                        const normalizedUserMessage = normalizeText(userMessage);

                        for (const flow of botConfig.responseTree) {
                            const trigger = flow.trigger?.toLowerCase().trim();
                            if (trigger && (userMessage === trigger || normalizedUserMessage === normalizeText(trigger))) {
                                const action = flow.action;
                                let apiResponse;

                                switch (action.type) {
                                    case 'buttons':
                                        console.log(`🔀 Flujo de BOTONES activado por trigger: '${trigger}'`);
                                        apiResponse = await fetch(`${EVOLUTION_API_URL}/message/sendButtons/${botName}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
                                            body: JSON.stringify({
                                                number: senderPhone,
                                                description: action.payload.text,
                                                footer: action.payload.footer,
                                                buttons: action.payload.buttons.map(btn => ({ buttonId: btn.id, buttonText: { displayText: btn.text }, type: 'reply' }))
                                            })
                                        });
                                        // Guardar en el historial
                                        await saveBotMediaMessage('buttons', action.payload.text || 'Opciones enviadas');
                                        break;

                                    case 'list':
                                        console.log(`🔀 Flujo de LISTA activado por trigger: '${trigger}'`);
                                        apiResponse = await fetch(`${EVOLUTION_API_URL}/message/sendList/${botName}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
                                            body: JSON.stringify({
                                                number: senderPhone,
                                                title: action.payload.title,
                                                text: action.payload.description,
                                                footerText: action.payload.footerText || "Selecciona una opción",
                                                buttonText: action.payload.buttonText,
                                                sections: action.payload.sections.map(sec => ({
                                                    title: sec.title,
                                                rows: sec.rows.map(row => ({ 
                                                    rowId: row.id, 
                                                    title: row.title, 
                                                    ...(row.description && row.description.trim() !== "" ? { description: row.description } : {}) 
                                                }))
                                                }))
                                            })
                                        });
                                        // Guardar en el historial
                                        await saveBotMediaMessage('list', action.payload.description || 'Lista de opciones enviada');
                                        break;

                                    case 'image':
                                        console.log(`🔀 Flujo de IMAGEN activado por trigger: '${trigger}'`);

                                        const imagePayload = {
                                            number: senderPhone,
                                            mediatype: 'image',
                                            media: action.payload.url, // La URL de la imagen
                                            fileName: action.payload.fileName || 'imagen.jpg', // Previene errores si Evolution exige nombre
                                            ...(action.payload.caption && { caption: action.payload.caption })
                                        };

                                        console.log(`[DEBUG] 📦 Enviando a Evolution API:`, imagePayload);

                                        apiResponse = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${botName}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
                                            body: JSON.stringify(imagePayload)
                                        });
                                        // Guardar en el historial
                                        await saveBotMediaMessage('image', action.payload.caption || '', action.payload.url, action.payload.fileName);
                                        break;

                                    case 'document':
                                        console.log(`🔀 Flujo de DOCUMENTO activado por trigger: '${trigger}'`);
                                        apiResponse = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${botName}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
                                            body: JSON.stringify({
                                                number: senderPhone,
                                                mediatype: 'document',
                                                media: action.payload.url, // URL del PDF o archivo
                                                fileName: action.payload.fileName || 'archivo.pdf', // Recomendado enviarlo
                                                ...(action.payload.caption && { caption: action.payload.caption })
                                            })
                                        });
                                        // Guardar en el historial
                                        await saveBotMediaMessage('document', action.payload.caption || '', action.payload.url, action.payload.fileName);
                                        break;

                                    case 'text':
                                    default:
                                        console.log(`🔀 Flujo de TEXTO activado por trigger: '${trigger}'`);
                                        replyText = action.payload.text;
                                        break;
                                }

                                if (apiResponse) {
                                    const apiData = await apiResponse.json();
                                    console.log(`✅ Orden de mensaje interactivo enviada a Evolution API. Resultado:`, JSON.stringify(apiData, null, 2));
                                }

                                actionTaken = true;
                                break; // Detenemos la búsqueda una vez que encontramos un flujo
                            }
                        }
                    }

                    // B. Si NINGÚN flujo actuó y tenemos texto del usuario, le preguntamos a la IA
                    if (!actionTaken && text && botConfig.aiMode !== 'DISABLED') {
                        switch (botConfig.aiMode) {
                            case 'EXTERNAL':
                                if (botConfig.extension?.webhookUrl) {
                                    console.log(`🔗 Redirigiendo mensaje a webhook externo: ${botConfig.extension.name}`);
                                    // Enviamos el evento completo de Evolution API al webhook del usuario.
                                    // Es "fire and forget", no esperamos respuesta aquí.
                                    fetch(botConfig.extension.webhookUrl, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(event)
                                    }).catch(err => console.error(`❌ Error al enviar a webhook externo:`, err));
                                } else {
                                    console.log(`⚠️ Modo EXTERNAL activado pero no hay extensión vinculada o le falta URL.`);
                                }
                                break;

                            case 'INTERNAL':
                            default:
                                console.log(`🧠 Ningún flujo activado. Consultando a Together AI con el modelo: ${botConfig.aiProvider || "meta-llama/Llama-3.3-70B-Instruct-Turbo"}`);
                                try {
                                    const aiResponse = await fetch("https://api.together.xyz/v1/chat/completions", {
                                        method: "POST",
                                        headers: {
                                            "Content-Type": "application/json",
                                            "Authorization": `Bearer ${TOGETHER_API_KEY}`,
                                        },
                                        body: JSON.stringify({
                                            model: botConfig.aiProvider || "meta-llama/Llama-3.3-70B-Instruct-Turbo",
                                            messages: [
                                                { role: "system", content: botConfig.aiPrompt || "Eres un asistente útil." },
                                                { role: "user", content: text }
                                            ],
                                            max_tokens: 256,
                                            temperature: 0.7
                                        }),
                                    });
                                    
                                    const aiData = await aiResponse.json();
                                    
                                    if (!aiResponse.ok || !aiData.choices || aiData.choices.length === 0) {
                                        console.error('❌ Error o respuesta vacía de Together AI:', aiData);
                                        throw new Error(aiData.error?.message || 'La API de Together AI devolvió un error.');
                                    }
                                    
                                    replyText = aiData.choices[0].message?.content?.trim() || "Lo siento, mi cerebro artificial se quedó en blanco. ¿Puedes repetir?";
                                    console.log(`💬 Texto generado por la IA: "${replyText}"`);
                                } catch (aiError) {
                                    console.error('❌ Error en la consulta a la IA:', aiError);
                                    // Opcional: enviar un mensaje de error al usuario
                                    replyText = "Lo siento, estoy teniendo problemas para conectar con mi cerebro artificial en este momento.";
                                }
                                break;
                            }
                    }

                    // C. Si tenemos un texto de respuesta (de un flujo de texto o de la IA), lo enviamos.
                    if (replyText) {
                        const evSendResponse = await fetch(`${EVOLUTION_API_URL}/message/sendText/${botName}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
                            body: JSON.stringify({
                                number: senderPhone,
                                text: replyText,
                                delay: 1500 // Simula que está "Escribiendo..." por 1.5 segundos
                            })
                        });
                        
                        const evSendData = await evSendResponse.json();
                        console.log(`✅ Orden de envío de texto enviada a Evolution API. Resultado:`, JSON.stringify(evSendData, null, 2));

                        // D. Guardar la respuesta del bot en el historial
                        try {
                            await prisma.message_History.create({
                                data: {
                                    chatId: chatRecord.id,
                                    role: 'bot',
                                    type: 'text',
                                    content: replyText
                                }
                            });

                            // 📊 Incrementar el contador de mensajes enviados de este bot
                            await prisma.session.update({
                                where: { id: botName },
                                data: {
                                    messagesSent: { increment: 1 }
                                }
                            });

                            // 🕒 Actualizar la fecha del chat para que suba a los "más recientes"
                            await prisma.chat.update({
                                where: { id: chatRecord.id },
                                data: { updatedAt: new Date() }
                            });
                        } catch (dbError) {
                            console.error('⚠️ Error al guardar la respuesta del bot en la BD:', dbError);
                        }
                    }
                } catch (iaError) {
                    console.error('❌ Error en el proceso de IA o envío:', iaError);
                }
            }
        }

        // Es MUY importante responderle con un 200 OK rápido a Evolution API 
        // para que sepa que recibimos el mensaje correctamente.
        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error('Error procesando webhook:', error);
        res.status(500).json({ error: 'Error interno' });
    }
};

export const handleExternalReply = async (req, res) => {
    try {
        const { botName } = req.params;
        const authHeader = req.headers.authorization;
        const { recipientPhone, reply } = req.body;

        if (!recipientPhone || !reply || !reply.type) {
            return res.status(400).json({ error: 'El cuerpo de la petición es inválido. Se requiere "recipientPhone" y "reply" con un "type".' });
        }

        // 1. Autenticar la petición
        const botConfig = await prisma.botConfig.findUnique({
            where: { sessionId: botName },
            include: { extension: true }
        });
        if (!botConfig || !botConfig.extension?.webhookSecret) {
            return res.status(404).json({ error: 'Bot no encontrado o no tiene extensión externa configurada.' });
        }

        const expectedSecret = `Bearer ${botConfig.extension.webhookSecret}`;
        if (!authHeader || authHeader !== expectedSecret) {
            return res.status(403).json({ error: 'Token de autorización inválido o ausente.' });
        }

        // 2. Enviar la respuesta a través de Evolution API
        let apiResponse;
        let responseData;

        switch (reply.type) {
            case 'text':
                responseData = { number: recipientPhone, text: reply.content };
                apiResponse = await fetch(`${EVOLUTION_API_URL}/message/sendText/${botName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
                    body: JSON.stringify(responseData)
                });
                break;
            
            case 'image':
            case 'document':
                responseData = {
                    number: recipientPhone,
                    mediatype: reply.type,
                    media: reply.url,
                    fileName: reply.fileName,
                    caption: reply.caption
                };
                apiResponse = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${botName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
                    body: JSON.stringify(responseData)
                });
                break;
            
            // Aquí podrías agregar más casos como 'buttons', 'list', etc.

            default:
                return res.status(400).json({ error: `Tipo de respuesta "${reply.type}" no soportado.` });
        }

        if (!apiResponse.ok) {
            const errorData = await apiResponse.text();
            console.error(`❌ Error de Evolution API al enviar respuesta externa:`, errorData);
            return res.status(502).json({ error: 'Error al comunicarse con la API de WhatsApp.' });
        }

        console.log(`✅ Respuesta de IA externa enviada a ${recipientPhone} a través del bot ${botName}.`);

        // 3. Guardar la respuesta en el historial de chat
        try {
            const chatRecord = await prisma.chat.findUnique({
                where: { sessionId_customerPhone: { sessionId: botName, customerPhone: recipientPhone } }
            });

            if (chatRecord) {
                await prisma.message_History.create({
                    data: {
                        chatId: chatRecord.id,
                        role: 'bot',
                        type: reply.type,
                        content: reply.content || reply.caption || `[${reply.type}]`,
                        mediaUrl: reply.url,
                        fileName: reply.fileName
                    }
                });
                await prisma.session.update({
                    where: { id: botName },
                    data: { messagesSent: { increment: 1 } }
                });
                await prisma.chat.update({
                    where: { id: chatRecord.id },
                    data: { updatedAt: new Date() }
                });
            }
        } catch (dbError) {
            console.error('⚠️ Error al guardar historial de respuesta externa:', dbError);
            // No devolvemos error al cliente, ya que el mensaje se envió.
        }

        res.status(200).json({ status: 'success', message: 'Respuesta enviada.' });

    } catch (error) {
        console.error('Error en handleExternalReply:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};