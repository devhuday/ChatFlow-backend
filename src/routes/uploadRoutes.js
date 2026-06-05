import express from 'express';
import multer from 'multer';
import { uploadFile } from '../controllers/uploadController.js';

const router = express.Router();

// Configuración para usar memoria RAM en lugar del disco duro
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Límite de seguridad: 5MB por imagen
});

// Nota: Asegúrate de importar y agregar tu middleware de autenticación (ej. authenticateToken)
// router.post('/file', authenticateToken, upload.single('file'), uploadFile);

router.post('/file', upload.single('file'), uploadFile);

export default router;