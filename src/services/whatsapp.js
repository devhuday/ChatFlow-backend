import { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import { handleIncomingMessage } from './messageHandler.js';

// Variables exportadas para que otros archivos puedan leer el estado actual
export let currentQR = null;
export let connectionStatus = 'Iniciando...';

export async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        browser: ['MiBot Web', 'Chrome', '120.0.0'],
        printQRInTerminal: false, 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("Nuevo QR generado, enviando al frontend...");
            currentQR = await qrcode.toDataURL(qr);
            connectionStatus = 'Esperando escaneo del QR';
        }
        
        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            if (shouldReconnect) {
                connectionStatus = 'Reconectando...';
                connectToWhatsApp();
            } else {
                connectionStatus = 'Desconectado. Actualiza para nuevo QR.';
                currentQR = null;
            }
        } else if (connection === 'open') {
            console.log('¡Bot conectado exitosamente!');
            connectionStatus = '¡Conectado exitosamente!';
            currentQR = null;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        await handleIncomingMessage(sock, m.messages[0]);
    });
}