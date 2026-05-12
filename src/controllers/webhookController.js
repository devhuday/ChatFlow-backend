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
                include: { user: true, botConfig: true } // Traemos dueño y configuración de IA
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
            if (!botConfig || !botConfig.useAI) {
                console.log(`🤖 IA desactivada para el bot '${botName}'. Mensaje ignorado.`);
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
                                        break;

                                    case 'list':
                                        console.log(`🔀 Flujo de LISTA activado por trigger: '${trigger}'`);
                                        apiResponse = await fetch(`${EVOLUTION_API_URL}/message/sendList/${botName}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
                                            body: JSON.stringify({
                                                number: senderPhone,
                                                buttonText: action.payload.buttonText,
                                                description: action.payload.title,
                                                text: action.payload.description,
                                                sections: action.payload.sections.map(sec => ({
                                                    title: sec.title,
                                                    rows: sec.rows.map(row => ({ rowId: row.id, title: row.title, description: row.description }))
                                                }))
                                            })
                                        });
                                        break;

                                    case 'image':
                                        console.log(`🔀 Flujo de IMAGEN activado por trigger: '${trigger}'`);
                                        apiResponse = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${botName}`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
                                            body: JSON.stringify({
                                                number: senderPhone,
                                                mediatype: 'image',
                                                media: action.payload.url, // La URL de la imagen
                                                // Solo incluimos el caption si existe para evitar errores
                                                ...(action.payload.caption && { caption: action.payload.caption })
                                            })
                                        });
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
                    if (!actionTaken && text) {
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