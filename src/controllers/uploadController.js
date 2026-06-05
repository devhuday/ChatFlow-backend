import path from 'path';
import { uploadFileToR2 } from '../services/r2Service.js';

export const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se ha proporcionado ningún archivo.' });
        }

        // 1. Subir a R2 desde la memoria RAM y obtener la URL pública
        const fileUrl = await uploadFileToR2(req.file);

        // 2. Determinar el nombre del archivo para el usuario final.
        // multer pone los campos de texto en req.body.
        let finalFileName = req.body.customName;

        // Si el usuario no proveyó un nombre, usamos el original del archivo.
        if (!finalFileName) {
            finalFileName = req.file.originalname;
        } else {
            // (Opcional pero recomendado) Asegurarse de que el nombre personalizado tenga la extensión correcta.
            const originalExtension = path.extname(req.file.originalname);
            const customExtension = path.extname(finalFileName);
            if (customExtension.toLowerCase() !== originalExtension.toLowerCase()) {
                finalFileName += originalExtension;
            }
        }

        // 3. Respondemos con la URL y el nombre del archivo final.
        res.status(200).json({ message: 'Archivo subido exitosamente.', url: fileUrl, fileName: finalFileName });
    } catch (error) {
        console.error('Error en uploadFile:', error);
        res.status(500).json({ error: 'Error interno al subir el archivo a la nube.' });
    }
};