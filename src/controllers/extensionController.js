import prisma from '../services/prisma.js';
import crypto from 'crypto';

// Crear una nueva extensión (Se genera el Secreto)
export const createExtension = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { name, webhookUrl } = req.body;

        if (!name || !webhookUrl) {
            return res.status(400).json({ error: 'El nombre y la URL del webhook son obligatorios.' });
        }

        // Generamos un secreto único para esta extensión
        const webhookSecret = crypto.randomBytes(32).toString('hex');

        const extension = await prisma.extension.create({
            data: { userId, name, webhookUrl, webhookSecret }
        });

        // Retornamos la extensión completa. (El frontend mostrará el webhookSecret al usuario)
        res.status(201).json({ message: 'Extensión creada con éxito.', extension });
    } catch (error) {
        console.error('Error al crear extensión:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

// Listar las extensiones del usuario
export const getUserExtensions = async (req, res) => {
    try {
        const extensions = await prisma.extension.findMany({ where: { userId: req.user.userId } });
        res.json(extensions);
    } catch (error) {
        console.error('Error al obtener extensiones:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};

// Eliminar una extensión
export const deleteExtension = async (req, res) => {
    try {
        const { id } = req.params;
        const extension = await prisma.extension.findUnique({ where: { id } });
        if (!extension || extension.userId !== req.user.userId) return res.status(403).json({ error: 'Sin permiso.' });

        await prisma.extension.delete({ where: { id } });
        res.json({ message: 'Extensión eliminada con éxito.' });
    } catch (error) {
        console.error('Error al eliminar extensión:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
};